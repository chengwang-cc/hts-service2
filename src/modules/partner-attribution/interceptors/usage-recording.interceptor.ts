import { Injectable, Logger, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, from, tap, catchError, switchMap } from 'rxjs';
import type { Request, Response } from 'express';
import { QueueService } from '../../queue/queue.service';
import { getPerCallBaselineUsd } from '../../billing/config/per-call-pricing.config';
import { llmUsageTracker } from '../../../core/services/llm-usage-tracker';
import { normaliseModelName } from '../../billing/config/llm-pricing.config';
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
  llmCachedTokens: number;
  modelName: string | null;
  llmPipelineStage: string | null;
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

    // Open an LLM-usage scope that spans the route handler's async tree.
    // Any OpenAI / Anthropic call made during the request lands here.
    // We can't use `withTracking(promise)` because next.handle() returns
    // an Observable — we want the scope ACTIVE while the handler runs,
    // not just for the promise wrapper.
    const { handle, result } = llmUsageTracker.openScope(() => next.handle());
    return result.pipe(
      tap(() => this.record(req, res, start, null, handle.aggregate())),
      catchError((err) => {
        this.record(req, res, start, err?.message ?? String(err), handle.aggregate());
        throw err;
      }),
    );
  }

  private record(
    req: Request,
    res: Response,
    start: number,
    errorMessage: string | null,
    llmUsage: ReturnType<typeof llmUsageTracker.openScope>['handle'] extends {
      aggregate: () => infer U;
    }
      ? U
      : never,
  ): void {
    const attribution = req.attribution as RequestAttribution | undefined;
    const endpoint = this.resolveEndpoint(req);
    const method = req.method;

    // LLM usage merge precedence
    // --------------------------
    //   1. extras.<field>  — explicit value set by the route handler
    //                         (kept for handlers that compute their own
    //                         numbers without going through OpenAiService)
    //   2. llmUsage.<field> — aggregated from the tracker scope
    //                          (the common path — OpenAI / Anthropic
    //                          services push records into the scope
    //                          automatically)
    //
    // Same precedence for `costUsd`. When neither is present, fall back
    // to the static per-call baseline.
    const extras = attribution?.extras;
    const isServerError = res.statusCode >= 500;
    const extraCost = extras?.costUsd;
    const trackerCost = llmUsage?.costUsd ?? 0;
    const baseCost = getPerCallBaselineUsd(method, endpoint);
    const costUsd = isServerError
      ? 0
      : typeof extraCost === 'number' && Number.isFinite(extraCost) && extraCost >= 0
        ? extraCost
        // Tracker cost is *additional* to the baseline — the baseline
        // covers infra/serving, the tracker cost covers provider pass-
        // through. Sum them so the partner sees the real number.
        : baseCost + trackerCost;

    const llmInputTokens =
      this.safeInt(extras?.llmInputTokens) || this.safeInt(llmUsage?.inputTokens);
    const llmOutputTokens =
      this.safeInt(extras?.llmOutputTokens) || this.safeInt(llmUsage?.outputTokens);
    const llmCachedTokens =
      this.safeInt(extras?.llmCachedTokens) || this.safeInt(llmUsage?.cachedTokens);
    const rawModel =
      extras?.modelName ?? (llmUsage?.primaryModel ?? null);
    const modelName = rawModel ? normaliseModelName(rawModel) : null;
    const llmPipelineStage =
      extras?.llmPipelineStage ?? (llmUsage?.primaryStage ?? null);

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
      htsCode: extras?.htsCode ?? null,
      countryCode: extras?.countryCode ?? null,
      costUsd,
      llmInputTokens,
      llmOutputTokens,
      llmCachedTokens,
      modelName,
      llmPipelineStage: this.shortString(llmPipelineStage, 64),
      contextLabel: this.normalizeContextLabel(extras?.contextLabel ?? null),
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
