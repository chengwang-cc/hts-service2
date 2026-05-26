import { MigrationInterface, QueryRunner } from "typeorm";

export class BrokerOutreachFoundation1779817044409 implements MigrationInterface {
    name = 'BrokerOutreachFoundation1779817044409'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "broker_outreach_campaigns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(180) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'draft', "audience" text, "objective" text, "email_subject" character varying(255), "email_body" text, "ai_prompt" text, "metrics" jsonb, "created_by" character varying(200) NOT NULL DEFAULT 'system', "updated_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dbb277e9c2934dce78e2e98284c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7083d628e434e667afc3cfc08a" ON "broker_outreach_campaigns" ("status", "created_at") `);
        await queryRunner.query(`CREATE TABLE "broker_outreach_leads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_name" character varying(255) NOT NULL, "source_provider" character varying(32) NOT NULL DEFAULT 'manual', "source_external_id" character varying(255), "business_category" character varying(120), "website_url" character varying(500), "domain" character varying(255), "contact_email" character varying(255), "contact_phone" character varying(60), "country" character varying(80), "region" character varying(120), "city" character varying(120), "address" text, "latitude" numeric(10,7), "longitude" numeric(10,7), "status" character varying(24) NOT NULL DEFAULT 'new', "score" numeric(5,2) NOT NULL DEFAULT '0', "tags" jsonb NOT NULL DEFAULT '[]', "metadata" jsonb, "last_imported_at" TIMESTAMP WITH TIME ZONE, "last_contacted_at" TIMESTAMP WITH TIME ZONE, "converted_at" TIMESTAMP WITH TIME ZONE, "created_by" character varying(200) NOT NULL DEFAULT 'system', "updated_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_28070cf7ec1cb1466dcad4844e1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9a54923e5611a77cb8384542cb" ON "broker_outreach_leads" ("domain") `);
        await queryRunner.query(`CREATE INDEX "IDX_e30f6c2f146a32e83c95c9060e" ON "broker_outreach_leads" ("country", "business_category") `);
        await queryRunner.query(`CREATE INDEX "IDX_2b9784c31cc0f0222d0a30ccc1" ON "broker_outreach_leads" ("status", "created_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5f7bbf6d3d0f00cb370490c6b4" ON "broker_outreach_leads" ("source_provider", "source_external_id") `);
        await queryRunner.query(`CREATE TABLE "broker_outreach_invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lead_id" uuid NOT NULL, "campaign_id" uuid, "email" character varying(255) NOT NULL, "token_hash" character varying(64) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'created', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "sent_at" TIMESTAMP WITH TIME ZONE, "opened_at" TIMESTAMP WITH TIME ZONE, "claimed_at" TIMESTAMP WITH TIME ZONE, "claimed_organization_id" uuid, "claimed_user_id" uuid, "metadata" jsonb, "created_by" character varying(200) NOT NULL DEFAULT 'system', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2cc19d779628c140ef31de98e9c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_93fc4ab69262b538a28d6b3b66" ON "broker_outreach_invites" ("status", "expires_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_114ba73a858890e32267b512aa" ON "broker_outreach_invites" ("campaign_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_ef8afbbf3719cc140da3517388" ON "broker_outreach_invites" ("lead_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b3c2ff7219e0353fc23cdc678b" ON "broker_outreach_invites" ("token_hash") `);
        await queryRunner.query(`ALTER TABLE "broker_outreach_invites" ADD CONSTRAINT "FK_d433f7a70dccafd5879d5249f3d" FOREIGN KEY ("lead_id") REFERENCES "broker_outreach_leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "broker_outreach_invites" ADD CONSTRAINT "FK_cf431fdb862c4ca846c11a64ea7" FOREIGN KEY ("campaign_id") REFERENCES "broker_outreach_campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "broker_outreach_invites" DROP CONSTRAINT "FK_cf431fdb862c4ca846c11a64ea7"`);
        await queryRunner.query(`ALTER TABLE "broker_outreach_invites" DROP CONSTRAINT "FK_d433f7a70dccafd5879d5249f3d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b3c2ff7219e0353fc23cdc678b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ef8afbbf3719cc140da3517388"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_114ba73a858890e32267b512aa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_93fc4ab69262b538a28d6b3b66"`);
        await queryRunner.query(`DROP TABLE "broker_outreach_invites"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5f7bbf6d3d0f00cb370490c6b4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2b9784c31cc0f0222d0a30ccc1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e30f6c2f146a32e83c95c9060e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9a54923e5611a77cb8384542cb"`);
        await queryRunner.query(`DROP TABLE "broker_outreach_leads"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7083d628e434e667afc3cfc08a"`);
        await queryRunner.query(`DROP TABLE "broker_outreach_campaigns"`);
    }

}
