import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalProviderFormulas1771203600000 implements MigrationInterface {
  name = 'CreateExternalProviderFormulas1771203600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "external_provider_formulas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" character varying(32) NOT NULL,
        "hts_number" character varying(20) NOT NULL,
        "country_code" character varying(3) NOT NULL,
        "entry_date" date NOT NULL,
        "mode_of_transport" character varying(16) NOT NULL DEFAULT 'OCEAN',
        "input_context" jsonb NOT NULL,
        "context_hash" character varying(64) NOT NULL,
        "formula_raw" text,
        "formula_normalized" text,
        "formula_components" jsonb,
        "output_breakdown" jsonb,
        "extraction_method" character varying(16) NOT NULL DEFAULT 'NETWORK',
        "extraction_confidence" numeric(5,4) NOT NULL DEFAULT 0,
        "parser_version" character varying(32) NOT NULL DEFAULT 'v1',
        "source_url" text NOT NULL,
        "evidence" jsonb,
        "observed_at" timestamp NOT NULL DEFAULT now(),
        "observed_by" character varying(255),
        "is_latest" boolean NOT NULL DEFAULT true,
        "superseded_at" timestamp,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_external_provider_formulas_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ext_provider_formula_lookup"
      ON "external_provider_formulas" ("provider", "hts_number", "country_code", "entry_date")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ext_provider_formula_context"
      ON "external_provider_formulas" ("provider", "context_hash")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ext_provider_formula_latest_context"
      ON "external_provider_formulas" ("provider", "context_hash", "is_latest")
      WHERE "is_latest" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ext_provider_formula_latest_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ext_provider_formula_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ext_provider_formula_lookup"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "external_provider_formulas"`);
  }
}
