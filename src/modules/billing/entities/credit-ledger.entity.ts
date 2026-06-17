import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only ledger row representing one credit movement against an
 * organization's balance. Source of truth for every credit purchase,
 * auto-topup refill, per-event consumption, refund, chargeback, and
 * admin-issued manual adjustment.
 *
 * Append-only is enforced by a DB trigger (see the migration) — UPDATE
 * and DELETE both throw. Corrections are forward-posted as new rows
 * (kind=REVERSAL) referencing the original via reference_id.
 *
 * `balance_after` is a snapshot of the post-write balance, used by the
 * reconciliation cron to detect drift between the ledger sum and the
 * materialized `credit_balances.balance`. The materialization happens
 * in the same DB transaction as the ledger insert.
 *
 * Phase 1, PR F1.1 of the financial management rollout. See
 * docs/2026-06-17/0747_financial-management-execution-plan.md §2.1.
 */
export type CreditLedgerKind =
  | 'PURCHASE'
  | 'AUTO_TOPUP'
  | 'USAGE_DEBIT'
  | 'MANUAL_TOPUP'
  | 'MANUAL_DEBIT'
  | 'REFUND'
  | 'CHARGEBACK'
  | 'REVERSAL'
  | 'EXPIRY'
  | 'PROMO';

export type ActorKind = 'ADMIN' | 'SYSTEM' | 'WEBHOOK' | 'USER';

export type TaxTreatment =
  | 'TAXED_AT_PURCHASE'
  | 'TAXED_AT_REDEMPTION'
  | 'NON_TAXABLE_PROMO';

@Entity('credit_ledger')
@Index(['organizationId', 'createdAt'])
@Index(['kind', 'createdAt'])
@Index(['stripeBalanceTransactionId'])
@Index(['idempotencyKey'], { unique: true })
@Index(['referenceType', 'referenceId'])
export class CreditLedgerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  /** Signed: positive grants credits, negative debits credits. */
  @Column('int', { name: 'delta_credits' })
  deltaCredits: number;

  /**
   * Balance AFTER this row's delta. Captured for drift detection — the
   * reconciliation cron asserts that `credit_balances.balance` equals
   * the most recent ledger row's `balance_after` per organization.
   */
  @Column('int', { name: 'balance_after' })
  balanceAfter: number;

  @Column('varchar', { length: 32 })
  kind: CreditLedgerKind;

  /** Required for MANUAL_TOPUP / MANUAL_DEBIT; null for SYSTEM/WEBHOOK kinds. */
  @Column('varchar', { length: 64, name: 'reason_code', nullable: true })
  reasonCode: string | null;

  /** Admin's free-text note. Surfaced in the Financial admin tab. */
  @Column('text', { name: 'internal_note', nullable: true })
  internalNote: string | null;

  /** Logical type of the linked object (e.g. 'stripe_payment_intent'). */
  @Column('varchar', { length: 64, name: 'reference_type', nullable: true })
  referenceType: string | null;

  /** The linked object's id (e.g. 'pi_3Tk...'). */
  @Column('varchar', { length: 255, name: 'reference_id', nullable: true })
  referenceId: string | null;

  /**
   * Canonical Stripe reconciliation join key — every Stripe charge,
   * refund, payout, dispute, or fee is reified as a balance_transaction
   * with id=txn_*. The reconciliation cron joins on this column.
   */
  @Column('varchar', { length: 64, name: 'stripe_balance_transaction_id', nullable: true })
  stripeBalanceTransactionId: string | null;

  @Column('varchar', { length: 64, name: 'stripe_charge_id', nullable: true })
  stripeChargeId: string | null;

  // ── Money (multi-currency-ready, USD default) ─────────────────────
  // Money is always integer minor units (cents), never decimal dollars.

  @Column('char', { length: 3, default: 'USD' })
  currency: string;

  @Column('bigint', { name: 'amount_minor_units', nullable: true })
  amountMinorUnits: string | null; // bigint → string in TypeORM

  @Column('decimal', {
    precision: 18,
    scale: 8,
    name: 'fx_rate_to_functional',
    default: 1.0,
  })
  fxRateToFunctional: string;

  @Column('varchar', { length: 64, name: 'fx_rate_source', nullable: true })
  fxRateSource: string | null;

  @Column('timestamp', { name: 'fx_rate_captured_at', nullable: true })
  fxRateCapturedAt: Date | null;

  @Column('bigint', { name: 'amount_functional_minor_units', nullable: true })
  amountFunctionalMinorUnits: string | null;

  @Column('varchar', { length: 32, name: 'tax_treatment', default: 'NON_TAXABLE_PROMO' })
  taxTreatment: TaxTreatment;

  // ── Actor capture (immutable audit) ───────────────────────────────

  @Column('varchar', { length: 16, name: 'actor_kind' })
  actorKind: ActorKind;

  @Column('uuid', { name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  @Column('inet', { name: 'actor_ip', nullable: true })
  actorIp: string | null;

  @Column('text', { name: 'actor_user_agent', nullable: true })
  actorUserAgent: string | null;

  @Column('varchar', { length: 64, name: 'request_id', nullable: true })
  requestId: string | null;

  // ── Idempotency (unique when set) ─────────────────────────────────

  @Column('varchar', { length: 255, name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  @Column('jsonb', { default: () => `'{}'::jsonb` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
