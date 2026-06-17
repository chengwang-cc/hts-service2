import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per execution of the nightly reconciliation job. Audit log
 * of every comparison between Stripe's balance transactions and our
 * credit_ledger.
 *
 * Phase 6 of the financial management rollout (PR F6.1).
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §10
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §7.1
 *
 * Lifecycle
 * ---------
 *   1. Worker fires at 02:00 UTC → INSERT a row with status='RUNNING',
 *      started_at=now(). This row is the cursor so concurrent runs
 *      (via singletonKey) can be detected.
 *   2. Job walks Stripe + ledger, accumulating mismatches.
 *   3. Final UPDATE sets:
 *        - events_checked: total Stripe btxns examined
 *        - mismatches: count of reconciliation_mismatches rows written
 *        - drift_amount_minor_units: signed sum of drift across all
 *          AMOUNT_MISMATCH rows. Negative = HTS undercounted Stripe.
 *        - status: 'OK' (0 mismatches), 'DRIFT_DETECTED' (>0), or
 *          'FAILED' (job threw)
 *        - finished_at + (on failure) error_message
 *
 * `as_of_date` is the DATE the run reconciled. Day boundaries are UTC,
 * matching Stripe's internal accounting cutoff so we don't double-
 * count edge transactions when DST shifts.
 *
 * Indexed on (as_of_date DESC) so the admin UI's "last 30 days" view
 * is cheap. UNIQUE on (as_of_date) so manual re-runs reuse the row
 * instead of creating duplicates — operationally, "run today again"
 * should produce ONE truth row, not a history of attempts.
 */
export type ReconciliationStatus = 'RUNNING' | 'OK' | 'DRIFT_DETECTED' | 'FAILED';

@Entity('reconciliation_runs')
@Index(['asOfDate'], { unique: true })
@Index(['status', 'asOfDate'])
export class ReconciliationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The DATE that this run reconciled. Stored as a DATE (not TIMESTAMP)
   * so the UNIQUE constraint is at the natural day-granularity.
   */
  @Column('date', { name: 'as_of_date' })
  asOfDate: string;

  @Column('int', { name: 'events_checked', default: 0 })
  eventsChecked: number;

  @Column('int', { default: 0 })
  mismatches: number;

  /**
   * Signed signed delta across AMOUNT_MISMATCH rows in this run.
   * `bigint` for safety against the (unlikely) overflow of a 24h window.
   */
  @Column('bigint', { name: 'drift_amount_minor_units', nullable: true })
  driftAmountMinorUnits: string | null;

  @Column('varchar', { length: 32, default: 'RUNNING' })
  status: ReconciliationStatus;

  @Column('timestamp', { name: 'started_at', default: () => 'now()' })
  startedAt: Date;

  @Column('timestamp', { name: 'finished_at', nullable: true })
  finishedAt: Date | null;

  @Column('text', { name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
