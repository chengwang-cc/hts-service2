import { MigrationInterface, QueryRunner } from "typeorm";

export class SyncSchema1777400600393 implements MigrationInterface {
    name = 'SyncSchema1777400600393'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "checkout_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "calculation_id" character varying(255) NOT NULL, "platform_order_id" character varying(255) NOT NULL, "platform" character varying(50) NOT NULL, "store_connection_id" character varying(255), "organization_id" uuid NOT NULL, "calculation_summary" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_30e864f6a10037f8bfeaba17024" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3ca28e1e88cb01a34324a967c0" ON "checkout_orders" ("organization_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_682a8f02b3b328245a942e7a14" ON "checkout_orders" ("platform_order_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_2f804c001e25dcec6b8bdd7d4b" ON "checkout_orders" ("calculation_id") `);
        await queryRunner.query(`CREATE TABLE "lookup_dataset_curation_job" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "created_by" character varying(255), "status" character varying(20) NOT NULL DEFAULT 'pending', "original_filename" character varying(255) NOT NULL, "mime_type" character varying(128), "file_size_bytes" integer, "source_csv_data" bytea, "options_json" jsonb NOT NULL, "queue_job_id" character varying(128), "summary_json" jsonb, "standardized_csv" text, "rejected_csv" text, "eval_csv" text, "audit_csv" text, "audit_summary_json" jsonb, "error_message" text, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_75f61c790a313f63f4f04dcaa60" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_837365b1695ee4be4d0c943337" ON "lookup_dataset_curation_job" ("status", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_499e44738b027824315e0a8380" ON "lookup_dataset_curation_job" ("created_by", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_38255e90f21475692880e284db" ON "lookup_dataset_curation_job" ("organization_id", "status") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_38255e90f21475692880e284db"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_499e44738b027824315e0a8380"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_837365b1695ee4be4d0c943337"`);
        await queryRunner.query(`DROP TABLE "lookup_dataset_curation_job"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2f804c001e25dcec6b8bdd7d4b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_682a8f02b3b328245a942e7a14"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3ca28e1e88cb01a34324a967c0"`);
        await queryRunner.query(`DROP TABLE "checkout_orders"`);
    }

}
