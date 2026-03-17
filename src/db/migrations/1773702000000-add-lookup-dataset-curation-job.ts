import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLookupDatasetCurationJob1773702000000
  implements MigrationInterface
{
  name = 'AddLookupDatasetCurationJob1773702000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lookup_dataset_curation_job" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "created_by" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "original_filename" character varying(255) NOT NULL,
        "mime_type" character varying(128),
        "file_size_bytes" integer,
        "source_csv_data" bytea,
        "options_json" jsonb NOT NULL,
        "queue_job_id" character varying(128),
        "summary_json" jsonb,
        "standardized_csv" text,
        "rejected_csv" text,
        "eval_csv" text,
        "audit_csv" text,
        "audit_summary_json" jsonb,
        "error_message" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lookup_dataset_curation_job_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lookup_dataset_curation_job_org_status"
      ON "lookup_dataset_curation_job" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lookup_dataset_curation_job_created_by_status"
      ON "lookup_dataset_curation_job" ("created_by", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lookup_dataset_curation_job_status_created_at"
      ON "lookup_dataset_curation_job" ("status", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lookup_dataset_curation_job_status_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lookup_dataset_curation_job_created_by_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lookup_dataset_curation_job_org_status"`,
    );
    await queryRunner.query(`DROP TABLE "lookup_dataset_curation_job"`);
  }
}
