import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Partner usage hourly rollup table (P3.2). Pre-aggregated counters per
 * (partner, partner_user, endpoint, method, hour). Populated by
 * PartnerUsageRollupWorker every 5 minutes.
 *
 * Schema-additive only — no impact on existing tables.
 */
export class AddPartnerUsageHourly1780357152014 implements MigrationInterface {
    name = 'AddPartnerUsageHourly1780357152014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "partner_usage_hourly" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "bucket_hour" TIMESTAMP NOT NULL, "partner_id" uuid NOT NULL, "partner_user_id" uuid, "endpoint" character varying(255) NOT NULL, "method" character varying(10) NOT NULL, "requests" integer NOT NULL DEFAULT '0', "status2xx" integer NOT NULL DEFAULT '0', "status4xx" integer NOT NULL DEFAULT '0', "status5xx" integer NOT NULL DEFAULT '0', "p95_latency_ms" integer, "total_response_time_ms" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b5e886be07d9ce0b7575d6a58be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9b4b16093fc8d654d0466bb33b" ON "partner_usage_hourly" ("partner_id", "bucket_hour", "partner_user_id", "endpoint", "method") `);
        await queryRunner.query(`CREATE INDEX "IDX_9ba942ae8ac1679d3068aaf64e" ON "partner_usage_hourly" ("partner_id", "endpoint", "bucket_hour") `);
        await queryRunner.query(`CREATE INDEX "IDX_c6acc7f258d27dd383fc8164c1" ON "partner_usage_hourly" ("partner_id", "partner_user_id", "bucket_hour") `);
        await queryRunner.query(`CREATE INDEX "IDX_172d59555c1ece12908faa721b" ON "partner_usage_hourly" ("bucket_hour") `);
        await queryRunner.query(`CREATE INDEX "IDX_3ebd5a9d44a44023c86aa6f2ef" ON "partner_usage_hourly" ("partner_id", "bucket_hour") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_3ebd5a9d44a44023c86aa6f2ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_172d59555c1ece12908faa721b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c6acc7f258d27dd383fc8164c1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9ba942ae8ac1679d3068aaf64e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9b4b16093fc8d654d0466bb33b"`);
        await queryRunner.query(`DROP TABLE "partner_usage_hourly"`);
    }

}
