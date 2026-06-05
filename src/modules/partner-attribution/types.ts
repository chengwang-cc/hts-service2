import type { AttributionSource } from '../api-keys/entities/api-usage-metric.entity';

/**
 * Resolved attribution attached to every request by AttributionMiddleware.
 * Read by UsageRecordingInterceptor and (optionally) route handlers that
 * want to scope responses by partner.
 */
export interface RequestAttribution {
  /** Always set — falls back to the 'unknown' sentinel partner row. */
  partnerId: string;
  /** Set when X-API-Key or X-Partner-Key resolved to a key. */
  apiKeyId: string | null;
  /** Convenience: same as partnerId for keyed requests. */
  organizationId: string;
  /** How partnerId was resolved. */
  attributionSource: AttributionSource;
  /** The Origin header as received (for forensics). */
  origin: string | null;
  /** Partner-asserted (or partner-JWT-verified) end-user id. */
  externalUserId: string | null;
  /** Resolved partner_users.id (set after upsert; may be null on first sight). */
  partnerUserId: string | null;
  /**
   * How the end-user identity was established:
   *   'verified' — JWT signed by the partner's shared secret, verified
   *   'asserted' — partner-supplied X-Partner-User-Id, untrusted
   *   null       — no end-user identity present
   */
  userIdentitySource: 'verified' | 'asserted' | null;
  /**
   * Route handlers can stash endpoint-specific fields here for the
   * UsageRecordingInterceptor to read on response (e.g. hts code + country
   * for calculator routes, AI-token cost for smart-classify).
   *
   * costUsd, when present, OVERRIDES the per-call baseline from
   * per-call-pricing.config. AI handlers should set it to
   * `baseline + providerCost`. Batch handlers should set it to
   * `perItemUsd * items.length` (interceptor can't see the payload).
   */
  extras: {
    htsCode?: string | null;
    countryCode?: string | null;
    costUsd?: number | null;
    llmInputTokens?: number | null;
    llmOutputTokens?: number | null;
    /**
     * Cached prompt tokens (OpenAI cached_tokens, Anthropic
     * cache_read_input_tokens). Subset of llmInputTokens.
     */
    llmCachedTokens?: number | null;
    /**
     * Primary model name for the request (highest-cost model when the
     * handler made calls against several). Normalised — snapshot
     * suffixes already stripped. Surfaces on the metrics row's
     * `model_name` column.
     */
    modelName?: string | null;
    /**
     * Pipeline stage tag for slicing dashboards by stage of the AI
     * pipeline (e.g. `smart-classify.rerank`).
     */
    llmPipelineStage?: string | null;
    contextLabel?: string | null;
  };
}

declare module 'express' {
  interface Request {
    attribution?: RequestAttribution;
  }
}
