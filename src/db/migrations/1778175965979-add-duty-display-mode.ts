import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDutyDisplayMode1778175965979 implements MigrationInterface {
    name = 'AddDutyDisplayMode1778175965979'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shopify_sessions" ADD "duty_display_mode" character varying(20) NOT NULL DEFAULT 'ddu'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shopify_sessions" DROP COLUMN "duty_display_mode"`);
    }

}
