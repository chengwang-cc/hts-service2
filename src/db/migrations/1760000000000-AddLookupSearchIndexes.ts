import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLookupSearchIndexes1760000000000 implements MigrationInterface {
  name = 'AddLookupSearchIndexes1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_search_vector_gin
      ON hts
      USING GIN (search_vector)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        BEGIN
          CREATE INDEX IF NOT EXISTS idx_hts_embedding_hnsw_cosine
          ON hts
          USING hnsw (embedding vector_cosine_ops)
          WHERE embedding IS NOT NULL;
        EXCEPTION
          WHEN OTHERS THEN
            CREATE INDEX IF NOT EXISTS idx_hts_embedding_ivfflat_cosine
            ON hts
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        END;
      END
      $$;
    `);

    await queryRunner.query(`ANALYZE hts`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_hts_embedding_hnsw_cosine`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_hts_embedding_ivfflat_cosine`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_hts_search_vector_gin`);
  }
}
