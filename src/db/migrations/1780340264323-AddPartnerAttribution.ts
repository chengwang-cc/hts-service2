import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Partner attribution — P1 schema.
 *
 *   1. New tables: partner_users, partner_origins
 *   2. organizations: add `type` (internal|partner|customer), `slug`
 *   3. api_keys: add `purpose` (server|browser)
 *   4. api_usage_metrics:
 *        - api_key_id → nullable (anonymous origin-attributed traffic has no key)
 *        - new columns: partner_id, partner_user_id, attribution_source,
 *          origin, hts_code, country_code
 *        - new indexes: (partner_id, timestamp), (partner_user_id, timestamp),
 *          (endpoint, partner_id, timestamp)
 *
 * Schema-additive only. Existing rows remain untouched.
 */
export class AddPartnerAttribution1780340264323 implements MigrationInterface {
    name = 'AddPartnerAttribution1780340264323'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ── partner_users ────────────────────────────────────────────────────
        await queryRunner.query(`CREATE TABLE "partner_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "external_user_id" character varying(255) NOT NULL, "first_seen_at" TIMESTAMP NOT NULL DEFAULT now(), "last_seen_at" TIMESTAMP NOT NULL DEFAULT now(), "request_count" bigint NOT NULL DEFAULT '0', "metadata" jsonb, CONSTRAINT "PK_01e1d1692cba17ceecf86942a8e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_30fff49fc57c5aab133c1570b8" ON "partner_users" ("organization_id", "last_seen_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_689dbf9019a7470a693ef0eaa3" ON "partner_users" ("organization_id", "external_user_id") `);

        // ── partner_origins ──────────────────────────────────────────────────
        await queryRunner.query(`CREATE TABLE "partner_origins" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "origin_pattern" character varying(255) NOT NULL, "purpose" character varying(20) NOT NULL DEFAULT 'web', "is_active" boolean NOT NULL DEFAULT true, "notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_822ce0beb7d255794c74fe493c0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8b073dc19796d8c7b77d947a99" ON "partner_origins" ("origin_pattern") `);
        await queryRunner.query(`CREATE INDEX "IDX_c91e80a2c01da67ba715f282d7" ON "partner_origins" ("is_active", "organization_id") `);

        // ── organizations: type + slug ───────────────────────────────────────
        await queryRunner.query(`ALTER TABLE "organizations" ADD "type" character varying(20) NOT NULL DEFAULT 'customer'`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "slug" character varying(64)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d635c51aa3a49329a1277553aa" ON "organizations" ("slug") WHERE slug IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_75ab46ec444b5b92644abfe98e" ON "organizations" ("type", "is_active") `);

        // ── api_keys: purpose ────────────────────────────────────────────────
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "purpose" character varying(20) NOT NULL DEFAULT 'server'`);

        // ── api_usage_metrics: attribution columns + nullable api_key_id ─────
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "partner_id" uuid`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "partner_user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "attribution_source" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "origin" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "hts_code" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ADD "country_code" character varying(8)`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ALTER COLUMN "api_key_id" DROP NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_a0780e09105b576241be6ebda4" ON "api_usage_metrics" ("endpoint", "partner_id", "timestamp") `);
        await queryRunner.query(`CREATE INDEX "IDX_85fa475d780971ce42822a5088" ON "api_usage_metrics" ("partner_user_id", "timestamp") `);
        await queryRunner.query(`CREATE INDEX "IDX_419947447feb3c9f2fba1e9b8a" ON "api_usage_metrics" ("partner_id", "timestamp") `);

        // ── FKs ──────────────────────────────────────────────────────────────
        await queryRunner.query(`ALTER TABLE "partner_users" ADD CONSTRAINT "FK_175f9352b44ac6ee5d35a8945cf" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "partner_origins" ADD CONSTRAINT "FK_e56dedbe4b6bba84ec404b7758c" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "partner_origins" DROP CONSTRAINT "FK_e56dedbe4b6bba84ec404b7758c"`);
        await queryRunner.query(`ALTER TABLE "partner_users" DROP CONSTRAINT "FK_175f9352b44ac6ee5d35a8945cf"`);

        await queryRunner.query(`DROP INDEX "public"."IDX_419947447feb3c9f2fba1e9b8a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_85fa475d780971ce42822a5088"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a0780e09105b576241be6ebda4"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" ALTER COLUMN "api_key_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "country_code"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "hts_code"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "origin"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "attribution_source"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "partner_user_id"`);
        await queryRunner.query(`ALTER TABLE "api_usage_metrics" DROP COLUMN "partner_id"`);

        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "purpose"`);

        await queryRunner.query(`DROP INDEX "public"."IDX_75ab46ec444b5b92644abfe98e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d635c51aa3a49329a1277553aa"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "slug"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "type"`);

        await queryRunner.query(`DROP INDEX "public"."IDX_c91e80a2c01da67ba715f282d7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8b073dc19796d8c7b77d947a99"`);
        await queryRunner.query(`DROP TABLE "partner_origins"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_689dbf9019a7470a693ef0eaa3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_30fff49fc57c5aab133c1570b8"`);
        await queryRunner.query(`DROP TABLE "partner_users"`);
    }

}
