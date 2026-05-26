import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

export interface OutboundHttpPolicyContext {
  tenantId?: string;
  adapterId?: string;
  provider?: string;
  timeoutMs?: number;
  allowedHosts?: string[];
}

@Injectable()
export class OutboundHttpPolicyService {
  private readonly logger = new Logger(OutboundHttpPolicyService.name);

  async fetch(
    rawUrl: string,
    init: RequestInit,
    context: OutboundHttpPolicyContext = {},
  ): Promise<Response> {
    const url = await this.assertAllowed(rawUrl, context);
    const timeoutMs = Math.min(
      60_000,
      Math.max(1_000, context.timeoutMs ?? 10_000),
    );
    return fetch(url.toString(), {
      ...init,
      redirect: 'manual',
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  }

  async assertAllowed(
    rawUrl: string,
    context: OutboundHttpPolicyContext = {},
  ): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Adapter URL is invalid');
    }

    if (url.protocol !== 'https:') {
      this.logBlocked(url, context, 'scheme_not_https');
      throw new BadRequestException('Adapter URL must use HTTPS');
    }

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === 'metadata.google.internal'
    ) {
      this.logBlocked(url, context, 'blocked_hostname');
      throw new BadRequestException('Adapter URL host is not allowed');
    }

    if (context.allowedHosts?.length) {
      const allowed = new Set(
        context.allowedHosts.map((host) => host.toLowerCase()),
      );
      if (!allowed.has(hostname)) {
        this.logBlocked(url, context, 'host_not_allowlisted');
        throw new BadRequestException('Adapter URL host is not allowlisted');
      }
    }

    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: false });
    if (!addresses.length) {
      this.logBlocked(url, context, 'dns_no_records');
      throw new BadRequestException('Adapter URL host has no DNS records');
    }
    for (const record of addresses) {
      if (isBlockedIp(record.address)) {
        this.logBlocked(url, context, `blocked_ip:${record.address}`);
        throw new BadRequestException('Adapter URL resolves to a blocked IP');
      }
    }

    return url;
  }

  private logBlocked(
    url: URL,
    context: OutboundHttpPolicyContext,
    reason: string,
  ): void {
    this.logger.warn(
      `Blocked outbound adapter request tenant=${context.tenantId ?? '-'} adapter=${context.adapterId ?? '-'} provider=${context.provider ?? '-'} host=${url.hostname} reason=${reason}`,
    );
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
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
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
