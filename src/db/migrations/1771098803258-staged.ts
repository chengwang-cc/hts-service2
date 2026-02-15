import { MigrationInterface, QueryRunner } from "typeorm";

export class Staged1771098803258 implements MigrationInterface {
    name = 'Staged1771098803258'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "hts_stage_validation_issues" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "import_id" uuid NOT NULL, "stage_entry_id" uuid, "hts_number" character varying(20), "issue_code" character varying(50) NOT NULL, "severity" character varying(20) NOT NULL DEFAULT 'ERROR', "message" text NOT NULL, "details" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_88f4bdaf9c3ef95bcfdcc8a5187" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0ddc2ac4f7d7553c676ad9f34b" ON "hts_stage_validation_issues" ("severity") `);
        await queryRunner.query(`CREATE INDEX "IDX_d4bcb0fc143114515226a6cfe9" ON "hts_stage_validation_issues" ("stage_entry_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e7f8923bbaff00fe72b7790c5e" ON "hts_stage_validation_issues" ("import_id") `);
        await queryRunner.query(`CREATE TABLE "hts_stage_diffs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "import_id" uuid NOT NULL, "stage_entry_id" uuid, "current_hts_id" uuid, "hts_number" character varying(20) NOT NULL, "diff_type" character varying(20) NOT NULL, "diff_summary" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d610fac847a8d0f92eb9159c6e1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1e427d2642b67ffc3ef6274777" ON "hts_stage_diffs" ("diff_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_777a40f97b08644429f8dded77" ON "hts_stage_diffs" ("stage_entry_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ccf0e1294afcdd5b332480e27f" ON "hts_stage_diffs" ("import_id") `);
        await queryRunner.query(`CREATE TABLE "hts_stage_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "import_id" uuid NOT NULL, "source_version" character varying(50) NOT NULL, "hts_number" character varying(20) NOT NULL, "indent" integer NOT NULL DEFAULT '0', "description" text NOT NULL, "unit" character varying(50), "general_rate" character varying(255), "special" character varying(255), "other" character varying(255), "chapter99" character varying(255), "chapter" character varying(2) NOT NULL, "heading" character varying(4), "subheading" character varying(6), "statistical_suffix" character varying(10), "parent_hts_number" character varying(20), "row_hash" character varying(64) NOT NULL, "raw_item" jsonb, "normalized" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e571c47bccd5d26dfbe222cc7ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_177a9dd2052799f50f21a72220" ON "hts_stage_entries" ("source_version") `);
        await queryRunner.query(`CREATE INDEX "IDX_7cde7d4f3e1e95df868ca77156" ON "hts_stage_entries" ("hts_number") `);
        await queryRunner.query(`CREATE INDEX "IDX_f4c3186cbda8e030ddf01c860f" ON "hts_stage_entries" ("import_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_909e9e12dd8aa8c55c09608023" ON "hts_stage_entries" ("import_id", "hts_number") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_909e9e12dd8aa8c55c09608023"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f4c3186cbda8e030ddf01c860f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7cde7d4f3e1e95df868ca77156"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_177a9dd2052799f50f21a72220"`);
        await queryRunner.query(`DROP TABLE "hts_stage_entries"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ccf0e1294afcdd5b332480e27f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_777a40f97b08644429f8dded77"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e427d2642b67ffc3ef6274777"`);
        await queryRunner.query(`DROP TABLE "hts_stage_diffs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e7f8923bbaff00fe72b7790c5e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d4bcb0fc143114515226a6cfe9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ddc2ac4f7d7553c676ad9f34b"`);
        await queryRunner.query(`DROP TABLE "hts_stage_validation_issues"`);
    }

}
