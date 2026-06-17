import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 1, PR F1.1 — Append-only credit ledger.
 *
 * Adds the `credit_ledger` table with every column the design doc
 * calls for (multi-currency, FX, tax, actor, idempotency), plus the
 * append-only enforcement trigger.
 *
 * Indices justified by the queries each unlocks:
 *   - (org_id, created_at DESC): admin ledger preview, balance derivation
 *   - (kind, created_at DESC):    refund-rate / manual-credits-issued reports
 *   - (stripe_balance_transaction_id): reconciliation join
 *   - (idempotency_key) UNIQUE:   Stripe-shape replay protection
 *   - (reference_type, reference_id): "find the ledger row for this refund"
 *
 * The append-only trigger blocks UPDATE and DELETE — corrections must
 * be forward-posted as new rows with kind=REVERSAL.
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §5
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §2.1
 */
export class CreditLedger1781708100395 implements MigrationInterface {
    name = 'CreditLedger1781708100395'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "credit_ledger" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "delta_credits" integer NOT NULL,
                "balance_after" integer NOT NULL,
                "kind" character varying(32) NOT NULL,
                "reason_code" character varying(64),
                "internal_note" text,
                "reference_type" character varying(64),
                "reference_id" character varying(255),
                "stripe_balance_transaction_id" character varying(64),
                "stripe_charge_id" character varying(64),
                "currency" character(3) NOT NULL DEFAULT 'USD',
                "amount_minor_units" bigint,
                "fx_rate_to_functional" numeric(18,8) NOT NULL DEFAULT 1,
                "fx_rate_source" character varying(64),
                "fx_rate_captured_at" TIMESTAMP,
                "amount_functional_minor_units" bigint,
                "tax_treatment" character varying(32) NOT NULL DEFAULT 'NON_TAXABLE_PROMO',
                "actor_kind" character varying(16) NOT NULL,
                "actor_user_id" uuid,
                "actor_ip" inet,
                "actor_user_agent" text,
                "request_id" character varying(64),
                "idempotency_key" character varying(255),
                "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_credit_ledger" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_credit_ledger_org_created" ON "credit_ledger" ("organization_id", "created_at" DESC)`);
        await queryRunner.query(`CREATE INDEX "IDX_credit_ledger_kind_created" ON "credit_ledger" ("kind", "created_at" DESC)`);
        await queryRunner.query(`CREATE INDEX "IDX_credit_ledger_stripe_btxn" ON "credit_ledger" ("stripe_balance_transaction_id") WHERE "stripe_balance_transaction_id" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_credit_ledger_idempotency" ON "credit_ledger" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_credit_ledger_reference" ON "credit_ledger" ("reference_type", "reference_id") WHERE "reference_id" IS NOT NULL`);

        // Append-only enforcement
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION credit_ledger_block_mutation() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'credit_ledger is append-only; corrections must be forward-posted as REVERSAL rows';
            END;
            $$ LANGUAGE plpgsql
        `);
        await queryRunner.query(`
            CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE ON credit_ledger
                FOR EACH ROW EXECUTE FUNCTION credit_ledger_block_mutation()
        `);
        await queryRunner.query(`
            CREATE TRIGGER credit_ledger_no_delete BEFORE DELETE ON credit_ledger
                FOR EACH ROW EXECUTE FUNCTION credit_ledger_block_mutation()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS credit_ledger_no_delete ON credit_ledger`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS credit_ledger_no_update ON credit_ledger`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS credit_ledger_block_mutation()`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_credit_ledger_reference"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_credit_ledger_idempotency"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_credit_ledger_stripe_btxn"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_credit_ledger_kind_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_credit_ledger_org_created"`);
        await queryRunner.query(`DROP TABLE "credit_ledger"`);
    }
}
