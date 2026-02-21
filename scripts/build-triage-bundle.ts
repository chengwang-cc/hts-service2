import { config as loadEnv } from 'dotenv';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { Pool } from 'pg';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

type CsvRow = Record<string, string | null>;

const REPORTS_DIR = join(process.cwd(), 'docs', 'reports');

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows: CsvRow[], headers: string[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  values.push(current);
  return values;
}

async function pickLatestCaReport(): Promise<string> {
  const entries = await readdir(REPORTS_DIR);
  const candidates = entries
    .filter((name) => /^tariff-history-2025-vs-api-2026-.*\.csv$/.test(name))
    .sort();

  if (candidates.length === 0) {
    throw new Error('No tariff-history-2025-vs-api-2026 CSV report found');
  }

  return join(REPORTS_DIR, candidates[candidates.length - 1]);
}

async function loadCaMismatches(reportPath: string): Promise<CsvRow[]> {
  const content = await readFile(reportPath, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const statusIndex = headers.indexOf('status');
  if (statusIndex < 0) {
    throw new Error(`Missing "status" column in ${reportPath}`);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    if ((row.status || '').toLowerCase() === 'mismatch') {
      rows.push(row);
    }
  }

  return rows;
}

async function run(): Promise<void> {
  const sourceReport = process.env.TRIAGE_CA_SOURCE_REPORT || (await pickLatestCaReport());
  const outputTag =
    process.env.TRIAGE_OUTPUT_TAG ||
    `triage-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`;
  const outputDir = join(REPORTS_DIR, outputTag);

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'hts',
  });

  try {
    const mappedNoFormula = await pool.query<CsvRow>(
      `
      WITH code_map AS (
        SELECT DISTINCT ON (hts8)
          hts8,
          hts_number,
          source_version,
          general_rate,
          rate_formula
        FROM (
          SELECT
            LEFT(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g'), 8) AS hts8,
            hts_number,
            source_version,
            general_rate,
            rate_formula,
            CASE WHEN COALESCE(NULLIF(BTRIM(rate_formula), ''), '') <> '' THEN 0 ELSE 1 END AS formula_rank,
            CASE WHEN COALESCE(NULLIF(BTRIM(general_rate), ''), '') <> '' THEN 0 ELSE 1 END AS rate_text_rank,
            CASE
              WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 10 THEN 0
              WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 8 THEN 1
              ELSE 2
            END AS specificity_rank,
            LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) AS code_len
          FROM hts
          WHERE is_active = true
        ) ranked
        WHERE hts8 IS NOT NULL
          AND LENGTH(hts8) = 8
        ORDER BY hts8, formula_rank, rate_text_rank, specificity_rank, code_len DESC, hts_number
      )
      SELECT
        h.id::text AS row_id,
        h.hts8,
        m.hts_number AS mapped_2026_hts_number,
        m.source_version AS mapped_2026_source_version,
        h.mfn_text_rate,
        h.begin_effect_date::text AS begin_effect_date,
        h.end_effective_date::text AS end_effective_date,
        h.brief_description
      FROM hts_tariff_history_2025 h
      JOIN code_map m ON m.hts8 = h.hts8
      WHERE m.rate_formula IS NULL
        AND COALESCE(NULLIF(BTRIM(m.general_rate), ''), '') <> ''
      ORDER BY h.hts8, h.begin_effect_date, h.end_effective_date, h.id
      `,
    );

    const unmapped = await pool.query<CsvRow>(
      `
      WITH code_map AS (
        SELECT DISTINCT ON (hts8)
          hts8,
          hts_number
        FROM (
          SELECT
            LEFT(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g'), 8) AS hts8,
            hts_number,
            CASE WHEN COALESCE(NULLIF(BTRIM(rate_formula), ''), '') <> '' THEN 0 ELSE 1 END AS formula_rank,
            CASE WHEN COALESCE(NULLIF(BTRIM(general_rate), ''), '') <> '' THEN 0 ELSE 1 END AS rate_text_rank,
            CASE
              WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 10 THEN 0
              WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 8 THEN 1
              ELSE 2
            END AS specificity_rank,
            LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) AS code_len
          FROM hts
          WHERE is_active = true
        ) ranked
        WHERE hts8 IS NOT NULL
          AND LENGTH(hts8) = 8
        ORDER BY hts8, formula_rank, rate_text_rank, specificity_rank, code_len DESC, hts_number
      ),
      bridge AS (
        SELECT
          hts8,
          bridge_status,
          reason
        FROM hts_tariff_history_2025_code_bridge
        WHERE source_year = 2025
      )
      SELECT
        h.hts8,
        h.mfn_text_rate,
        h.begin_effect_date::text AS begin_effect_date,
        h.end_effective_date::text AS end_effective_date,
        h.brief_description,
        b.bridge_status,
        b.reason AS bridge_reason
      FROM hts_tariff_history_2025 h
      LEFT JOIN code_map m ON m.hts8 = h.hts8
      LEFT JOIN bridge b ON b.hts8 = h.hts8
      WHERE m.hts_number IS NULL
        AND COALESCE(b.bridge_status, '') <> 'RETIRED_CH99_PLACEHOLDER'
      ORDER BY h.hts8, h.begin_effect_date, h.end_effective_date, h.id
      `,
    );

    const caMismatches = await loadCaMismatches(sourceReport);

    await mkdir(outputDir, { recursive: true });

    const file1Headers = [
      'row_id',
      'hts8',
      'mapped_2026_hts_number',
      'mapped_2026_source_version',
      'mfn_text_rate',
      'begin_effect_date',
      'end_effective_date',
      'brief_description',
    ];
    const file2Headers = [
      'hts8',
      'mfn_text_rate',
      'begin_effect_date',
      'end_effective_date',
      'brief_description',
      'bridge_status',
      'bridge_reason',
    ];
    const file3Headers = Object.keys(caMismatches[0] || {
      row_id: '',
      hts8: '',
      api_hts_number: '',
      api_rate_source: '',
      api_formula_used: '',
      status: '',
      http_status: '',
      api_message: '',
      expected_2025_base_duty: '',
      api_2026_base_duty: '',
      delta: '',
      abs_delta: '',
      pct_delta: '',
      quantity1_code: '',
      quantity2_code: '',
      mfn_text_rate: '',
      begin_effect_date: '',
      end_effective_date: '',
    });

    await writeFile(
      join(outputDir, '1_mapped_no_formula_2026.csv'),
      buildCsv(mappedNoFormula.rows, file1Headers),
      'utf8',
    );
    await writeFile(
      join(outputDir, '2_unmapped_2025_hts8_to_active_2026.csv'),
      buildCsv(unmapped.rows, file2Headers),
      'utf8',
    );
    await writeFile(
      join(outputDir, '3_ca_mismatches_only.csv'),
      buildCsv(caMismatches, file3Headers),
      'utf8',
    );

    const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\..+/, ' UTC');
    const readme = [
      '# 2025 vs 2026 Triage Bundle',
      '',
      `Generated: ${generatedAt}`,
      '',
      `1. mapped-no-formula rows: \`1_mapped_no_formula_2026.csv\` (rows: ${mappedNoFormula.rows.length})`,
      `2. unmapped 2025 HTS8 codes: \`2_unmapped_2025_hts8_to_active_2026.csv\` (rows: ${unmapped.rows.length})`,
      `3. CA mismatches from full API run: \`3_ca_mismatches_only.csv\` (rows: ${caMismatches.length})`,
      '',
      'CA source report:',
      `\`${sourceReport}\``,
      '',
    ].join('\n');

    await writeFile(join(outputDir, 'README.md'), readme, 'utf8');

    console.log(
      JSON.stringify(
        {
          outputDir,
          counts: {
            mappedNoFormula: mappedNoFormula.rows.length,
            unmapped: unmapped.rows.length,
            caMismatches: caMismatches.length,
          },
          sourceReport,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
