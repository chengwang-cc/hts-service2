import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Stripe refund mirror + internal state machine.
 *
 * One row per Stripe refund object. The flow:
 *
 *   1. Admin posts to /admin/financial/.../refunds → we INSERT this
 *      row with status='pending', no stripe_refund_id yet, then call
 *      stripe.refunds.create with our idempotency key forwarded to
 *      Stripe (so a retry doesn't create two refunds).
 *   2. Stripe returns the refund object → we UPDATE
 *      stripe_refund_id + stripe_balance_transaction_id (if expanded).
 *   3. Webhook drives the rest:
 *      - refund.created   → no-op (we already wrote the row above)
 *      - refund.updated   → state machine: pending → succeeded / failed
 *      - refund.failed    → write reversal_ledger_entry_id (Phase 1's
 *        REVERSAL kind), surface for ops to review
 *
 * `ledger_entry_id` is the FK to the credit_ledger row that debited
 * the org's balance. NULL until refund.updated{status=succeeded}
 * lands; populated atomically with the LedgerService.append call.
 *
 * `reversal_ledger_entry_id` is set if a previously-posted REFUND
 * ledger row needs to be undone (e.g., Stripe later reports the
 * refund failed after we had already adjusted the balance).
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §8
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §5.1
 */
export type RefundStatus =
  | 'pending'           // we wrote the row but haven't heard from Stripe yet
  | 'requires_action'   // 3DS / SCA challenge from Stripe
  | 'succeeded'         // funds returned to source
  | 'failed'            // Stripe refused or reversed; manual review needed
  | 'canceled';         // admin canceled before settlement

export type RefundReason =
  | 'duplicate'              // Stripe-spec value
  | 'fraudulent'             // Stripe-spec value
  | 'requested_by_customer'; // Stripe-spec value

@Entity('refunds')
@Index(['organizationId', 'createdAt'])
@Index(['status', 'createdAt'])
@Index(['stripeRefundId'], { unique: true, where: 'stripe_refund_id IS NOT NULL' })
@Index(['idempotencyKey'], { unique: true, where: 'idempotency_key IS NOT NULL' })
export class RefundEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  /** Source of the original charge. Required — we never refund without one. */
  @Column('varchar', { length: 64, name: 'original_payment_intent_id' })
  originalPaymentIntentId: string;

  /** Stripe `ch_*` id, populated from the payment intent on creation. */
  @Column('varchar', { length: 64, name: 'original_charge_id', nullable: true })
  originalChargeId: string | null;

  /** Set on Stripe API success. NULL while the row is pending. */
  @Column('varchar', { length: 64, name: 'stripe_refund_id', nullable: true })
  stripeRefundId: string | null;

  /** Canonical reconciliation join key — populated when webhook expands `balance_transaction`. */
  @Column('varchar', { length: 64, name: 'stripe_balance_transaction_id', nullable: true })
  stripeBalanceTransactionId: string | null;

  /** Stripe-side amount in minor units. We always store amount_minor_units, never decimal dollars. */
  @Column('bigint', { name: 'amount_minor_units' })
  amountMinorUnits: string;

  @Column('char', { length: 3, default: 'USD' })
  currency: string;

  @Column('varchar', { length: 32 })
  reason: RefundReason;

  @Column('text', { name: 'internal_note', nullable: true })
  internalNote: string | null;

  @Column('varchar', { length: 32, default: 'pending' })
  status: RefundStatus;

  @Column('varchar', { length: 128, name: 'failure_reason', nullable: true })
  failureReason: string | null;

  /**
   * Credits this refund returns to the org's balance. For credit
   * purchases, this is the tier mapped from `amount_minor_units` (e.g.,
   * $20.00 → 50 credits). For non-credit refunds (subscription
   * prorations etc.) this stays 0.
   */
  @Column('int', { name: 'credits_returned', default: 0 })
  creditsReturned: number;

  /**
   * FK to the credit_ledger REFUND row that debited the org's
   * balance. Set on refund.updated{status=succeeded}; NULL until then.
   */
  @Column('uuid', { name: 'ledger_entry_id', nullable: true })
  ledgerEntryId: string | null;

  /**
   * FK to a forward-posted REVERSAL ledger row that undoes a prior
   * REFUND row. Set when refund.failed arrives AFTER we had already
   * posted the REFUND entry (a Stripe race we have to handle).
   */
  @Column('uuid', { name: 'reversal_ledger_entry_id', nullable: true })
  reversalLedgerEntryId: string | null;

  // Actor capture — required for ADMIN-initiated rows.
  @Column('uuid', { name: 'actor_user_id' })
  actorUserId: string;

  @Column('inet', { name: 'actor_ip', nullable: true })
  actorIp: string | null;

  @Column('text', { name: 'actor_user_agent', nullable: true })
  actorUserAgent: string | null;

  @Column('varchar', { length: 64, name: 'request_id', nullable: true })
  requestId: string | null;

  // Stripe-shape idempotency — required on the create endpoint.
  @Column('varchar', { length: 255, name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  @Column('jsonb', { default: () => `'{}'::jsonb` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
