#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import dataSource from '../src/db/data-source';

function parseArgs() {
  return {
    strict: process.argv.includes('--strict'),
    query:
      process.argv.find((arg) => arg.startsWith('--query='))?.split('=')[1] ||
      'transformer & comic & book',
  };
}

function normalizePlanRows(rows: Array<{ 'QUERY PLAN': string }>): string[] {
  return rows.map((row) => row['QUERY PLAN']);
}

function containsAny(lineSet: string[], patterns: string[]): boolean {
  const lowered = lineSet.join('\n').toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern.toLowerCase()));
}

async function main(): Promise<void> {
  const args = parseArgs();
  let shouldFail = false;

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const indexRows: Array<{ indexname: string; indexdef: string }> =
      await dataSource.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'hts'
          AND (
            indexname = 'idx_hts_search_vector_gin'
            OR indexname = 'idx_hts_embedding_hnsw_cosine'
            OR indexname = 'idx_hts_embedding_ivfflat_cosine'
          )
        ORDER BY indexname ASC
      `);

    console.log('Lookup Query Plan Check');
    console.log('');
    console.log('Indexes found:');
    if (indexRows.length === 0) {
      console.log('  (none)');
      shouldFail = true;
    } else {
      for (const row of indexRows) {
        console.log(`  - ${row.indexname}`);
      }
    }
    console.log('');

    const ftsPlanRows = (await dataSource.query(
      `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT hts_number
      FROM hts
      WHERE is_active = true
        AND search_vector @@ to_tsquery('english', $1)
      ORDER BY ts_rank_cd(search_vector, to_tsquery('english', $1)) DESC
      LIMIT 10
    `,
      [args.query],
    )) as Array<{ 'QUERY PLAN': string }>;

    const ftsPlan = normalizePlanRows(ftsPlanRows);
    const usesGin =
      containsAny(ftsPlan, ['Bitmap Index Scan', 'Index Scan']) &&
      containsAny(ftsPlan, ['idx_hts_search_vector_gin']);

    console.log('FTS plan (top lines):');
    for (const line of ftsPlan.slice(0, 8)) {
      console.log(`  ${line}`);
    }
    console.log(`FTS uses GIN index: ${usesGin ? 'yes' : 'no'}`);
    if (!usesGin) {
      shouldFail = true;
    }
    console.log('');

    const hasAnyEmbeddingIndex = indexRows.some((row) =>
      ['idx_hts_embedding_hnsw_cosine', 'idx_hts_embedding_ivfflat_cosine'].includes(
        row.indexname,
      ),
    );

    if (hasAnyEmbeddingIndex) {
      const sampleEmbeddingRows = (await dataSource.query(`
        SELECT embedding::text AS embedding
        FROM hts
        WHERE embedding IS NOT NULL
        LIMIT 1
      `)) as Array<{ embedding: string }>;

      if (sampleEmbeddingRows.length === 0) {
        console.log('Vector plan skipped (no non-null embeddings found).');
        shouldFail = true;
      } else {
        const sampleEmbedding = sampleEmbeddingRows[0].embedding;
        const vectorPlanRows = (await dataSource.query(
          `
          EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
          SELECT h1.hts_number
          FROM hts h1
          WHERE h1.is_active = true
            AND h1.embedding IS NOT NULL
          ORDER BY h1.embedding <=> $1::vector
          LIMIT 10
        `,
          [sampleEmbedding],
        )) as Array<{ 'QUERY PLAN': string }>;

        const vectorPlan = normalizePlanRows(vectorPlanRows);
        const usesVectorIndex = containsAny(vectorPlan, [
          'idx_hts_embedding_hnsw_cosine',
          'idx_hts_embedding_ivfflat_cosine',
        ]);

        console.log('Vector plan (top lines):');
        for (const line of vectorPlan.slice(0, 8)) {
          console.log(`  ${line}`);
        }
        console.log(`Vector uses ANN index: ${usesVectorIndex ? 'yes' : 'no'}`);
        if (!usesVectorIndex) {
          shouldFail = true;
        }
        console.log('');
      }
    } else {
      console.log('Vector plan skipped (no ANN index found).');
      shouldFail = true;
    }

    if (shouldFail) {
      console.log('Result: CHECK FAILED');
      if (args.strict) {
        process.exit(1);
      }
    } else {
      console.log('Result: CHECK PASSED');
    }
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
