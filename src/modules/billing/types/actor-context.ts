import type { ActorKind } from '../entities/credit-ledger.entity';

/**
 * Identity + provenance for any financial mutation. Captured by
 * `LedgerService.append` and `LedgerService.shadowAppend` and
 * persisted into the ledger row's `actor_*` columns.
 *
 * - `ADMIN`: a human admin acting through the SPA. `userId` is the
 *   admin's auth user id; `ip` / `userAgent` come off the request.
 * - `SYSTEM`: an in-process trigger (e.g., `BillingChargeService` per-
 *   event deduction). No user id; `requestId` propagates from the
 *   originating HTTP call when possible.
 * - `WEBHOOK`: a Stripe-driven write (refund refunded, payment intent
 *   succeeded). `requestId` is the Stripe event id.
 * - `USER`: an end-user action that mutates ledger directly. Rare —
 *   reserved for future flows like user-initiated bonus claims.
 */
export interface ActorContext {
  kind: ActorKind;
  userId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}
