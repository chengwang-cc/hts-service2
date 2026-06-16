import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * idempotency_keys: persistence for the Idempotency-Key replay-protection
 * interceptor.
 *
 * Layout
 * ------
 * - (scope, key) is unique — used for lookup, scope namespaces the key
 *   across endpoints so a client can reuse the same key on unrelated
 *   operations without colliding.
 * - request_hash is stored separately so a replay with a DIFFERENT body
 *   under the SAME (scope, key) returns 409 (Stripe-shape behaviour)
 *   instead of silently returning the cached response.
 * - TTL is 24h, enforced on read (`createdAt` + 24h < now() → ignore).
 *   A separate cron will sweep expired rows; the read path itself never
 *   trusts a stale row.
 */
export class IdempotencyKeys1781635592589 implements MigrationInterface {
    name = 'IdempotencyKeys1781635592589'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scope" character varying(64) NOT NULL, "key" character varying(255) NOT NULL, "request_hash" character varying(64) NOT NULL, "organization_id" uuid, "status_code" integer NOT NULL, "response_body" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8ad20779ad0411107a56e53d0f6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5e72f040fdc5efc8eef52a388c" ON "idempotency_keys" ("created_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_15de2f76fa9f27ad8f33098360" ON "idempotency_keys" ("scope", "key") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_15de2f76fa9f27ad8f33098360"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5e72f040fdc5efc8eef52a388c"`);
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    }
}
