import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add `suspended_reason` to auto_topup_configs (Phase 7, PR F7.2).
 *
 * When LedgerService.append detects a balance crossing into negative
 * (before >= 0 && after < 0), it stamps this column 'negative_balance'.
 * AutoTopupService.maybeTrigger short-circuits when the column is
 * non-null, so we don't auto-charge a card whose owner is already
 * in arrears (likely a compromised card or other ops attention case).
 *
 * Cleared explicitly via:
 *   POST /admin/financial/organizations/:id/settle-arrears
 *     (charges Stripe for the deficit, posts MANUAL_TOPUP, clears
 *     the column on success)
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §11.3
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §8.2
 */
export class NegativeBalanceSuspension1781718078000
  implements MigrationInterface
{
  name = 'NegativeBalanceSuspension1781718078000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auto_topup_configs"
        ADD COLUMN IF NOT EXISTS "suspended_reason" character varying(64)
    `);
    // Partial index so the AutoTopupService.maybeTrigger scan stays
    // cheap as the table grows — only suspended rows are indexed.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auto_topup_suspended_reason"
        ON "auto_topup_configs" ("suspended_reason")
        WHERE "suspended_reason" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_auto_topup_suspended_reason"`,
    );
    await queryRunner.query(`
      ALTER TABLE "auto_topup_configs"
        DROP COLUMN IF EXISTS "suspended_reason"
    `);
  }
}
