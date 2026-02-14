import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add pg-boss schema and checkpoint column
 *
 * 1. Creates pgboss schema for pg-boss job queue
 * 2. Adds checkpoint column to hts_import_history for crash recovery
 * 3. Adds s3_key and s3_bucket columns for S3 file tracking
 * 4. Adds job_id column for pg-boss job tracking
 * 5. Adds download tracking columns
 *
 * NOTE: hts_document table changes are commented out as that table may not exist yet
 */
export class AddPgBossAndCheckpoint20260213194845 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ====== 1. Create pgboss schema ======
    await queryRunner.query(`
      CREATE SCHEMA IF NOT EXISTS pgboss;
    `);

    // NOTE: pg-boss will automatically create its tables on first start

    // ====== 2. Add checkpoint column to hts_import_history ======
    await queryRunner.query(`
      ALTER TABLE hts_import_history
      ADD COLUMN IF NOT EXISTS checkpoint JSONB DEFAULT NULL;
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN hts_import_history.checkpoint IS
      'Checkpoint data for crash recovery: {stage, s3Key, processedBatches, lastProcessedChapter, etc}';
    `);

    // Add index for faster checkpoint queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_import_checkpoint
      ON hts_import_history USING GIN (checkpoint);
    `);

    // Add S3 file tracking columns
    await queryRunner.query(`
      ALTER TABLE hts_import_history
      ADD COLUMN IF NOT EXISTS s3_bucket VARCHAR(255) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS s3_file_hash VARCHAR(64) DEFAULT NULL;
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN hts_import_history.s3_bucket IS 'S3 bucket where raw data is stored';
      COMMENT ON COLUMN hts_import_history.s3_key IS 'S3 key (path) to raw data file';
      COMMENT ON COLUMN hts_import_history.s3_file_hash IS 'SHA-256 hash of S3 file for verification';
    `);

    // ====== 3. Add job_id column for tracking pg-boss jobs ======
    await queryRunner.query(`
      ALTER TABLE hts_import_history
      ADD COLUMN IF NOT EXISTS job_id VARCHAR(100) DEFAULT NULL;
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN hts_import_history.job_id IS 'pg-boss job ID for tracking job status';
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_import_job_id
      ON hts_import_history (job_id);
    `);

    // ====== 4. Add download tracking columns ======
    await queryRunner.query(`
      ALTER TABLE hts_import_history
      ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMP DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS download_size_bytes BIGINT DEFAULT NULL;
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN hts_import_history.downloaded_at IS 'Timestamp when raw data was downloaded to S3';
      COMMENT ON COLUMN hts_import_history.download_size_bytes IS 'Size of downloaded file in bytes';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove columns from hts_import_history
    await queryRunner.query(`
      ALTER TABLE hts_import_history
      DROP COLUMN IF EXISTS download_size_bytes,
      DROP COLUMN IF EXISTS downloaded_at,
      DROP COLUMN IF EXISTS job_id,
      DROP COLUMN IF EXISTS s3_file_hash,
      DROP COLUMN IF EXISTS s3_key,
      DROP COLUMN IF EXISTS s3_bucket,
      DROP COLUMN IF EXISTS checkpoint;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_hts_import_job_id;
      DROP INDEX IF EXISTS idx_hts_import_checkpoint;
    `);

    // Drop pgboss schema (CASCADE to drop all tables)
    await queryRunner.query(`
      DROP SCHEMA IF EXISTS pgboss CASCADE;
    `);
  }
}
