import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateParityComparison1779595565005 implements MigrationInterface {
    name = 'CreateParityComparison1779595565005'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "parity_comparison_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" character varying(32) NOT NULL DEFAULT 'queued', "initiated_by" character varying(128) NOT NULL, "scope" character varying(16) NOT NULL, "corpus_filter" jsonb NOT NULL, "corpus_size" integer NOT NULL DEFAULT '0', "rows_processed" integer NOT NULL DEFAULT '0', "rows_matched" integer NOT NULL DEFAULT '0', "rows_mismatched" integer NOT NULL DEFAULT '0', "rows_ai_service_unavailable" integer NOT NULL DEFAULT '0', "ai_service_version" character varying(128), "hts_service_version" character varying(128), "hts_data_version" character varying(128), "ai_service_url" text, "summary" jsonb, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "cancel_reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bbccfb91f3c8b3b17d9f8c8cc0d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c1cf5c80ac1815a8cb3575fc79" ON "parity_comparison_runs" ("initiated_by") `);
        await queryRunner.query(`CREATE INDEX "IDX_e16b27c9a4ef8b715f5688d86a" ON "parity_comparison_runs" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_3cfcbf3ddc535c55474dedc315" ON "parity_comparison_runs" ("status") `);
        await queryRunner.query(`CREATE TABLE "parity_comparison_rows" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "hts_number" character varying(20) NOT NULL, "chapter" character varying(2) NOT NULL, "heading" character varying(4), "country_of_origin" character varying(8) NOT NULL, "declared_value" numeric(15,4) NOT NULL, "inputs" jsonb NOT NULL, "rate_class" character varying(32), "ai_total_duty" numeric(12,4), "ai_formulas" jsonb, "ai_block_reason" text, "ai_response_time_ms" integer, "local_total_duty" numeric(12,4), "local_breakdown" jsonb, "local_block_reason" text, "local_response_time_ms" integer, "delta" numeric(12,4), "matched" boolean NOT NULL DEFAULT false, "mismatch_reason" character varying(64) NOT NULL DEFAULT 'NONE', "ai_validation_status" character varying(32) NOT NULL DEFAULT 'pending', "ai_validation_explanation" text, "ai_validation_verdict" character varying(64), "ai_validation_confidence" numeric(3,2), "ai_validation_evidence" jsonb, "review_status" character varying(32) NOT NULL DEFAULT 'untouched', "reviewed_by" character varying(128), "reviewer_note" text, "reviewed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a1ee2a73275548b7f6bd9c7d0e4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_95f0ffcb8f3b612fe77b3d12ff" ON "parity_comparison_rows" ("hts_number", "country_of_origin") `);
        await queryRunner.query(`CREATE INDEX "IDX_dda9bcf618371b2563c3d85d8e" ON "parity_comparison_rows" ("run_id", "chapter") `);
        await queryRunner.query(`CREATE INDEX "IDX_b1416dfad31546dc1aebe7ae38" ON "parity_comparison_rows" ("run_id", "mismatch_reason") `);
        await queryRunner.query(`CREATE INDEX "IDX_a6298ef28e0badcae237631ce6" ON "parity_comparison_rows" ("run_id", "matched") `);
        await queryRunner.query(`CREATE INDEX "IDX_a194044db7c8358c2aac0bb752" ON "parity_comparison_rows" ("run_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_a194044db7c8358c2aac0bb752"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a6298ef28e0badcae237631ce6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b1416dfad31546dc1aebe7ae38"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dda9bcf618371b2563c3d85d8e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95f0ffcb8f3b612fe77b3d12ff"`);
        await queryRunner.query(`DROP TABLE "parity_comparison_rows"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3cfcbf3ddc535c55474dedc315"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e16b27c9a4ef8b715f5688d86a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c1cf5c80ac1815a8cb3575fc79"`);
        await queryRunner.query(`DROP TABLE "parity_comparison_runs"`);
    }

}
