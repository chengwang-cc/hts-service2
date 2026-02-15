import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandStageEntryRateFields1771114637109 implements MigrationInterface {
    name = 'ExpandStageEntryRateFields1771114637109'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ba1499ab3c7580e44147eb51da"`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ADD "status" character varying(30) NOT NULL DEFAULT 'PENDING'`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "general_rate"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "general_rate" text`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "special"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "special" text`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "other"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "other" text`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "chapter99"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "chapter99" text`);
        await queryRunner.query(`CREATE INDEX "IDX_ba1499ab3c7580e44147eb51da" ON "hts_import_history" ("status") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ba1499ab3c7580e44147eb51da"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "chapter99"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "chapter99" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "other"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "other" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "special"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "special" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" DROP COLUMN "general_rate"`);
        await queryRunner.query(`ALTER TABLE "hts_stage_entries" ADD "general_rate" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ADD "status" character varying(20) NOT NULL DEFAULT 'PENDING'`);
        await queryRunner.query(`CREATE INDEX "IDX_ba1499ab3c7580e44147eb51da" ON "hts_import_history" ("status") `);
    }

}
