import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSavedShipments1779934206490 implements MigrationInterface {
    name = 'AddSavedShipments1779934206490'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "saved_shipments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "created_by_user_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "description" text, "status" character varying(20) NOT NULL DEFAULT 'draft', "tags" text array NOT NULL DEFAULT '{}'::text[], "shared_with_org" boolean NOT NULL DEFAULT false, "shipment" jsonb NOT NULL, "lines" jsonb NOT NULL DEFAULT '[]'::jsonb, "last_quote_snapshot" jsonb, "last_opened_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "archived_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6e0a8f759a74f515732b3195209" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d422199af592eeb60b330ff261" ON "saved_shipments" ("organization_id", "last_opened_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_099e628c77d8dfc16bdf5ae270" ON "saved_shipments" ("organization_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_589f32884daad11905c9ab0a05" ON "saved_shipments" ("organization_id", "updated_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_41475fdf98b3ce14cd559288c4" ON "saved_shipments" ("organization_id", "created_by_user_id") `);
        await queryRunner.query(`CREATE TABLE "saved_shipment_quote_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "saved_shipment_id" uuid NOT NULL, "organization_id" uuid NOT NULL, "created_by_user_id" uuid NOT NULL, "quote_request" jsonb NOT NULL, "quote_response" jsonb NOT NULL, "payable" numeric(18,4), "currency" character varying(8), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_26e04f9d21cc11a2ecf826d96dd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_45e44e8f4decdc12e90c74ab12" ON "saved_shipment_quote_snapshots" ("organization_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_8ef6f12d930e311065907ac6bb" ON "saved_shipment_quote_snapshots" ("saved_shipment_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "saved_shipments" ADD CONSTRAINT "FK_3c548a374e6f2cb15220437f218" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "saved_shipments" ADD CONSTRAINT "FK_6cde49db56f49c796c33ca8c821" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "saved_shipment_quote_snapshots" ADD CONSTRAINT "FK_d02026235ba2ef1185ae95b9ca6" FOREIGN KEY ("saved_shipment_id") REFERENCES "saved_shipments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "saved_shipment_quote_snapshots" DROP CONSTRAINT "FK_d02026235ba2ef1185ae95b9ca6"`);
        await queryRunner.query(`ALTER TABLE "saved_shipments" DROP CONSTRAINT "FK_6cde49db56f49c796c33ca8c821"`);
        await queryRunner.query(`ALTER TABLE "saved_shipments" DROP CONSTRAINT "FK_3c548a374e6f2cb15220437f218"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8ef6f12d930e311065907ac6bb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_45e44e8f4decdc12e90c74ab12"`);
        await queryRunner.query(`DROP TABLE "saved_shipment_quote_snapshots"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_41475fdf98b3ce14cd559288c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_589f32884daad11905c9ab0a05"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_099e628c77d8dfc16bdf5ae270"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d422199af592eeb60b330ff261"`);
        await queryRunner.query(`DROP TABLE "saved_shipments"`);
    }

}
