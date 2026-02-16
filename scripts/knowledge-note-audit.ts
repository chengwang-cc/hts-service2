import 'reflect-metadata';
import dataSource from '../src/db/data-source';

type TableCount = {
  tableName: string;
  totalRows: number;
};

type IndexRow = {
  index_name: string;
  is_unique: boolean;
  columns: string[];
};

type MissingRefRow = {
  hts_number: string;
  source_column: string;
  target_chapter: string;
  note_number: string;
  reference_text: string;
};

const NOTE_TABLES = [
  'hts_documents',
  'hts_notes',
  'hts_note_rates',
  'hts_note_references',
  'hts_note_embeddings',
  'knowledge_chunks',
] as const;

const EXPECTED_INDEXES: Record<string, string[][]> = {
  hts_notes: [
    ['year', 'chapter', 'type', 'note_number'],
    ['year', 'chapter', 'note_number'],
  ],
  hts_note_references: [['hts_number', 'note_id', 'source_column', 'year']],
  hts_note_embeddings: [['is_current']],
};

async function getTableCounts(): Promise<TableCount[]> {
  const results: TableCount[] = [];

  for (const tableName of NOTE_TABLES) {
    const rows = await dataSource.query(`SELECT COUNT(*)::int AS total_rows FROM ${tableName}`);
    results.push({ tableName, totalRows: rows[0]?.total_rows ?? 0 });
  }

  return results;
}

async function getIndexes(tableName: string): Promise<IndexRow[]> {
  const rows = await dataSource.query(
    `
      SELECT
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        array_remove(array_agg(a.attname ORDER BY k.ordinality), NULL) AS columns
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      LEFT JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON true
      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relkind = 'r'
        AND t.relname = $1
      GROUP BY i.relname, ix.indisunique
      ORDER BY i.relname;
    `,
    [tableName],
  );

  return rows as IndexRow[];
}

function hasIndex(indexes: IndexRow[], expectedColumns: string[]): boolean {
  const expected = expectedColumns.join(',');

  return indexes.some((index) => normalizeColumns(index.columns).join(',') === expected);
}

function normalizeColumns(columns: string[] | string | null | undefined): string[] {
  if (!columns) {
    return [];
  }
  if (Array.isArray(columns)) {
    return columns;
  }

  const trimmed = columns.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function getDuplicateSummary(): Promise<Array<Record<string, any>>> {
  return dataSource.query(`
    SELECT
      year,
      chapter,
      type,
      note_number,
      COUNT(*)::int AS duplicate_count
    FROM hts_notes
    GROUP BY year, chapter, type, note_number
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, year DESC, chapter ASC, type ASC, note_number ASC
    LIMIT 50;
  `);
}

async function getReferenceCoverageSummary(): Promise<Record<string, number>> {
  const rows = await dataSource.query(`
    WITH active_rates AS (
      SELECT hts_number, chapter, version, 'general'::text AS source_column, general AS reference_text
      FROM hts
      WHERE is_active = true
        AND general ~* 'note\\s+[0-9]'
      UNION ALL
      SELECT hts_number, chapter, version, 'other'::text AS source_column, other AS reference_text
      FROM hts
      WHERE is_active = true
        AND other ~* 'note\\s+[0-9]'
    ),
    refs AS (
      SELECT
        hts_number,
        chapter,
        version,
        source_column,
        reference_text,
        (regexp_match(reference_text, '(?:u\\.?\\s*s\\.?\\s*)?note[s]?\\s*(?:no\\.?|number)?\\s*([0-9]+[a-z]?(?:\\([a-z0-9ivx]+\\))*)', 'i'))[1] AS note_number,
        COALESCE(
          lpad((regexp_match(reference_text, '\\bchapter\\s+(\\d{1,2})\\b', 'i'))[1], 2, '0'),
          chapter
        ) AS target_chapter
      FROM active_rates
    ),
    coverage AS (
      SELECT
        r.*,
        n.id AS note_id
      FROM refs r
      LEFT JOIN LATERAL (
        SELECT n.id
        FROM hts_notes n
        WHERE n.note_number = r.note_number
          AND n.chapter = r.target_chapter
        ORDER BY n.year DESC, n.updated_at DESC
        LIMIT 1
      ) n ON true
      WHERE r.note_number IS NOT NULL
    )
    SELECT
      COUNT(*)::int AS total_references,
      COUNT(*) FILTER (WHERE note_id IS NOT NULL)::int AS resolved_references,
      COUNT(*) FILTER (WHERE note_id IS NULL)::int AS unresolved_references
    FROM coverage;
  `);

  return rows[0] || {
    total_references: 0,
    resolved_references: 0,
    unresolved_references: 0,
  };
}

async function getUnresolvedReferenceSamples(limit: number): Promise<MissingRefRow[]> {
  const rows = await dataSource.query(
    `
      WITH active_rates AS (
        SELECT hts_number, chapter, version, 'general'::text AS source_column, general AS reference_text
        FROM hts
        WHERE is_active = true
          AND general ~* 'note\\s+[0-9]'
        UNION ALL
        SELECT hts_number, chapter, version, 'other'::text AS source_column, other AS reference_text
        FROM hts
        WHERE is_active = true
          AND other ~* 'note\\s+[0-9]'
      ),
      refs AS (
        SELECT
          hts_number,
          chapter,
          version,
          source_column,
          reference_text,
          (regexp_match(reference_text, '(?:u\\.?\\s*s\\.?\\s*)?note[s]?\\s*(?:no\\.?|number)?\\s*([0-9]+[a-z]?(?:\\([a-z0-9ivx]+\\))*)', 'i'))[1] AS note_number,
          COALESCE(
            lpad((regexp_match(reference_text, '\\bchapter\\s+(\\d{1,2})\\b', 'i'))[1], 2, '0'),
            chapter
          ) AS target_chapter
        FROM active_rates
      ),
      unresolved AS (
        SELECT
          r.*
        FROM refs r
        LEFT JOIN LATERAL (
          SELECT n.id
          FROM hts_notes n
          WHERE n.note_number = r.note_number
            AND n.chapter = r.target_chapter
          ORDER BY n.year DESC, n.updated_at DESC
          LIMIT 1
        ) n ON true
        WHERE r.note_number IS NOT NULL
          AND n.id IS NULL
      )
      SELECT
        hts_number,
        source_column,
        target_chapter,
        note_number,
        reference_text
      FROM unresolved
      ORDER BY hts_number ASC, source_column ASC
      LIMIT $1;
    `,
    [limit],
  );

  return rows as MissingRefRow[];
}

async function applyIndexFixes(): Promise<void> {
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_hts_notes_year_chapter_type_note_number ON hts_notes (year, chapter, type, note_number)',
    'CREATE INDEX IF NOT EXISTS idx_hts_notes_year_chapter_note_number ON hts_notes (year, chapter, note_number)',
    'CREATE INDEX IF NOT EXISTS idx_hts_note_references_lookup ON hts_note_references (hts_number, note_id, source_column, year)',
    'CREATE INDEX IF NOT EXISTS idx_hts_note_embeddings_is_current ON hts_note_embeddings (is_current)',
  ];

  for (const statement of statements) {
    await dataSource.query(statement);
  }

  try {
    await dataSource.query(
      'CREATE INDEX IF NOT EXISTS idx_hts_note_embeddings_embedding_ivfflat ON hts_note_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[warn] Could not create vector index: ${message}`);
  }
}

async function dedupeNotes(): Promise<number> {
  const rows = await dataSource.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY year, chapter, type, note_number
          ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rank_no
      FROM hts_notes
    ),
    deleted AS (
      DELETE FROM hts_notes n
      USING ranked r
      WHERE n.id = r.id
        AND r.rank_no > 1
      RETURNING n.id
    )
    SELECT COUNT(*)::int AS deleted_count FROM deleted;
  `);

  return rows[0]?.deleted_count ?? 0;
}

async function run(): Promise<void> {
  const shouldFixIndexes = process.argv.includes('--fix-indexes');
  const shouldDedupe = process.argv.includes('--dedupe-notes');

  await dataSource.initialize();

  try {
    if (shouldFixIndexes) {
      await applyIndexFixes();
      console.log('[fix] Applied index fixes');
    }

    if (shouldDedupe) {
      const deletedCount = await dedupeNotes();
      console.log(`[fix] Removed duplicate notes: ${deletedCount}`);
    }

    const tableCounts = await getTableCounts();
    console.log('\nNote-related table counts:');
    for (const row of tableCounts) {
      console.log(`- ${row.tableName}: ${row.totalRows}`);
    }

    console.log('\nIndex coverage:');
    for (const [tableName, expectedIndexes] of Object.entries(EXPECTED_INDEXES)) {
      const indexes = await getIndexes(tableName);
      for (const expectedColumns of expectedIndexes) {
        const ok = hasIndex(indexes, expectedColumns);
        console.log(`- ${tableName} (${expectedColumns.join(', ')}): ${ok ? 'OK' : 'MISSING'}`);
      }
    }

    const duplicates = await getDuplicateSummary();
    console.log(`\nDuplicate note key groups: ${duplicates.length}`);
    for (const duplicate of duplicates.slice(0, 10)) {
      console.log(
        `- year=${duplicate.year} chapter=${duplicate.chapter} type=${duplicate.type} note=${duplicate.note_number} dup=${duplicate.duplicate_count}`,
      );
    }

    const coverage = await getReferenceCoverageSummary();
    console.log('\nHTS note-reference coverage (general/other rate fields):');
    console.log(`- total references: ${coverage.total_references}`);
    console.log(`- resolved references: ${coverage.resolved_references}`);
    console.log(`- unresolved references: ${coverage.unresolved_references}`);

    const unresolvedSamples = await getUnresolvedReferenceSamples(20);
    if (unresolvedSamples.length > 0) {
      console.log('\nUnresolved reference samples:');
      for (const sample of unresolvedSamples) {
        console.log(
          `- ${sample.hts_number} [${sample.source_column}] -> chapter ${sample.target_chapter} note ${sample.note_number} | ${sample.reference_text}`,
        );
      }
    }
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error('knowledge-note-audit failed:', error);
  process.exit(1);
});
