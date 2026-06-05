import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Per-request LLM token + cost tracking.
 *
 * Adds three new columns to `api_usage_metrics` so every request can
 * carry its own model name + cached-input token count + pipeline-stage
 * tag, and one column to `partner_usage_monthly` so the rollup can
 * surface cache-hit ratios on the dashboard.
 *
 * Populated by:
 *   - OpenAiService / AnthropicService push `(model, prompt_tokens,
 *     completion_tokens, cached_tokens)` into the active
 *     LlmUsageTracker scope after each model call.
 *   - UsageRecordingInterceptor (sync HTTP path) opens a scope around
 *     `next.handle()` and reads the aggregate when the response is
 *     about to be written.
 *   - LlmUsageRecordingService (async pg-boss path) writes a separate
 *     row tagged with `llm_pipeline_stage` so the AI-cost row is
 *     distinguishable from the synchronous 202 row.
 *
 * Indexes:
 *   - (partner_id, model_name, timestamp) drives the per-partner cost-
 *     by-model dashboard tile.
 *   - (model_name, timestamp) supports cross-partner platform-wide
 *     "which model is driving cost" queries from the admin dashboard.
 *
 * Auto-generated DROP statements from `migration:generate` for unrelated
 * entity/DB drift were intentionally stripped — this migration must do
 * one thing only.
 */
export class AddLlmCostTrackingFields1780685645187 implements MigrationInterface {
    name = 'AddLlmCostTrackingFields1780685645187'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "partner_usage_monthly" ADD "llm_cached_tokens" bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "llm_cached_tokens" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "model_name" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "llm_pipeline_stage" character varying(64)`);
        await queryRunner.query(`CREATE INDEX "IDX_f25f910a2484dd04d97ed48cd2" ON "api_usage_metrics" ("partner_id", "model_name", "timestamp") `);
        await queryRunner.query(`CREATE INDEX "IDX_70eda5739e5d608f6710a02ba3" ON "api_usage_metrics" ("model_name", "timestamp") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_70eda5739e5d608f6710a02ba3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f25f910a2484dd04d97ed48cd2"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "llm_pipeline_stage"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "model_name"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "llm_cached_tokens"`);
        await queryRunner.query(`ALTER TABLE "partner_usage_monthly" DROP COLUMN "llm_cached_tokens"`);
    }

}
