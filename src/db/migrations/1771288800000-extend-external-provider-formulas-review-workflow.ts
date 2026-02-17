import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendExternalProviderFormulasReviewWorkflow1771288800000
  implements MigrationInterface
{
  name = 'ExtendExternalProviderFormulasReviewWorkflow1771288800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "review_status" character varying(20) NOT NULL DEFAULT 'PENDING'
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "review_decision_comment" text
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "reviewed_by" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "published_formula_update_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "published_by" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "published_at" timestamp
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      ADD COLUMN IF NOT EXISTS "publish_metadata" jsonb
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ext_provider_formula_review_status"
      ON "external_provider_formulas" ("review_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ext_provider_formula_review_status"`,
    );

    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "publish_metadata"
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "published_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "published_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "published_formula_update_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "reviewed_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "reviewed_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "review_decision_comment"
    `);
    await queryRunner.query(`
      ALTER TABLE "external_provider_formulas"
      DROP COLUMN IF EXISTS "review_status"
    `);
  }
}

