import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Disputes table (Phase 5 of financial management, PR F5.1).
 *
 * Stripe-dispute mirror + internal workflow state. See
 *   docs/2026-06-17/0736_financial-management-system-design.md §9
 * for the design and the entity at
 *   src/modules/billing/entities/dispute.entity.ts for column docs.
 *
 * Notes
 * -----
 * - We use VARCHAR for stripe_status + internal_state (not Postgres
 *   ENUM) to match the rest of the project convention — ENUMs make
 *   future value additions painful (ALTER TYPE ... ADD VALUE requires
 *   careful ordering across replicas).
 * - The row IS mutable; only the credit_ledger entries it references
 *   are append-only (per the existing trigger from CreditLedger).
 * - `submission_count` defaults to 0 and is bumped on POST .../respond.
 *   Stripe accepts exactly one submission per dispute; the service
 *   layer guards on count > 0 in addition to the IdempotencyInterceptor.
 */
export class Disputes1781714632886 implements MigrationInterface {
  name = 'Disputes1781714632886';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "disputes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "stripe_dispute_id" character varying(64) NOT NULL,
        "stripe_charge_id" character varying(64) NOT NULL,
        "stripe_payment_intent_id" character varying(64),
        "amount_minor_units" bigint NOT NULL,
        "currency" character(3) NOT NULL DEFAULT 'USD',
        "reason" character varying(64) NOT NULL,
        "stripe_status" character varying(32) NOT NULL,
        "internal_state" character varying(32) NOT NULL DEFAULT 'OPEN',
        "evidence_due_by" TIMESTAMP,
        "submission_count" integer NOT NULL DEFAULT 0,
        "is_charge_refundable" boolean NOT NULL DEFAULT false,
        "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "funds_withdrawn_at" TIMESTAMP,
        "funds_reinstated_at" TIMESTAMP,
        "chargeback_ledger_entry_id" uuid,
        "reversal_ledger_entry_id" uuid,
        "submission_idempotency_key" character varying(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_disputes_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_disputes_stripe_dispute_id"
        ON "disputes" ("stripe_dispute_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_disputes_org_created"
        ON "disputes" ("organization_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_disputes_state_due"
        ON "disputes" ("internal_state", "evidence_due_by")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_disputes_charge"
        ON "disputes" ("stripe_charge_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_disputes_charge"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_disputes_state_due"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_disputes_org_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_disputes_stripe_dispute_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disputes"`);
  }
}
