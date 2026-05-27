import { MigrationInterface, QueryRunner } from "typeorm";

export class AddJurisdictionCountryState1779839486660 implements MigrationInterface {
    name = 'AddJurisdictionCountryState1779839486660'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "rule_status_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rule_id" character varying(200) NOT NULL, "previous_enabled" boolean, "new_enabled" boolean NOT NULL, "previous_effective_from" TIMESTAMP WITH TIME ZONE, "previous_effective_to" TIMESTAMP WITH TIME ZONE, "new_effective_from" TIMESTAMP WITH TIME ZONE, "new_effective_to" TIMESTAMP WITH TIME ZONE, "reason" text, "changed_by" character varying(200) NOT NULL, "changed_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_266b890dfef322c91466d425ecc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d10af81c42c1ff012c85b48b01" ON "rule_status_history" ("changed_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_19591ddbfdaccee2cc4e9c76c0" ON "rule_status_history" ("rule_id", "changed_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_ce2898afd8abd533fec2e60bd6" ON "rule_status_history" ("rule_id") `);
        await queryRunner.query(`ALTER TABLE "tax_rules" ADD "tax_base_formula" character varying(32) NOT NULL DEFAULT 'GOODS_VALUE'`);
        await queryRunner.query(`ALTER TABLE "jurisdictions" ADD "country_state" character varying(24) NOT NULL DEFAULT 'PRODUCTION'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "jurisdictions" DROP COLUMN "country_state"`);
        await queryRunner.query(`ALTER TABLE "tax_rules" DROP COLUMN "tax_base_formula"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ce2898afd8abd533fec2e60bd6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_19591ddbfdaccee2cc4e9c76c0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d10af81c42c1ff012c85b48b01"`);
        await queryRunner.query(`DROP TABLE "rule_status_history"`);
    }

}
