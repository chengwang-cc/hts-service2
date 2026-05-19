import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClassificationSource1778866546902 implements MigrationInterface {
    name = 'AddClassificationSource1778866546902'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "lookup_classification_job" ADD COLUMN IF NOT EXISTS "source" character varying(20) NOT NULL DEFAULT 'WEB'`,
        );
        await queryRunner.query(
            `ALTER TABLE "lookup_classification_job" ADD COLUMN IF NOT EXISTS "product_description" character varying(512)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_lookup_classification_job_org_source_created_at" ON "lookup_classification_job" ("organization_id", "source", "created_at")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "public"."IDX_lookup_classification_job_org_source_created_at"`,
        );
        await queryRunner.query(
            `ALTER TABLE "lookup_classification_job" DROP COLUMN IF EXISTS "product_description"`,
        );
        await queryRunner.query(
            `ALTER TABLE "lookup_classification_job" DROP COLUMN IF EXISTS "source"`,
        );
    }

}
