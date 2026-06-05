import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import { normaliseModelName } from '../../billing/config/llm-pricing.config';
import type { LlmAggregatedUsage } from '../../../core/services/llm-usage-tracker';
import {
  API_USAGE_RECORD_QUEUE,
  type ApiUsageRecordJob,
} from '../interceptors/usage-recording.interceptor';

/**
 * Counterpart to UsageRecordingInterceptor for paths that don't go
 * through an HTTP request.
 *
 * Why this exists
 * ---------------
 *   The interceptor sits on every controller invocation and reads
 *   `req.attribution` to know who to bill. But the async LLM pipeline
 *   (smart-classify, vision, agent jobs) is enqueued by an HTTP request
 *   that finishes immediately with 202 + jobId — the actual model call
 *   runs in a pg-boss worker tens of seconds later, with no `req`
 *   anywhere in sight.
 *
 *   The worker still knows who to bill (the job payload carries the
 *   attribution snapshot) and what it spent (the LlmUsageTracker scope
 *   it opened around its model calls). This service is the bridge from
 *   that knowledge to an api_usage_metrics row.
 *
 * Two-row model for async work
 * ----------------------------
 *   POST /lookup/smart-classify-async      ← 202 row, baseline cost only
 *   (pg-boss handler runs)                  ← THIS service writes a 2nd
 *                                              row tagged with
 *                                              llmPipelineStage = the
 *                                              stage and the full LLM
 *                                              cost from the tracker
 *
 *   Both rows carry the same partnerId/endpoint, so partner totals are
 *   correct. Dashboards filter on llmPipelineStage to separate the
 *   "API call" row from the "AI cost" row.
 *
 * Enqueues the same 'api-usage-record' queue the interceptor uses, so
 * there's exactly one writer to api_usage_metrics — no risk of two
 * code paths drifting in how they coerce / clamp values.
 */
export interface AsyncUsageContext {
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
  errorMessage?: string | null;
  htsCode?: string | null;
  countryCode?: string | null;
  contextLabel?: string | null;
  /** Pipeline stage name — set so the row is distinguishable from
   *  the synchronous 202 row written by the controller. */
  pipelineStage: string;
}

@Injectable()
export class LlmUsageRecordingService {
  private readonly logger = new Logger(LlmUsageRecordingService.name);

  constructor(private readonly queue: QueueService) {}

  /**
   * Record an LLM-cost row attributed to the given async context. Pass
   * the aggregated usage from `llmUsageTracker.openScope`/`withTracking`.
   *
   * Cost recorded is purely the LLM provider pass-through — the baseline
   * per-call cost is owned by the synchronous controller row (which
   * already covered serving infra). No clamp on extras.costUsd here
   * because the tracker is the source of truth for async cost.
   *
   * Fire-and-forget: never throws, never blocks the caller. Failures
   * to enqueue are logged at debug.
   */
  async recordAsyncLlmCost(
    ctx: AsyncUsageContext,
    usage: LlmAggregatedUsage,
  ): Promise<void> {
    if (!ctx.organizationId && !ctx.partnerId) {
      this.logger.debug(
        `Dropping async usage row with no org/partner: endpoint=${ctx.endpoint} stage=${ctx.pipelineStage}`,
      );
      return;
    }
    if (usage.totalCalls === 0) {
      // Nothing actually happened in the tracker scope; don't insert
      // an empty row. Dashboards would treat zero-cost zero-token rows
      // as noise.
      return;
    }

    const payload: ApiUsageRecordJob = {
      partnerId: ctx.partnerId,
      partnerUserId: ctx.partnerUserId,
      apiKeyId: ctx.apiKeyId,
      organizationId: ctx.organizationId,
      attributionSource: ctx.attributionSource,
      origin: ctx.origin,
      endpoint: ctx.endpoint,
      method: ctx.method,
      statusCode: ctx.statusCode,
      responseTimeMs: ctx.responseTimeMs,
      requestSizeBytes: null,
      responseSizeBytes: null,
      clientIp: null,
      userAgent: null,
      errorMessage: ctx.errorMessage ?? null,
      htsCode: ctx.htsCode ?? null,
      countryCode: ctx.countryCode ?? null,
      costUsd: usage.costUsd,
      llmInputTokens: usage.inputTokens,
      llmOutputTokens: usage.outputTokens,
      llmCachedTokens: usage.cachedTokens,
      modelName: usage.primaryModel ? normaliseModelName(usage.primaryModel) : null,
      llmPipelineStage: ctx.pipelineStage,
      contextLabel: ctx.contextLabel ?? null,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.queue.sendJob(
        API_USAGE_RECORD_QUEUE,
        payload as unknown as Record<string, any>,
      );
    } catch (err) {
      this.logger.debug(
        `enqueue ${API_USAGE_RECORD_QUEUE} (async stage=${ctx.pipelineStage}) failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
