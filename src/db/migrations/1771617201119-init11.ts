import { MigrationInterface, QueryRunner } from "typeorm";

export class Init111771617201119 implements MigrationInterface {
    name = 'Init111771617201119'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "preference_programs" SET DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "math_components" SET DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "external_provider_formulas" ALTER COLUMN "extraction_confidence" SET DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "external_provider_formulas" ALTER COLUMN "extraction_confidence" SET DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "math_components" SET DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "preference_programs" SET DEFAULT '{}'`);
    }

}
