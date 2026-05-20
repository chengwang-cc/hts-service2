import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 1 of the Shopify refactor (see docs/2026-05-19/1345_phase-1-shopify-refactor.md).
 *
 * Replaces the 3-valued `duty_display_mode` ('ddu' | 'ddp' | 'disabled')
 * with two booleans:
 *   - `calculate_duty`      — run the duty/tax calculation on order events
 *   - `display_at_checkout` — surface the calc to the buyer in the extension
 *
 * Additive + idempotent. The legacy `duty_display_mode` column is RETAINED
 * for one release as a rollback safety net; it will be dropped in a
 * follow-up migration after the checkout extension is redeployed.
 *
 * Backfill semantics:
 *   - 'ddu' | 'ddp'  → calculate=true,  display=true  (preserves behavior)
 *   - 'disabled'     → calculate=false, display=false (preserves behavior)
 *   - anything else  → both default to true (matches new-shop default)
 *
 * NOTE: hand-written (dev DB at 192.168.1.209 unreachable when this was
 * authored, so scripts/generate-migration.sh could not run). Matches the
 * style of 1778866546902-add-classification-source.ts which was similarly
 * hand-trimmed; reviewers should confirm parity with the entity diff.
 */
export class ShopifySettingsBoolFlags1779223672000 implements MigrationInterface {
    name = 'ShopifySettingsBoolFlags1779223672000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "shopify_sessions" ADD COLUMN IF NOT EXISTS "calculate_duty" boolean NOT NULL DEFAULT true`,
        );
        await queryRunner.query(
            `ALTER TABLE "shopify_sessions" ADD COLUMN IF NOT EXISTS "display_at_checkout" boolean NOT NULL DEFAULT true`,
        );

        // Backfill from existing duty_display_mode values. Only rows whose
        // current behavior differs from the new defaults need updating.
        await queryRunner.query(
            `UPDATE "shopify_sessions"
             SET "calculate_duty" = false,
                 "display_at_checkout" = false
             WHERE "duty_display_mode" = 'disabled'`,
        );
        // 'ddu' and 'ddp' rows already match the new (true, true) defaults —
        // no UPDATE needed.
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "shopify_sessions" DROP COLUMN IF EXISTS "display_at_checkout"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shopify_sessions" DROP COLUMN IF EXISTS "calculate_duty"`,
        );
    }

}
