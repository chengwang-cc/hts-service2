import { MigrationInterface, QueryRunner } from "typeorm";

export class EcommerceHandoff1779823021526 implements MigrationInterface {
    name = 'EcommerceHandoff1779823021526'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ecommerce_handoffs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "platform" character varying(32) NOT NULL, "external_order_id" character varying(120) NOT NULL, "external_store_id" character varying(255), "state" character varying(32) NOT NULL DEFAULT 'broker_review_required', "origin_country" character varying(8) NOT NULL, "destination_country" character varying(8) NOT NULL, "port_of_entry" character varying(12), "items" jsonb NOT NULL, "shipment_value" numeric(14,2), "shipment_currency" character varying(8), "marketplace_request_id" uuid, "writeback_status" jsonb, "metadata" jsonb, "created_by" character varying(200) NOT NULL DEFAULT 'system', "updated_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b99656f209897072f0a2300db1d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3f8ae7afdd4a8c616e66ceebc7" ON "ecommerce_handoffs" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_80d0dd0b22acb29fb77e1de09e" ON "ecommerce_handoffs" ("organization_id", "state") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5904ab61b895331882ba691a84" ON "ecommerce_handoffs" ("organization_id", "platform", "external_order_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_5904ab61b895331882ba691a84"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_80d0dd0b22acb29fb77e1de09e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3f8ae7afdd4a8c616e66ceebc7"`);
        await queryRunner.query(`DROP TABLE "ecommerce_handoffs"`);
    }

}
