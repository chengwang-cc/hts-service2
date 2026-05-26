import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMarketplaceContactExposure1779824740193 implements MigrationInterface {
    name = 'AddMarketplaceContactExposure1779824740193'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" ADD "public_contact_exposure" character varying(24) NOT NULL DEFAULT 'platform_only'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "marketplace_broker_profiles" DROP COLUMN "public_contact_exposure"`);
    }

}
