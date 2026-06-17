import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per detected discrepancy between Stripe's balance
 * transactions and our credit_ledger for a given run.
 *
 * Kinds
 * -----
 *   ORPHAN_STRIPE   — Stripe has a balance_transaction we don't.
 *                     stripe_balance_transaction_id populated;
 *                     hts_ledger_id null.
 *   ORPHAN_HTS      — HTS has a PURCHASE/REFUND/CHARGEBACK/AUTO_TOPUP
 *                     row without stripe_balance_transaction_id.
 *                     hts_ledger_id populated; stripe_btxn_id null.
 *   AMOUNT_MISMATCH — Both sides have the txn, but the amounts differ.
 *                     Both ids populated; details.expected/actual show
 *                     the magnitude.
 *   SUM_MISMATCH    — Group-by-kind aggregate doesn't match between
 *                     the two systems. Used as a fallback when row-
 *                     level joins are clean but totals don't add up
 *                     (e.g., a column got truncated).
 *
 * Resolution
 * ----------
 * An admin can mark a row resolved with a note. The row STAYS — we never
 * delete from this table. `resolved_at` + `resolution_note` form the
 * audit trail. Resolution doesn't fix the underlying data; it just
 * marks "ops looked at this and decided X."
 */
export type ReconciliationMismatchKind =
  | 'ORPHAN_STRIPE'
  | 'ORPHAN_HTS'
  | 'AMOUNT_MISMATCH'
  | 'SUM_MISMATCH';

@Entity('reconciliation_mismatches')
@Index(['runId', 'kind'])
@Index(['resolvedAt'])
@Index(['stripeBalanceTransactionId'])
@Index(['htsLedgerId'])
export class ReconciliationMismatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'run_id' })
  runId: string;

  @Column('varchar', { length: 64 })
  kind: ReconciliationMismatchKind;

  @Column('varchar', {
    length: 64,
    name: 'stripe_balance_transaction_id',
    nullable: true,
  })
  stripeBalanceTransactionId: string | null;

  @Column('uuid', { name: 'hts_ledger_id', nullable: true })
  htsLedgerId: string | null;

  /**
   * Free-form bag. Keys we set today:
   *   expectedMinorUnits, actualMinorUnits, deltaMinorUnits — for
   *     AMOUNT_MISMATCH
   *   stripeType                                            — Stripe's
   *     balance_transaction.type (e.g. 'charge', 'refund')
   *   stripeCreated, htsCreated                             — both
   *     timestamps for drift comparison
   *   ledgerKind                                            — when
   *     hts_ledger_id is set
   *   groupKey                                              — for
   *     SUM_MISMATCH (the kind we grouped by)
   */
  @Column('jsonb', { default: () => `'{}'::jsonb` })
  details: Record<string, unknown>;

  @Column('timestamp', { name: 'resolved_at', nullable: true })
  resolvedAt: Date | null;

  @Column('uuid', { name: 'resolved_by_user_id', nullable: true })
  resolvedByUserId: string | null;

  @Column('text', { name: 'resolution_note', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
