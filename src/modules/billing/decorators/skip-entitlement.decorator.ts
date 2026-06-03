import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route (method or controller) as exempt from EntitlementGuard's
 * monthly-quota enforcement. Use sparingly:
 *
 *   - Health checks                                     (correctness > quota)
 *   - Admin/back-office endpoints                       (internal traffic)
 *   - Free-forever endpoints (e.g., status, pricing)    (no quota concept)
 *
 * Per-request rate limits and per-request usage recording still apply.
 */
export const SKIP_ENTITLEMENT_KEY = 'skip-entitlement';
export const SkipEntitlement = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ENTITLEMENT_KEY, true);
