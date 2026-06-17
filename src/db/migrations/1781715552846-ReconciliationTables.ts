import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciliation tables (Phase 6 of financial management, PR F6.1).
 *
 *   - reconciliation_runs        : one row per nightly run.
 *   - reconciliation_mismatches  : zero-or-more per run.
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §10
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §7.1
 *
 * Notes
 * -----
 * - VARCHAR (not pg ENUM) for status + kind, per project convention.
 * - UNIQUE(as_of_date) so a manual re-run UPSERTs rather than
 *   inserts a duplicate row for the same day.
 * - FK from mismatches → runs is enforced by application logic and the
 *   ON DELETE behavior; we use a plain UUID column to avoid TypeORM
 *   generating a relation hook we don't need.
 */
export class ReconciliationTables1781715552846 implements MigrationInterface {
  name = 'ReconciliationTables1781715552846';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reconciliation_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "as_of_date" date NOT NULL,
        "events_checked" integer NOT NULL DEFAULT 0,
        "mismatches" integer NOT NULL DEFAULT 0,
        "drift_amount_minor_units" bigint,
        "status" character varying(32) NOT NULL DEFAULT 'RUNNING',
        "started_at" TIMESTAMP NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMP,
        "error_message" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliation_runs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_reconciliation_runs_as_of_date"
        ON "reconciliation_runs" ("as_of_date")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reconciliation_runs_status_date"
        ON "reconciliation_runs" ("status", "as_of_date")
    `);

    await queryRunner.query(`
      CREATE TABLE "reconciliation_mismatches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid NOT NULL,
        "kind" character varying(64) NOT NULL,
        "stripe_balance_transaction_id" character varying(64),
        "hts_ledger_id" uuid,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "resolved_at" TIMESTAMP,
        "resolved_by_user_id" uuid,
        "resolution_note" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliation_mismatches_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_reconciliation_mismatches_run_kind"
        ON "reconciliation_mismatches" ("run_id", "kind")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reconciliation_mismatches_resolved_at"
        ON "reconciliation_mismatches" ("resolved_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reconciliation_mismatches_stripe_btxn"
        ON "reconciliation_mismatches" ("stripe_balance_transaction_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reconciliation_mismatches_hts_ledger"
        ON "reconciliation_mismatches" ("hts_ledger_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_reconciliation_mismatches_hts_ledger"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_reconciliation_mismatches_stripe_btxn"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_reconciliation_mismatches_resolved_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_reconciliation_mismatches_run_kind"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reconciliation_mismatches"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_reconciliation_runs_status_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_reconciliation_runs_as_of_date"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reconciliation_runs"`);
  }
}
