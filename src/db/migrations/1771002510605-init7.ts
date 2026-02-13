import { MigrationInterface, QueryRunner } from "typeorm";

export class Init71771002510605 implements MigrationInterface {
    name = 'Init71771002510605'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
    }

}
