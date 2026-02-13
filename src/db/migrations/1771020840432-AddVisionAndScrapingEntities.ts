import { MigrationInterface, QueryRunner } from "typeorm";

export class AddVisionAndScrapingEntities1771020840432 implements MigrationInterface {
    name = 'AddVisionAndScrapingEntities1771020840432'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "scraping_metadata" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" character varying(255) NOT NULL, "url" character varying(2000) NOT NULL, "url_hash" character varying(64) NOT NULL, "method" character varying(20) NOT NULL, "vision_used" boolean NOT NULL DEFAULT false, "status_code" integer NOT NULL, "scraped_data" jsonb, "processing_time_ms" integer NOT NULL, "error_message" character varying(500), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7efea6b7cd8379315b847375c32" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7e2940ff5584fb7dea4555230d" ON "scraping_metadata" ("url_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_5f078e0aa6aa2980047d888b9e" ON "scraping_metadata" ("organization_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "vision_analysis" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" character varying(255) NOT NULL, "image_hash" character varying(64) NOT NULL, "source_url" character varying(2000), "analysis_result" jsonb NOT NULL, "model_used" character varying(50) NOT NULL, "processing_time_ms" integer NOT NULL, "image_size_bytes" integer NOT NULL, "image_format" character varying(50) NOT NULL, "tokens_used" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_25f92b8f661745f2b6cf1909299" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3599f6a5eef7b7c6fc480caf53" ON "vision_analysis" ("image_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_a9ccb235cd22d6ebc1d8d767c4" ON "vision_analysis" ("organization_id", "created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_a9ccb235cd22d6ebc1d8d767c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3599f6a5eef7b7c6fc480caf53"`);
        await queryRunner.query(`DROP TABLE "vision_analysis"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5f078e0aa6aa2980047d888b9e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7e2940ff5584fb7dea4555230d"`);
        await queryRunner.query(`DROP TABLE "scraping_metadata"`);
    }

}
