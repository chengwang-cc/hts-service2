import { MigrationInterface, QueryRunner } from 'typeorm';

export class MergeHtsEmbeddingsIntoHts1771718870060
  implements MigrationInterface
{
  name = 'MergeHtsEmbeddingsIntoHts1771718870060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add embedding columns to hts table
    await queryRunner.query(
      `ALTER TABLE "hts" ADD "embedding" vector(1536)`,
    );
    await queryRunner.query(
      `ALTER TABLE "hts" ADD "embedding_search_text" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "hts" ADD "embedding_model" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "hts" ADD "embedding_generated_at" TIMESTAMP`,
    );

    // 2. Migrate existing embeddings from hts_embeddings into hts
    await queryRunner.query(`
      UPDATE hts h
      SET
        embedding             = e.embedding,
        embedding_search_text = e.search_text,
        embedding_model       = e.model,
        embedding_generated_at = e.generated_at
      FROM hts_embeddings e
      WHERE h.hts_number = e.hts_number
    `);

    // 3. HNSW index for fast pgvector cosine similarity search
    //    HNSW supports incremental inserts and works on empty tables (unlike IVFFlat)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_embedding_hnsw
        ON hts USING hnsw (embedding vector_cosine_ops)
        WHERE embedding IS NOT NULL
    `);

    // 4. GIN index for fast full-text search on search_vector
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_hts_search_vector
        ON hts USING gin(search_vector)
    `);

    // 5. Ensure the trigger function exists (idempotent)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION hts_search_vector_trigger()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.search_vector := to_tsvector('english',
          COALESCE(NEW.hts_number, '') || ' ' ||
          COALESCE(NEW.description, '')
        );
        RETURN NEW;
      END;
      $$
    `);

    // 6. Attach trigger to hts table (idempotent via DROP IF EXISTS)
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS hts_search_vector_update ON hts`,
    );
    await queryRunner.query(`
      CREATE TRIGGER hts_search_vector_update
        BEFORE INSERT OR UPDATE ON hts
        FOR EACH ROW EXECUTE FUNCTION hts_search_vector_trigger()
    `);

    // 7. Backfill search_vector for any rows that are still NULL
    await queryRunner.query(`
      UPDATE hts
      SET search_vector = to_tsvector('english',
        COALESCE(hts_number, '') || ' ' || COALESCE(description, '')
      )
      WHERE search_vector IS NULL
    `);

    // 8. Drop the now-redundant hts_embeddings table
    await queryRunner.query(`DROP TABLE IF EXISTS hts_embeddings`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate hts_embeddings from the data still on hts
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS hts_embeddings (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        hts_number character varying(20) UNIQUE NOT NULL,
        embedding vector(1536) NOT NULL,
        search_text text NOT NULL,
        search_vector tsvector,
        model character varying(50) NOT NULL DEFAULT 'text-embedding-3-small',
        model_version character varying(50),
        generated_at TIMESTAMP NOT NULL DEFAULT now(),
        is_current boolean NOT NULL DEFAULT true,
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO hts_embeddings
        (hts_number, embedding, search_text, model, generated_at)
      SELECT
        hts_number,
        embedding,
        COALESCE(embedding_search_text, ''),
        COALESCE(embedding_model, 'text-embedding-3-small'),
        COALESCE(embedding_generated_at, now())
      FROM hts
      WHERE embedding IS NOT NULL
    `);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS hts_search_vector_update ON hts`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_hts_search_vector`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_hts_embedding_hnsw`,
    );
    await queryRunner.query(
      `ALTER TABLE "hts" DROP COLUMN "embedding_generated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hts" DROP COLUMN "embedding_model"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hts" DROP COLUMN "embedding_search_text"`,
    );
    await queryRunner.query(`ALTER TABLE "hts" DROP COLUMN "embedding"`);
  }
}
