import { MigrationInterface, QueryRunner } from "typeorm";

export class BrokerOutreachDiscoveryLedger1779821954300 implements MigrationInterface {
    name = 'BrokerOutreachDiscoveryLedger1779821954300'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "broker_outreach_discovery_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying(32) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'pending', "input" jsonb NOT NULL, "fetched_count" integer NOT NULL DEFAULT '0', "inserted_count" integer NOT NULL DEFAULT '0', "updated_count" integer NOT NULL DEFAULT '0', "failed_count" integer NOT NULL DEFAULT '0', "error_message" text, "triggered_by" character varying(200) NOT NULL, "job_id" character varying(120), "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a398d787eb190684cbb879b4849" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_75aaec60df61f26c9fb52a5cf5" ON "broker_outreach_discovery_runs" ("status", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_afe6df6cc566419fdc26b63553" ON "broker_outreach_discovery_runs" ("provider", "created_at") `);
        await queryRunner.query(`CREATE TABLE "broker_outreach_discovery_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'ingested', "external_id" character varying(255), "company_name" character varying(255), "website_url" character varying(500), "lead_id" uuid, "payload" jsonb, "error_message" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_527e8a311c342a7c5e5ee7c5400" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2626a637fe3066a2aeb131907e" ON "broker_outreach_discovery_results" ("lead_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_6b0c9330a9c616b3b30b92aa41" ON "broker_outreach_discovery_results" ("run_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_8f86beee4c5f4b11d43cee69d9" ON "broker_outreach_discovery_results" ("run_id", "created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_8f86beee4c5f4b11d43cee69d9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b0c9330a9c616b3b30b92aa41"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2626a637fe3066a2aeb131907e"`);
        await queryRunner.query(`DROP TABLE "broker_outreach_discovery_results"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_afe6df6cc566419fdc26b63553"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_75aaec60df61f26c9fb52a5cf5"`);
        await queryRunner.query(`DROP TABLE "broker_outreach_discovery_runs"`);
    }

}
