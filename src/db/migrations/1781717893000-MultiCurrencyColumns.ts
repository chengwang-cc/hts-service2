import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-currency columns (Phase 7 of financial management, PR F7.1).
 *
 * Additive only — zero behavioral change in this PR. Adds the
 * money-shape columns the rest of the financial system already
 * uses internally:
 *
 *   credit_purchases:
 *     amount_minor_units, fx_rate_to_functional, fx_rate_source,
 *     fx_rate_captured_at, amount_functional_minor_units,
 *     stripe_balance_transaction_id
 *
 *   invoices:
 *     amount_minor_units, tax_amount_minor_units,
 *     stripe_balance_transaction_id
 *
 *   credit_balances:
 *     last_ledger_id  (drift detection anchor)
 *
 * Backfill: amount_minor_units = ROUND(amount * 100) for existing
 * rows so historical reports don't bifurcate by data shape.
 * amount_functional_minor_units = amount_minor_units (USD-only today).
 *
 * `currency` already exists on credit_purchases (default 'USD') —
 * no change needed there.
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §11
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §8.1
 */
export class MultiCurrencyColumns1781717893000 implements MigrationInterface {
  name = 'MultiCurrencyColumns1781717893000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── credit_purchases ────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "credit_purchases"
        ADD COLUMN IF NOT EXISTS "amount_minor_units" bigint,
        ADD COLUMN IF NOT EXISTS "fx_rate_to_functional" numeric(18,8) NOT NULL DEFAULT 1.0,
        ADD COLUMN IF NOT EXISTS "fx_rate_source" character varying(64),
        ADD COLUMN IF NOT EXISTS "fx_rate_captured_at" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "amount_functional_minor_units" bigint,
        ADD COLUMN IF NOT EXISTS "stripe_balance_transaction_id" character varying(64)
    `);

    // Backfill: amount_minor_units = ROUND(amount * 100) for existing
    // rows; amount_functional_minor_units = same (USD-only today).
    await queryRunner.query(`
      UPDATE "credit_purchases"
      SET "amount_minor_units" = ROUND("amount" * 100)::bigint
      WHERE "amount_minor_units" IS NULL
        AND "amount" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "credit_purchases"
      SET "amount_functional_minor_units" = "amount_minor_units"
      WHERE "amount_functional_minor_units" IS NULL
        AND "amount_minor_units" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_credit_purchases_stripe_btxn"
        ON "credit_purchases" ("stripe_balance_transaction_id")
        WHERE "stripe_balance_transaction_id" IS NOT NULL
    `);

    // ── invoices ────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "amount_minor_units" bigint,
        ADD COLUMN IF NOT EXISTS "tax_amount_minor_units" bigint,
        ADD COLUMN IF NOT EXISTS "stripe_balance_transaction_id" character varying(64)
    `);

    // Backfill amount_minor_units from total. tax_amount_minor_units
    // stays NULL — populated by Phase 8 (Stripe Tax) on new invoices.
    await queryRunner.query(`
      UPDATE "invoices"
      SET "amount_minor_units" = ROUND("total" * 100)::bigint
      WHERE "amount_minor_units" IS NULL
        AND "total" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_invoices_stripe_btxn"
        ON "invoices" ("stripe_balance_transaction_id")
        WHERE "stripe_balance_transaction_id" IS NOT NULL
    `);

    // ── credit_balances ─────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "credit_balances"
        ADD COLUMN IF NOT EXISTS "last_ledger_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credit_balances"
        DROP COLUMN IF EXISTS "last_ledger_id"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoices_stripe_btxn"`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        DROP COLUMN IF EXISTS "stripe_balance_transaction_id",
        DROP COLUMN IF EXISTS "tax_amount_minor_units",
        DROP COLUMN IF EXISTS "amount_minor_units"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_credit_purchases_stripe_btxn"`);
    await queryRunner.query(`
      ALTER TABLE "credit_purchases"
        DROP COLUMN IF EXISTS "stripe_balance_transaction_id",
        DROP COLUMN IF EXISTS "amount_functional_minor_units",
        DROP COLUMN IF EXISTS "fx_rate_captured_at",
        DROP COLUMN IF EXISTS "fx_rate_source",
        DROP COLUMN IF EXISTS "fx_rate_to_functional",
        DROP COLUMN IF EXISTS "amount_minor_units"
    `);
  }
}
