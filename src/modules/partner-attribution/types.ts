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
   * Route handlers can stash endpoint-specific fields here for the
   * UsageRecordingInterceptor to read on response (e.g. hts code + country
   * for calculator routes).
   */
  extras: {
    htsCode?: string | null;
    countryCode?: string | null;
  };
}

declare module 'express' {
  interface Request {
    attribution?: RequestAttribution;
  }
}
