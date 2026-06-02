import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Partner attribution hardening — addresses three issues found in the
 * post-P3 code review:
 *
 *   1. partner_usage_hourly unique index treats NULL as distinct, so the
 *      ON CONFLICT DO UPDATE branch in PartnerUsageRollupWorker never fires
 *      for anonymous rows (partner_user_id IS NULL). pg-boss retries or
 *      manual re-runs could insert duplicate rows. Fix: recreate the index
 *      with NULLS NOT DISTINCT (PG 15+).
 *
 *   2. partner_users needs a partial unique on (organization_id,
 *      external_user_id) to back the new INSERT ... ON CONFLICT upsert in
 *      AttributionMiddleware. The migration AddPartnerAttribution1780340264323
 *      already created this with the right shape — no change needed here,
 *      just calling it out.
 *
 *   3. organizations.metadata.jwtSecret in DB is plaintext; planned move
 *      to Secrets Manager is tracked separately (no migration required for
 *      that — it's a runtime config change).
 *
 * Schema-additive only — drops a no-longer-needed index and recreates it
 * with NULLS NOT DISTINCT. Existing rows are untouched.
 */
export class PartnerAttributionHardening1780381244767 implements MigrationInterface {
    name = 'PartnerAttributionHardening1780381244767'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // (1) Recreate partner_usage_hourly unique index with NULLS NOT DISTINCT.
        // The old index name comes from TypeORM's hashed naming.
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_9b4b16093fc8d654d0466bb33b"`);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_9b4b16093fc8d654d0466bb33b" ` +
            `ON "partner_usage_hourly" ` +
            `("partner_id", "bucket_hour", "partner_user_id", "endpoint", "method") ` +
            `NULLS NOT DISTINCT`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_9b4b16093fc8d654d0466bb33b"`);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_9b4b16093fc8d654d0466bb33b" ` +
            `ON "partner_usage_hourly" ` +
            `("partner_id", "bucket_hour", "partner_user_id", "endpoint", "method")`
        );
    }

}
