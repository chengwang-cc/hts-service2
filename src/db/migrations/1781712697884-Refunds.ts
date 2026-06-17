import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 4, PR F4.1 — Refunds table.
 *
 * Mirrors Stripe's Refund object + adds internal state machine,
 * actor capture, and FK columns to the credit_ledger entries we post
 * on successful refunds (and reversal entries when Stripe flips
 * succeeded → failed after we'd already debited).
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §8
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §5.1
 */
export class Refunds1781712697884 implements MigrationInterface {
    name = 'Refunds1781712697884'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "refunds" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "original_payment_intent_id" character varying(64) NOT NULL,
                "original_charge_id" character varying(64),
                "stripe_refund_id" character varying(64),
                "stripe_balance_transaction_id" character varying(64),
                "amount_minor_units" bigint NOT NULL,
                "currency" character(3) NOT NULL DEFAULT 'USD',
                "reason" character varying(32) NOT NULL,
                "internal_note" text,
                "status" character varying(32) NOT NULL DEFAULT 'pending',
                "failure_reason" character varying(128),
                "credits_returned" integer NOT NULL DEFAULT 0,
                "ledger_entry_id" uuid,
                "reversal_ledger_entry_id" uuid,
                "actor_user_id" uuid NOT NULL,
                "actor_ip" inet,
                "actor_user_agent" text,
                "request_id" character varying(64),
                "idempotency_key" character varying(255),
                "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_refunds" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_refunds_org_created" ON "refunds" ("organization_id", "created_at" DESC)`);
        await queryRunner.query(`CREATE INDEX "IDX_refunds_status_created" ON "refunds" ("status", "created_at" DESC)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_refunds_stripe_refund_id" ON "refunds" ("stripe_refund_id") WHERE "stripe_refund_id" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_refunds_idempotency" ON "refunds" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_refunds_idempotency"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_refunds_stripe_refund_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_refunds_status_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_refunds_org_created"`);
        await queryRunner.query(`DROP TABLE "refunds"`);
    }
}
