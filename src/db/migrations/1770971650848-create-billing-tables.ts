import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateBillingTables1770971650848 implements MigrationInterface {
    name = 'CreateBillingTables1770971650848'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "export_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "name" character varying(100) NOT NULL, "description" character varying(255), "template_type" character varying(50) NOT NULL, "field_mapping" jsonb NOT NULL, "format_options" jsonb, "is_system" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3777207cd282bfec6bd0261d5bc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c72ab72ad43c72543ea3e1dc99" ON "export_templates" ("is_system") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_33678998322f0747aea098a47e" ON "export_templates" ("organization_id", "name") `);
        await queryRunner.query(`CREATE TABLE "export_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "created_by" uuid NOT NULL, "template" character varying(50) NOT NULL, "format" character varying(20) NOT NULL, "filters" jsonb, "status" character varying(20) NOT NULL DEFAULT 'pending', "file_url" character varying, "file_size" bigint, "record_count" integer NOT NULL DEFAULT '0', "processed_records" integer NOT NULL DEFAULT '0', "failed_records" integer NOT NULL DEFAULT '0', "error" text, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP, "expires_at" TIMESTAMP, CONSTRAINT "PK_3044ce6f1c6af24058ee609e063" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3b6aa9ca07be1b4f53b75bf467" ON "export_jobs" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_0032aa6713d64c5601ae5412b1" ON "export_jobs" ("organization_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "data_completeness_checks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "resource_type" character varying(50) NOT NULL, "resource_id" uuid NOT NULL, "overall_score" numeric(5,2) NOT NULL, "is_export_ready" boolean NOT NULL DEFAULT false, "issues" jsonb NOT NULL, "completeness" jsonb, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6d46e188c13d8cd8fb6dc3d1134" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_38a3037d2dcc8bd09c78e7a521" ON "data_completeness_checks" ("resource_type", "resource_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_f03cb632d6211fa6d5d41793bb" ON "data_completeness_checks" ("organization_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "usage_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "subscription_id" uuid, "metric_name" character varying(100) NOT NULL, "quantity" integer NOT NULL, "timestamp" TIMESTAMP NOT NULL, "stripe_usage_record_id" character varying(255), "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e511cf9f7dc53851569f87467a5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4733c4313650f4e34a8396599e" ON "usage_records" ("subscription_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_b6dacd2c81f576322e792bb526" ON "usage_records" ("organization_id", "metric_name", "timestamp") `);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "stripe_subscription_id" character varying(255) NOT NULL, "stripe_customer_id" character varying(255) NOT NULL, "plan" character varying(50) NOT NULL, "status" character varying(50) NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "interval" character varying(20) NOT NULL, "current_period_start" TIMESTAMP, "current_period_end" TIMESTAMP, "cancel_at" TIMESTAMP, "cancel_at_period_end" boolean NOT NULL DEFAULT false, "trial_end" TIMESTAMP, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6ccf973355b70645eff37774de" ON "subscriptions" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3a2d09d943f39912a01831a927" ON "subscriptions" ("stripe_subscription_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_9ea1509175fa294fc64d43a9fe" ON "subscriptions" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "subscription_id" uuid, "stripe_invoice_id" character varying(255) NOT NULL, "stripe_customer_id" character varying(255) NOT NULL, "invoice_number" character varying(100), "status" character varying(50) NOT NULL, "subtotal" numeric(10,2) NOT NULL, "tax" numeric(10,2) NOT NULL, "total" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "period_start" TIMESTAMP NOT NULL, "period_end" TIMESTAMP NOT NULL, "due_date" TIMESTAMP, "paid_at" TIMESTAMP, "hosted_invoice_url" character varying(500), "invoice_pdf" character varying(500), "line_items" jsonb, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ac0f09364e3701d9ed35435288" ON "invoices" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0ddf8494c8665a57c670287ccd" ON "invoices" ("stripe_invoice_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_b5e3ce8c220cbbebf5272c3bfa" ON "invoices" ("organization_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b5e3ce8c220cbbebf5272c3bfa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ddf8494c8665a57c670287ccd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ac0f09364e3701d9ed35435288"`);
        await queryRunner.query(`DROP TABLE "invoices"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9ea1509175fa294fc64d43a9fe"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a2d09d943f39912a01831a927"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6ccf973355b70645eff37774de"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b6dacd2c81f576322e792bb526"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4733c4313650f4e34a8396599e"`);
        await queryRunner.query(`DROP TABLE "usage_records"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f03cb632d6211fa6d5d41793bb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_38a3037d2dcc8bd09c78e7a521"`);
        await queryRunner.query(`DROP TABLE "data_completeness_checks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0032aa6713d64c5601ae5412b1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3b6aa9ca07be1b4f53b75bf467"`);
        await queryRunner.query(`DROP TABLE "export_jobs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_33678998322f0747aea098a47e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c72ab72ad43c72543ea3e1dc99"`);
        await queryRunner.query(`DROP TABLE "export_templates"`);
    }

}
