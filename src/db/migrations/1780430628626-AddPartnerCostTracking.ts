import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds cost / LLM-token / context-label tracking to api_usage_metrics and
 * the new partner_usage_monthly pre-aggregation table used by
 * EntitlementGuard for plan-quota enforcement.
 *
 * Schema-additive only. Hand-scrubbed from the auto-generated migration to
 * remove unrelated drift detected against existing tables (usage_records,
 * organizations, hts, hts_formula_candidates, calculation_history) — those
 * columns are still in use; they were picked up only because their entity
 * definitions have drifted from the live schema. Out of scope for this PR.
 */
export class AddPartnerCostTracking1780430628626 implements MigrationInterface {
    name = 'AddPartnerCostTracking1780430628626'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // partner_usage_monthly: monthly pre-aggregation for quota enforcement
        await queryRunner.query(`CREATE TABLE "partner_usage_monthly" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "bucket_month" date NOT NULL, "partner_id" uuid NOT NULL, "endpoint" character varying(255) NOT NULL, "method" character varying(10) NOT NULL, "requests" integer NOT NULL DEFAULT '0', "status2xx" integer NOT NULL DEFAULT '0', "status4xx" integer NOT NULL DEFAULT '0', "status5xx" integer NOT NULL DEFAULT '0', "cost_usd" numeric(14,6) NOT NULL DEFAULT '0', "llm_input_tokens" bigint NOT NULL DEFAULT '0', "llm_output_tokens" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c28c7ce5014c2282c415e1153b6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f2432d918715c209e6f3e9b5b8" ON "partner_usage_monthly" ("partner_id", "bucket_month", "endpoint", "method") `);
        await queryRunner.query(`CREATE INDEX "IDX_26ff42c768bcecf0df9fcbd141" ON "partner_usage_monthly" ("bucket_month") `);
        await queryRunner.query(`CREATE INDEX "IDX_14f984f670e5704c93b314bbce" ON "partner_usage_monthly" ("partner_id", "bucket_month") `);

        // api_usage_metrics: cost + LLM token + context-label columns
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "cost_usd" numeric(12,6) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "llm_input_tokens" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "llm_output_tokens" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "context_label" character varying(32)`);
        await queryRunner.query(`CREATE INDEX "IDX_ce526a48a991b933a2477bf268" ON "api_usage_metrics" ("partner_id", "context_label", "timestamp") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ce526a48a991b933a2477bf268"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "context_label"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "llm_output_tokens"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "llm_input_tokens"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "cost_usd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14f984f670e5704c93b314bbce"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_26ff42c768bcecf0df9fcbd141"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f2432d918715c209e6f3e9b5b8"`);
        await queryRunner.query(`DROP TABLE "partner_usage_monthly"`);
    }

}
