#!/usr/bin/env ts-node
/**
 * Create HNSW index on hts.embedding for fast approximate nearest-neighbor search.
 *
 * This script is run AFTER corpus re-embedding is complete.
 * Creating the index on a populated table is much more efficient than building
 * incrementally during data load, and allows CONCURRENTLY to avoid locking.
 *
 * pgvector HNSW parameters:
 *   m=16        — max connections per layer (higher = better recall, more memory)
 *   ef_construction=64 — build-time search width (higher = better recall, slower build)
 *
 * Usage:
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/create-hnsw-index.ts
 */
import 'tsconfig-paths/register';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USERNAME || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'hts'}`;

  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log('Checking embedding coverage...');
    const coverageResult = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
        COUNT(*) AS total
      FROM hts
      WHERE is_active = true
    `);
    const { embedded, total } = coverageResult.rows[0];
    const pct = ((parseInt(embedded) / parseInt(total)) * 100).toFixed(1);
    console.log(`Embedded: ${embedded}/${total} (${pct}%)`);

    if (parseInt(embedded) < parseInt(total) * 0.9) {
      console.warn(
        `WARNING: Only ${pct}% of HTS entries have embeddings. Consider waiting for re-embedding to finish.`,
      );
    }

    // Drop old index if it exists (from 1536-dim era)
    console.log('\nDropping old embedding indexes if they exist...');
    await client.query(`
      DROP INDEX CONCURRENTLY IF EXISTS idx_hts_embedding_hnsw;
      DROP INDEX CONCURRENTLY IF EXISTS idx_hts_embedding_ivfflat;
    `);

    // Create HNSW index on hts.embedding (cosine distance)
    console.log('Creating HNSW index on hts.embedding (cosine, m=16, ef_construction=64)...');
    console.log('(This may take 1-3 minutes for ~30k rows)');
    const t0 = Date.now();

    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hts_embedding_hnsw
        ON hts USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);

    console.log(`HNSW index created in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Set search ef_search for good recall at query time
    await client.query(`ALTER TABLE hts CLUSTER ON idx_hts_embedding_hnsw`).catch(() => {
      // CLUSTER is advisory — ignore if it fails
    });

    // Verify index was created
    const indexResult = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'hts' AND indexname = 'idx_hts_embedding_hnsw'
    `);

    if (indexResult.rows.length > 0) {
      console.log('\nIndex verified:');
      console.log(indexResult.rows[0].indexdef);
    }

    // Quick similarity test
    console.log('\nRunning similarity sanity check...');
    const sanityResult = await client.query(`
      SELECT hts_number, description,
             1 - (embedding <=> (
               SELECT embedding FROM hts
               WHERE hts_number = (SELECT hts_number FROM hts WHERE embedding IS NOT NULL LIMIT 1)
               LIMIT 1
             )) AS similarity
      FROM hts
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> (
        SELECT embedding FROM hts WHERE embedding IS NOT NULL LIMIT 1
      )
      LIMIT 5
    `);

    console.log('Top-5 nearest neighbors for first embedded entry:');
    for (const row of sanityResult.rows) {
      console.log(
        `  ${row.hts_number} (sim=${parseFloat(row.similarity).toFixed(4)}): ${row.description?.slice(0, 60)}`,
      );
    }

    console.log('\nDone! HNSW index is ready for approximate nearest-neighbor search.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
