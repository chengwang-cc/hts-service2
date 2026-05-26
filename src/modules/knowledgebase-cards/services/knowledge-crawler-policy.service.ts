import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { TelemetryService } from '../../observability/telemetry.service';

/**
 * Outbound URL policy for the knowledge-source crawler. Same pattern as
 * the broker-adapter OutboundHttpPolicyService — keeps the two callsites
 * independent so each can evolve its allowlists/limits separately.
 *
 * Protections:
 *   - HTTPS-only by default (override with KNOWLEDGE_CRAWLER_ALLOW_HTTP=true
 *     for local fixtures / dev).
 *   - Block localhost / link-local / private / metadata IPv4 + IPv6.
 *   - Resolve hostnames before fetching and re-check the resolved IP.
 *   - Cap response size with KNOWLEDGE_CRAWLER_MAX_BYTES (default 25MB).
 *   - Cap redirects with KNOWLEDGE_CRAWLER_MAX_REDIRECTS (default 3).
 *   - Restrict content-type to an allowlist; opt-in expansion via
 *     KNOWLEDGE_CRAWLER_EXTRA_CONTENT_TYPES.
 *   - Bounded request timeout via KNOWLEDGE_CRAWLER_TIMEOUT_MS (default 30s).
 */
export interface KnowledgeCrawlerFetchOptions {
  /** Per-source allowlist of hostnames. */
  allowedHosts?: string[];
  /** Override max bytes for one fetch. */
  maxBytes?: number;
  /** Override max redirects for one fetch. */
  maxRedirects?: number;
  /** Override request timeout. */
  timeoutMs?: number;
  /** Override content-type allowlist. */
  allowedContentTypes?: string[];
}

export interface KnowledgeCrawlerFetchResult {
  finalUrl: string;
  contentType: string;
  buffer: Buffer;
  status: number;
}

const DEFAULT_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'text/xml',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/json',
  'application/pdf',
  'application/octet-stream',
];

@Injectable()
export class KnowledgeCrawlerPolicyService {
  private readonly logger = new Logger(KnowledgeCrawlerPolicyService.name);

  constructor(
    @Optional() private readonly telemetry: TelemetryService | null = null,
  ) {}

  async fetch(
    rawUrl: string,
    options: KnowledgeCrawlerFetchOptions = {},
  ): Promise<KnowledgeCrawlerFetchResult> {
    const url = await this.assertAllowed(rawUrl, options);
    const maxBytes =
      options.maxBytes ??
      Number(process.env.KNOWLEDGE_CRAWLER_MAX_BYTES ?? 25 * 1024 * 1024);
    const maxRedirects =
      options.maxRedirects ??
      Number(process.env.KNOWLEDGE_CRAWLER_MAX_REDIRECTS ?? 3);
    const timeoutMs =
      options.timeoutMs ??
      Number(process.env.KNOWLEDGE_CRAWLER_TIMEOUT_MS ?? 30_000);
    const allowedContentTypes = this.resolveContentTypes(
      options.allowedContentTypes,
    );

    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(currentUrl.toString(), {
          redirect: 'manual',
          signal: controller.signal,
        });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          if (hop === maxRedirects) {
            this.logBlocked(currentUrl, 'too_many_redirects');
            throw new BadRequestException('crawler: too many redirects');
          }
          const next = res.headers.get('location');
          if (!next) {
            this.logBlocked(currentUrl, 'redirect_missing_location');
            throw new BadRequestException('crawler: redirect without Location');
          }
          currentUrl = await this.assertAllowed(
            new URL(next, currentUrl).toString(),
            options,
          );
          continue;
        }
        if (!res.ok) {
          throw new BadRequestException(
            `crawler: ${currentUrl.toString()} returned HTTP ${res.status}`,
          );
        }
        const contentType = (res.headers.get('content-type') ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (contentType && !allowedContentTypes.has(contentType)) {
          this.logBlocked(currentUrl, `content_type:${contentType}`);
          throw new BadRequestException(
            `crawler: content-type "${contentType}" not in allowlist`,
          );
        }
        const reader = res.body?.getReader();
        if (!reader) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > maxBytes) {
            this.logBlocked(currentUrl, 'oversized_response');
            throw new BadRequestException('crawler: response exceeds max bytes');
          }
          return {
            finalUrl: currentUrl.toString(),
            contentType: contentType || 'application/octet-stream',
            buffer: buf,
            status: res.status,
          };
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > maxBytes) {
              await reader.cancel();
              this.logBlocked(currentUrl, 'oversized_response');
              throw new BadRequestException(
                'crawler: response exceeds max bytes',
              );
            }
            chunks.push(value);
          }
        }
        return {
          finalUrl: currentUrl.toString(),
          contentType: contentType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
          status: res.status,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    throw new BadRequestException('crawler: too many redirects');
  }

  async assertAllowed(
    rawUrl: string,
    options: KnowledgeCrawlerFetchOptions = {},
  ): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('crawler: URL is invalid');
    }
    const allowHttp = process.env.KNOWLEDGE_CRAWLER_ALLOW_HTTP === 'true';
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
      this.logBlocked(url, 'scheme_not_https');
      throw new BadRequestException('crawler: only HTTPS URLs are allowed');
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === 'metadata.google.internal' ||
      hostname === '169.254.169.254'
    ) {
      this.logBlocked(url, 'blocked_hostname');
      throw new BadRequestException('crawler: hostname not allowed');
    }
    if (options.allowedHosts?.length) {
      const allow = new Set(
        options.allowedHosts.map((h) => h.toLowerCase()),
      );
      if (!allow.has(hostname)) {
        this.logBlocked(url, 'host_not_allowlisted');
        throw new BadRequestException('crawler: host not in allowlist');
      }
    }
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: false });
    if (!addresses.length) {
      this.logBlocked(url, 'dns_no_records');
      throw new BadRequestException('crawler: no DNS records for hostname');
    }
    for (const record of addresses) {
      if (isBlockedIp(record.address)) {
        this.logBlocked(url, `blocked_ip:${record.address}`);
        throw new BadRequestException(
          'crawler: hostname resolves to a blocked IP',
        );
      }
    }
    return url;
  }

  private resolveContentTypes(extra?: string[]): Set<string> {
    const allow = new Set(DEFAULT_CONTENT_TYPES.map((t) => t.toLowerCase()));
    const envExtras = (
      process.env.KNOWLEDGE_CRAWLER_EXTRA_CONTENT_TYPES ?? ''
    )
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    for (const t of envExtras) allow.add(t);
    for (const t of extra ?? []) {
      if (t) allow.add(t.toLowerCase());
    }
    return allow;
  }

  private logBlocked(url: URL, reason: string): void {
    this.logger.warn(
      `knowledge-crawler.blocked host=${url.hostname} path=${url.pathname} reason=${reason}`,
    );
    // Coarse label so dashboards can group by reason without exploding
    // cardinality on individual hostnames.
    const family = reason.includes(':') ? reason.split(':')[0] : reason;
    this.telemetry?.countEvent('knowledge_crawler_blocked_total', {
      reason: family,
    });
  }
}

function isBlockedIp(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const candidate = mapped ?? address;
  const version = isIP(candidate);
  if (version === 4) return isBlockedIpv4(candidate);
  if (version === 6) return isBlockedIpv6(candidate);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80:') ||
    lower.startsWith('ff')
  );
}
