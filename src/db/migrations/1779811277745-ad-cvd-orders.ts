import { MigrationInterface, QueryRunner } from "typeorm";

export class AdCvdOrders1779811277745 implements MigrationInterface {
    name = 'AdCvdOrders1779811277745'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ad_cvd_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "destination_country" character varying(4) NOT NULL, "hts_code" character varying(20) NOT NULL, "origin_country" character varying(4) NOT NULL, "exporter_name" character varying(200), "order_case_number" character varying(50) NOT NULL, "order_type" character varying(16) NOT NULL, "cash_deposit_rate" numeric(8,6) NOT NULL, "effective_from" TIMESTAMP WITH TIME ZONE NOT NULL, "effective_to" TIMESTAMP WITH TIME ZONE, "source" character varying(200) NOT NULL, "description" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_78f1b6d1ffea89e1bc205b46bd4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f99cf59a03fa232db134d4991b" ON "ad_cvd_orders" ("order_case_number") `);
        await queryRunner.query(`CREATE INDEX "IDX_5d1d06702eec5e44f93a231c75" ON "ad_cvd_orders" ("destination_country", "origin_country") `);
        await queryRunner.query(`CREATE INDEX "IDX_22492098bd9543b79ff71b1856" ON "ad_cvd_orders" ("destination_country", "hts_code") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_22492098bd9543b79ff71b1856"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5d1d06702eec5e44f93a231c75"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f99cf59a03fa232db134d4991b"`);
        await queryRunner.query(`DROP TABLE "ad_cvd_orders"`);
    }

}
