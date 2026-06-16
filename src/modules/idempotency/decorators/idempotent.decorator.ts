import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_SCOPE_KEY = 'idempotency:scope';

/**
 * Mark a controller method as idempotency-aware. The interceptor
 * reads this metadata to know the scope under which to dedupe.
 *
 * Usage:
 *   @Idempotent('batch.jobs.create')
 *   @Post('jobs')
 *   async createJob(...) { ... }
 *
 * A request with no `Idempotency-Key` header passes through unchanged —
 * the header is opt-in. Once supplied, the interceptor handles lookup,
 * the 409-on-mismatch, and persistence of the response.
 */
export const Idempotent = (scope: string) => SetMetadata(IDEMPOTENT_SCOPE_KEY, scope);
