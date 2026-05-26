import { MigrationInterface, QueryRunner } from "typeorm";

export class CbamQuarterlySettlement1779819544342 implements MigrationInterface {
    name = 'CbamQuarterlySettlement1779819544342'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "cbam_quarterly_settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "quarter" character varying(8) NOT NULL, "quote_id" character varying(100) NOT NULL, "hts_code" character varying(20) NOT NULL, "sector" character varying(32) NOT NULL, "default_applied" boolean NOT NULL DEFAULT true, "cbam_certificates" numeric(18,6) NOT NULL, "provisional_cost_eur" numeric(18,4) NOT NULL, "observed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_124621e0ec40f3edae5ce21c1bf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c44fe31a47022abbaa767c65ed" ON "cbam_quarterly_settlements" ("observed_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_14e955477640653dc5d004c72d" ON "cbam_quarterly_settlements" ("quote_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_0690628d001d1c3c4d7507747c" ON "cbam_quarterly_settlements" ("quarter", "sector") `);
        await queryRunner.query(`CREATE INDEX "IDX_09414fff700d6cd49dc7f338b4" ON "cbam_quarterly_settlements" ("quarter") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_09414fff700d6cd49dc7f338b4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0690628d001d1c3c4d7507747c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14e955477640653dc5d004c72d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c44fe31a47022abbaa767c65ed"`);
        await queryRunner.query(`DROP TABLE "cbam_quarterly_settlements"`);
    }

}
