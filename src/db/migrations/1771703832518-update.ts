import { MigrationInterface, QueryRunner } from "typeorm";

export class Update1771703832518 implements MigrationInterface {
    name = 'Update1771703832518'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" DROP COLUMN "test_string"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ADD "test_string" character varying(64) NOT NULL`);
    }

}
