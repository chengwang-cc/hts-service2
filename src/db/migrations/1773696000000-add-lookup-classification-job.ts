import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLookupClassificationJob1773696000000
  implements MigrationInterface
{
  name = 'AddLookupClassificationJob1773696000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lookup_classification_job" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "created_by" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "request_type" character varying(20) NOT NULL,
        "source_url" character varying(2048),
        "image_original_filename" character varying(255),
        "image_mime_type" character varying(128),
        "image_size_bytes" integer,
        "image_data" bytea,
        "queue_job_id" character varying(128),
        "result_json" jsonb,
        "error_message" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lookup_classification_job_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lookup_classification_job_org_status"
      ON "lookup_classification_job" ("organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lookup_classification_job_created_by_status"
      ON "lookup_classification_job" ("created_by", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lookup_classification_job_status_created_at"
      ON "lookup_classification_job" ("status", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lookup_classification_job_status_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lookup_classification_job_created_by_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lookup_classification_job_org_status"`,
    );
    await queryRunner.query(`DROP TABLE "lookup_classification_job"`);
  }
}
