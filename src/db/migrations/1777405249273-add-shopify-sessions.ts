import { MigrationInterface, QueryRunner } from "typeorm";

export class AddShopifySessions1777405249273 implements MigrationInterface {
    name = 'AddShopifySessions1777405249273'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "shopify_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop" character varying(255) NOT NULL, "access_token" text NOT NULL, "scopes" jsonb NOT NULL, "organization_id" uuid, "connector_id" uuid, "nonce" character varying(50), "is_active" boolean NOT NULL DEFAULT true, "installed_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_8986fb724590bbb6f7ad6178c92" UNIQUE ("shop"), CONSTRAINT "PK_1ae2570e4a8afeadefb9221f0fd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bd9dab9baa310c7df90ecd4a85" ON "shopify_sessions" ("organization_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8986fb724590bbb6f7ad6178c9" ON "shopify_sessions" ("shop") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_8986fb724590bbb6f7ad6178c9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bd9dab9baa310c7df90ecd4a85"`);
        await queryRunner.query(`DROP TABLE "shopify_sessions"`);
    }

}
