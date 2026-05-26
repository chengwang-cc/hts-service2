import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCampaignMetadata1779823077655 implements MigrationInterface {
    name = 'AddCampaignMetadata1779823077655'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "broker_outreach_campaigns" ADD "metadata" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "broker_outreach_campaigns" DROP COLUMN "metadata"`);
    }

}
