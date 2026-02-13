import { MigrationInterface, QueryRunner } from "typeorm";

export class Init11770972381631 implements MigrationInterface {
    name = 'Init11770972381631'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "onboarding_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "description" text, "template_type" character varying(50) NOT NULL, "schema" jsonb NOT NULL, "sample_data" jsonb, "validation_rules" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3d92c823abe29a6a0ad7ac25632" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6b6cd716bfedee40ea98a1bae6" ON "onboarding_templates" ("is_active") `);
        await queryRunner.query(`CREATE INDEX "IDX_8dc0371ea3f890340dd0ed248c" ON "onboarding_templates" ("template_type") `);
        await queryRunner.query(`CREATE TABLE "onboarding_progress" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "user_id" uuid NOT NULL, "persona" character varying(50) NOT NULL, "current_step" character varying(50) NOT NULL, "completed_steps" jsonb NOT NULL DEFAULT '{}', "wizard_data" jsonb, "is_complete" boolean NOT NULL DEFAULT false, "completed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_070eb6e4f3132f9d7f29651aa3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_24f158c08586f16fc114147688" ON "onboarding_progress" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_4ec25329691c172d07022d2ae2" ON "onboarding_progress" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "country_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "country_code" character varying(2) NOT NULL, "name" character varying(100) NOT NULL, "currency_code" character varying(3) NOT NULL, "tariff_system" character varying(10) NOT NULL, "locale_settings" jsonb NOT NULL, "tax_config" jsonb NOT NULL, "trade_agreements" jsonb NOT NULL DEFAULT '[]', "data_sources" jsonb, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_03f8a5d7a29c1625820ca6cde06" UNIQUE ("country_code"), CONSTRAINT "PK_a881e4e3a05bc586039329ae656" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9ca809344746f624026e2f2eae" ON "country_configs" ("is_active") `);
        await queryRunner.query(`CREATE INDEX "IDX_03f8a5d7a29c1625820ca6cde0" ON "country_configs" ("country_code") `);
        await queryRunner.query(`CREATE TABLE "connector_sync_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "connector_id" uuid NOT NULL, "sync_type" character varying(50) NOT NULL, "status" character varying(50) NOT NULL, "items_processed" integer NOT NULL DEFAULT '0', "items_succeeded" integer NOT NULL DEFAULT '0', "items_failed" integer NOT NULL DEFAULT '0', "started_at" TIMESTAMP NOT NULL, "completed_at" TIMESTAMP, "duration_ms" integer, "errors" jsonb, "summary" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e065007b1cb9ada357c32b99a65" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7e502e476a12b2abab2b0f7269" ON "connector_sync_logs" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_813ba8b85c38d2243b5b71c772" ON "connector_sync_logs" ("connector_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "connectors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "connector_type" character varying(50) NOT NULL, "name" character varying(100) NOT NULL, "description" text, "config" jsonb NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "status" character varying(50) NOT NULL DEFAULT 'disconnected', "last_sync_at" TIMESTAMP, "last_error" text, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c1334e2a68a8de86d1732a8e3fb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b6aae189e315d97a6fbd5a6f38" ON "connectors" ("connector_type", "is_active") `);
        await queryRunner.query(`CREATE INDEX "IDX_cbd8a4118ed5618028c7f69a00" ON "connectors" ("organization_id") `);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cbd8a4118ed5618028c7f69a00"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b6aae189e315d97a6fbd5a6f38"`);
        await queryRunner.query(`DROP TABLE "connectors"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_813ba8b85c38d2243b5b71c772"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7e502e476a12b2abab2b0f7269"`);
        await queryRunner.query(`DROP TABLE "connector_sync_logs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_03f8a5d7a29c1625820ca6cde0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9ca809344746f624026e2f2eae"`);
        await queryRunner.query(`DROP TABLE "country_configs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4ec25329691c172d07022d2ae2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_24f158c08586f16fc114147688"`);
        await queryRunner.query(`DROP TABLE "onboarding_progress"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8dc0371ea3f890340dd0ed248c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b6cd716bfedee40ea98a1bae6"`);
        await queryRunner.query(`DROP TABLE "onboarding_templates"`);
    }

}
