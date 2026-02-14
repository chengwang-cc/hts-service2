import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentS3AndCheckpoint1771041467087 implements MigrationInterface {
    name = 'AddDocumentS3AndCheckpoint1771041467087'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_hts_import_checkpoint"`);
        await queryRunner.query(`DROP INDEX "public"."idx_hts_import_job_id"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "checkpoint" jsonb`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "s3_bucket" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "s3_key" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "s3_file_hash" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "hts_documents" ADD "job_id" character varying(100)`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."checkpoint" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."s3_bucket" IS NULL`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "s3_bucket" DROP DEFAULT`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."s3_key" IS NULL`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "s3_key" DROP DEFAULT`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."s3_file_hash" IS NULL`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "s3_file_hash" DROP DEFAULT`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."job_id" IS NULL`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "job_id" DROP DEFAULT`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."downloaded_at" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."download_size_bytes" IS NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_1a77c375eaf4080467b356057c" ON "hts_documents" ("checkpoint") `);
        await queryRunner.query(`CREATE INDEX "IDX_7a8dc27c3c19f76bff6be0ecc6" ON "hts_documents" ("job_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_cc7a59dd162756f80ea7c7ae49" ON "hts_import_history" ("checkpoint") `);
        await queryRunner.query(`CREATE INDEX "IDX_07981ba7d94d264616abca9503" ON "hts_import_history" ("job_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_07981ba7d94d264616abca9503"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cc7a59dd162756f80ea7c7ae49"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7a8dc27c3c19f76bff6be0ecc6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1a77c375eaf4080467b356057c"`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."download_size_bytes" IS 'Size of downloaded file in bytes'`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."downloaded_at" IS 'Timestamp when raw data was downloaded to S3'`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "job_id" SET DEFAULT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."job_id" IS 'pg-boss job ID for tracking job status'`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "s3_file_hash" SET DEFAULT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."s3_file_hash" IS 'SHA-256 hash of S3 file for verification'`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "s3_key" SET DEFAULT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."s3_key" IS 'S3 key (path) to raw data file'`);
        await queryRunner.query(`ALTER TABLE "hts_import_history" ALTER COLUMN "s3_bucket" SET DEFAULT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."s3_bucket" IS 'S3 bucket where raw data is stored'`);
        await queryRunner.query(`COMMENT ON COLUMN "hts_import_history"."checkpoint" IS 'Checkpoint data for crash recovery: {stage, s3Key, processedBatches, lastProcessedChapter, etc}'`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "job_id"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "s3_file_hash"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "s3_key"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "s3_bucket"`);
        await queryRunner.query(`ALTER TABLE "hts_documents" DROP COLUMN "checkpoint"`);
        await queryRunner.query(`CREATE INDEX "idx_hts_import_job_id" ON "hts_import_history" ("job_id") `);
        await queryRunner.query(`CREATE INDEX "idx_hts_import_checkpoint" ON "hts_import_history" ("checkpoint") `);
    }

}
