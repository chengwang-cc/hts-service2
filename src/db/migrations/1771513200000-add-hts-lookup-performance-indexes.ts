import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHtsLookupPerformanceIndexes1771513200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_active_hts_number_pattern
      ON hts (hts_number text_pattern_ops)
      WHERE is_active = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_active_description_trgm
      ON hts USING gin (description gin_trgm_ops)
      WHERE is_active = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_embeddings_current_hts_number
      ON hts_embeddings (is_current, hts_number)
    `);

    try {
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_hts_embeddings_vector_cosine
        ON hts_embeddings USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);
    } catch {
      // Skip vector index creation when pgvector operator class is unavailable.
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_hts_embeddings_vector_cosine',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_hts_embeddings_current_hts_number',
    );
    await queryRunner.query('DROP INDEX IF EXISTS idx_hts_active_description_trgm');
    await queryRunner.query('DROP INDEX IF EXISTS idx_hts_active_hts_number_pattern');
  }
}
