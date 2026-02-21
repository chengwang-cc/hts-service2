import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreditPurchaseAndAutoTopup1771618242560 implements MigrationInterface {
    name = 'AddCreditPurchaseAndAutoTopup1771618242560'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "credit_purchases" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "stripe_session_id" character varying(255) NOT NULL, "stripe_payment_intent_id" character varying(255), "credits" integer NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'USD', "status" character varying(50) NOT NULL DEFAULT 'pending', "return_url" text NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP, CONSTRAINT "PK_89d96f2901d625d5879c1bc6f47" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ba3b1054ab30afce50760e8838" ON "credit_purchases" ("stripe_session_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_932e7ec556c8c0af3333c8f7b0" ON "credit_purchases" ("organization_id", "status") `);
        await queryRunner.query(`CREATE TABLE "credit_balances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "balance" integer NOT NULL DEFAULT '0', "lifetime_purchased" integer NOT NULL DEFAULT '0', "lifetime_used" integer NOT NULL DEFAULT '0', "last_purchase_at" TIMESTAMP, "last_used_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b9f1be6c9f3f23c5716fa7d8545" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2c5b34b1029a5ec187a07e3f1f" ON "credit_balances" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "auto_topup_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "trigger_threshold" integer NOT NULL DEFAULT '5', "recharge_amount" integer NOT NULL DEFAULT '20', "monthly_spending_cap" numeric(10,2), "current_month_spent" numeric(10,2) NOT NULL DEFAULT '0', "current_month" integer NOT NULL DEFAULT '1', "current_year" integer NOT NULL DEFAULT '2026', "stripe_payment_method_id" character varying(255), "stripe_customer_id" character varying(255), "enabled" boolean NOT NULL DEFAULT true, "email_notifications" boolean NOT NULL DEFAULT true, "last_triggered_at" TIMESTAMP, "total_auto_purchases" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_af1714d3b532d1e026a966ef8d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_38baa0d834f93345a053c8202d" ON "auto_topup_configs" ("organization_id") `);
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "preference_programs" SET DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "math_components" SET DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "external_provider_formulas" ALTER COLUMN "extraction_confidence" SET DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "external_provider_formulas" ALTER COLUMN "extraction_confidence" SET DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "math_components" SET DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "hts_tariff_history_2025" ALTER COLUMN "preference_programs" SET DEFAULT '{}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_38baa0d834f93345a053c8202d"`);
        await queryRunner.query(`DROP TABLE "auto_topup_configs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c5b34b1029a5ec187a07e3f1f"`);
        await queryRunner.query(`DROP TABLE "credit_balances"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_932e7ec556c8c0af3333c8f7b0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ba3b1054ab30afce50760e8838"`);
        await queryRunner.query(`DROP TABLE "credit_purchases"`);
    }

}
