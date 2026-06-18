/**
 * Per-call baseline cost in USD, charged to the partner regardless of
 * downstream AI/embedding cost. AI cost (Anthropic/OpenAI) is layered on
 * top by route handlers writing into req.attribution.extras.costUsd.
 *
 * Initial price book is conservative:
 *   - Pure DB reads (lookup, autocomplete, hierarchy) = $0
 *   - Embedding-backed search                          = $0.0005
 *   - Calculator (one item)                            = $0.001
 *
 * Numbers align with OVERAGE_RATES in plans.config.ts so overage charges
 * are coherent with per-call cost.
 */

export interface RouteKey {
  method: string;
  /** Route template after NestJS resolution, e.g. '/api/v1/hts/lookup'. */
  path: string;
}

interface PriceEntry {
  /** Cost per call when the route is hit once. */
  baseUsd: number;
  /**
   * Optional multiplier read off the request payload (only used by batch
   * endpoints). The interceptor doesn't have the payload; the route handler
   * must update req.attribution.extras.costUsd for batch operations.
   */
  perItemUsd?: number;
}

/**
 * Match path AFTER NestJS resolves @Controller prefixes. We do NOT include
 * query strings here — interceptor strips them before lookup.
 *
 * Key format: `${METHOD} ${path}`.
 */
const PRICE_BOOK: Readonly<Record<string, PriceEntry>> = Object.freeze({
  // HTS lookup — DB reads
  'GET /api/v1/hts/lookup': { baseUsd: 0 },
  'GET /api/v1/hts/autocomplete': { baseUsd: 0 },
  'GET /api/v1/hts/hierarchy': { baseUsd: 0 },

  // HTS search — uses embeddings
  'GET /api/v1/hts/search': { baseUsd: 0.0005 },

  // HTS batch lookup — per-code multiplier set by route handler
  'POST /api/v1/hts/lookup/batch': { baseUsd: 0, perItemUsd: 0 },

  // HTS async batch classification — per-item multiplier set by route handler.
  // deep_search items are embedding-backed (priced like GET search);
  // autocomplete items are free DB reads and charged $0 by the handler.
  'POST /api/v1/hts/batch': { baseUsd: 0, perItemUsd: 0.0005 },

  // Internal/SPA-facing lookup endpoints (hts.proto.com hits these directly).
  // Same downstream cost as the api/v1 variants — keeping them priced means
  // the dashboard reflects real backend cost regardless of which surface
  // the partner used.
  'POST /lookup/search': { baseUsd: 0.0005 },
  'POST /lookup/smart-classify': { baseUsd: 0.0005 },
  // Async smart-classify: 202 baseline row covers serving + queue overhead.
  // LlmUsageRecordingService writes a 2nd row from the worker with the
  // actual OpenAI rerank cost (the heavy part of the 5-30s pipeline).
  'POST /lookup/smart-classify-async': { baseUsd: 0.001 },
  'GET /lookup/autocomplete': { baseUsd: 0 },
  'GET /lookup/hts/:htsNumber': { baseUsd: 0 },
  'GET /lookup/hts/:htsNumber/notes': { baseUsd: 0 },

  // Calculator — single
  'POST /api/v1/calculator/calculate': { baseUsd: 0.001 },

  // Calculator — batch (multiplier applied by route handler)
  'POST /api/v1/calculator/calculate/batch': { baseUsd: 0, perItemUsd: 0.001 },
});

/**
 * Resolve baseline cost for a (method, path) pair. Returns 0 when route is
 * not in the price book — unknown routes are free, so adding a new route
 * doesn't accidentally start charging.
 */
export function getPerCallBaselineUsd(method: string, path: string): number {
  const key = `${method.toUpperCase()} ${path}`;
  return PRICE_BOOK[key]?.baseUsd ?? 0;
}

/**
 * Per-item cost (for batch endpoints). The interceptor doesn't know the
 * payload size, so route handlers that accept arrays should compute
 * `getPerItemUsd(method, path) * items.length` and assign it to
 * req.attribution.extras.costUsd.
 */
export function getPerItemUsd(method: string, path: string): number {
  const key = `${method.toUpperCase()} ${path}`;
  return PRICE_BOOK[key]?.perItemUsd ?? 0;
}
