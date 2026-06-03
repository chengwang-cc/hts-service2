import { Injectable, Logger, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap, catchError } from 'rxjs';
import type { Request, Response } from 'express';
import { QueueService } from '../../queue/queue.service';
import { getPerCallBaselineUsd } from '../../billing/config/per-call-pricing.config';
import type { RequestAttribution } from '../types';

/**
 * Records one api_usage_metrics row per request via the 'api-usage-record'
 * pg-boss queue. Fire-and-forget on the response path — never blocks the
 * user, never throws.
 *
 * Failures to enqueue are logged at debug; they don't surface to the route
 * handler. The interceptor is best-effort observability, not an auth gate.
 */
export const API_USAGE_RECORD_QUEUE = 'api-usage-record';

export interface ApiUsageRecordJob {
  partnerId: string | null;
  partnerUserId: string | null;
  apiKeyId: string | null;
  organizationId: string | null;
  attributionSource: string | null;
  origin: string | null;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  requestSizeBytes: number | null;
  responseSizeBytes: number | null;
  clientIp: string | null;
  userAgent: string | null;
  errorMessage: string | null;
  htsCode: string | null;
  countryCode: string | null;
  costUsd: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  contextLabel: string | null;
  timestamp: string; // ISO
}

/** Allowlist for X-HTS-Context header values. */
const ALLOWED_CONTEXT_LABELS = new Set(['checkout', 'fulfillment', 'search-ui', 'other']);

@Injectable()
export class UsageRecordingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageRecordingInterceptor.name);

  constructor(private readonly queue: QueueService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpCtx = ctx.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => this.record(req, res, start, null)),
      catchError((err) => {
        this.record(req, res, start, err?.message ?? String(err));
        throw err;
      }),
    );
  }

  private record(req: Request, res: Response, start: number, errorMessage: string | null): void {
    const attribution = req.attribution as RequestAttribution | undefined;
    const endpoint = this.resolveEndpoint(req);
    const method = req.method;

    // Cost: extras override (set by route handlers for AI / batch) wins;
    // otherwise fall back to the static per-call price book. Failed requests
    // (5xx) are not charged — partner shouldn't pay for our errors.
    const isServerError = res.statusCode >= 500;
    const extraCost = attribution?.extras?.costUsd;
    const baseCost = getPerCallBaselineUsd(method, endpoint);
    const costUsd = isServerError
      ? 0
      : typeof extraCost === 'number' && Number.isFinite(extraCost) && extraCost >= 0
        ? extraCost
        : baseCost;

    const payload: ApiUsageRecordJob = {
      partnerId: attribution?.partnerId || null,
      partnerUserId: attribution?.partnerUserId ?? null,
      apiKeyId: attribution?.apiKeyId ?? null,
      organizationId: attribution?.organizationId || null,
      attributionSource: attribution?.attributionSource ?? null,
      origin: attribution?.origin ?? null,
      endpoint,
      method,
      statusCode: res.statusCode,
      responseTimeMs: Date.now() - start,
      requestSizeBytes: this.intHeader(req, 'content-length'),
      responseSizeBytes: this.intHeader(res, 'content-length'),
      clientIp: this.resolveIp(req),
      userAgent: this.shortString(req.headers['user-agent'] as string | undefined, 500),
      errorMessage: this.shortString(errorMessage, 1000),
      htsCode: attribution?.extras?.htsCode ?? null,
      countryCode: attribution?.extras?.countryCode ?? null,
      costUsd,
      llmInputTokens: this.safeInt(attribution?.extras?.llmInputTokens),
      llmOutputTokens: this.safeInt(attribution?.extras?.llmOutputTokens),
      contextLabel: this.normalizeContextLabel(attribution?.extras?.contextLabel ?? null),
      timestamp: new Date().toISOString(),
    };

    // Fire-and-forget enqueue; we don't await the queue insert.
    this.queue.sendJob(API_USAGE_RECORD_QUEUE, payload as unknown as Record<string, any>).catch((err) =>
      this.logger.debug(`enqueue ${API_USAGE_RECORD_QUEUE} failed: ${err?.message ?? err}`),
    );
  }

  private safeInt(n: number | null | undefined): number {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  private normalizeContextLabel(label: string | null): string | null {
    if (!label) return null;
    const v = String(label).trim().toLowerCase();
    return ALLOWED_CONTEXT_LABELS.has(v) ? v : null;
  }

  private resolveEndpoint(req: Request): string {
    // Prefer the route template (e.g. '/api/v1/hts/:id') to avoid an explosion
    // of distinct endpoint strings from path-param cardinality.
    const route = (req as Request & { route?: { path?: string } }).route?.path;
    if (route) return route;
    // Fall back to the raw URL with query string stripped.
    const url = req.originalUrl ?? req.url ?? '';
    const q = url.indexOf('?');
    return q >= 0 ? url.slice(0, q) : url;
  }

  private resolveIp(req: Request): string | null {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0]?.trim() || null;
    if (Array.isArray(xff)) return xff[0]?.split(',')[0]?.trim() || null;
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }

  private intHeader(reqOrRes: { headers?: any; getHeader?: (n: string) => unknown }, name: string): number | null {
    const raw =
      typeof reqOrRes.getHeader === 'function'
        ? reqOrRes.getHeader(name)
        : reqOrRes.headers?.[name];
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  private shortString(s: string | null | undefined, max: number): string | null {
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }
}
