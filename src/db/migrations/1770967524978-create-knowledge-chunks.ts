import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKnowledgeChunks1770967524978 implements MigrationInterface {
    name = 'CreateKnowledgeChunks1770967524978'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT '0.01'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_test_cases" ALTER COLUMN "tolerance" SET DEFAULT 0.01`);
    }

}
