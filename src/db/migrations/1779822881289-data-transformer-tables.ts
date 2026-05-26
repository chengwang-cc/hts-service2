import { MigrationInterface, QueryRunner } from "typeorm";

export class DataTransformerTables1779822881289 implements MigrationInterface {
    name = 'DataTransformerTables1779822881289'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "data_transformer_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "profile_id" uuid NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'pending', "input_row_count" integer NOT NULL DEFAULT '0', "output_row_count" integer NOT NULL DEFAULT '0', "issue_count" integer NOT NULL DEFAULT '0', "output" jsonb, "error_message" text, "triggered_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_17f29af1d4be2b278fbd18f95dc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2e71130464b68c86d06e48bd1a" ON "data_transformer_runs" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_b7e82dcef25957b80a284a9aa6" ON "data_transformer_runs" ("profile_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_f02ec0b21b543cfa7f18b1a68e" ON "data_transformer_runs" ("organization_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "data_transformer_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" text, "input_kind" character varying(32) NOT NULL, "output_kind" character varying(32) NOT NULL, "input_schema" jsonb NOT NULL, "defaults" jsonb NOT NULL DEFAULT '{}', "created_by" character varying(200) NOT NULL DEFAULT 'system', "updated_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_54be9e077510572d94b283e3d58" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ddd1c29b2c35051ce5068d4932" ON "data_transformer_profiles" ("organization_id", "input_kind") `);
        await queryRunner.query(`CREATE INDEX "IDX_3bd4908a96a11a24635f25a3b2" ON "data_transformer_profiles" ("organization_id", "name") `);
        await queryRunner.query(`CREATE TABLE "data_transformer_run_issues" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "severity" character varying(16) NOT NULL, "row_index" integer, "field" character varying(200), "message" text NOT NULL, "context" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_727747691a121a24353756d33b4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c0a39b7ba3706c2f4d76eecada" ON "data_transformer_run_issues" ("run_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_5c75867c1a0615ab28e89b3cad" ON "data_transformer_run_issues" ("run_id", "severity") `);
        await queryRunner.query(`CREATE TABLE "data_transformer_mappings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "profile_id" uuid NOT NULL, "source_field" character varying(200) NOT NULL, "target_field" character varying(200) NOT NULL, "transform" jsonb, "required" boolean NOT NULL DEFAULT false, "notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2078e1bad2ecf14e0104a5c9dad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7f7876fe6694d8804433be6cd5" ON "data_transformer_mappings" ("profile_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e0a63c57ed318861cced3ab954" ON "data_transformer_mappings" ("profile_id", "target_field") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_e0a63c57ed318861cced3ab954"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7f7876fe6694d8804433be6cd5"`);
        await queryRunner.query(`DROP TABLE "data_transformer_mappings"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5c75867c1a0615ab28e89b3cad"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c0a39b7ba3706c2f4d76eecada"`);
        await queryRunner.query(`DROP TABLE "data_transformer_run_issues"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3bd4908a96a11a24635f25a3b2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ddd1c29b2c35051ce5068d4932"`);
        await queryRunner.query(`DROP TABLE "data_transformer_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f02ec0b21b543cfa7f18b1a68e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b7e82dcef25957b80a284a9aa6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2e71130464b68c86d06e48bd1a"`);
        await queryRunner.query(`DROP TABLE "data_transformer_runs"`);
    }

}
