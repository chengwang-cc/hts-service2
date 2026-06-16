import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cost-threshold alert tables (Phase 4b).
 *
 * - cost_alert_configs: one row per organization holding the partner /
 *   business admin's threshold, channels, optional webhook URL+secret,
 *   and `last_fired_period` for the at-most-one-per-month guarantee.
 * - cost_alert_events: append-only audit log of firings. The in-app
 *   banner reads "any unacknowledged row for this org in the current
 *   period?" — the event row is the source of truth, NOT recomputed
 *   from raw usage on every page load.
 *
 * No FK to organizations on purpose — the relationship is implicit by
 * convention here (matches how partner_usage_monthly references
 * organizations.id), and TypeORM's @Index decorators on the entity
 * already provide the lookup paths we need.
 */
export class CostAlertTables1781629236904 implements MigrationInterface {
    name = 'CostAlertTables1781629236904'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "cost_alert_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "threshold_usd" numeric(10,2) NOT NULL, "observed_cost_usd" numeric(14,6) NOT NULL, "period" date NOT NULL, "channels_delivered" jsonb NOT NULL DEFAULT '[]'::jsonb, "acknowledged_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2911c66fb1570216cb3743e6f16" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9bc1dfaad5d23a49e1622a40f6" ON "cost_alert_events" ("acknowledged_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_8a41104eabfaf98663416659e6" ON "cost_alert_events" ("organization_id", "period") `);
        await queryRunner.query(`CREATE TABLE "cost_alert_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "threshold_usd" numeric(10,2) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "channels" jsonb NOT NULL DEFAULT '["in_app"]'::jsonb, "webhook_url" character varying(2048), "webhook_secret" character varying(64), "last_fired_at" TIMESTAMP, "last_fired_period" date, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9d55927efb9b83bb4f72a979420" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4319e2564ad5fb4b0f410f8d18" ON "cost_alert_configs" ("enabled") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5e62bc081a3f4b6157e85997b4" ON "cost_alert_configs" ("organization_id") `);
        await queryRunner.query(`ALTER TABLE "cost_alert_configs" ADD CONSTRAINT "CK_cost_alert_threshold_positive" CHECK ("threshold_usd" > 0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cost_alert_configs" DROP CONSTRAINT "CK_cost_alert_threshold_positive"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5e62bc081a3f4b6157e85997b4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4319e2564ad5fb4b0f410f8d18"`);
        await queryRunner.query(`DROP TABLE "cost_alert_configs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8a41104eabfaf98663416659e6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9bc1dfaad5d23a49e1622a40f6"`);
        await queryRunner.query(`DROP TABLE "cost_alert_events"`);
    }

}
