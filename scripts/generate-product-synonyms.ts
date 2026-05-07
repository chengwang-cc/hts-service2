#!/usr/bin/env ts-node
/**
 * Generate product synonyms for HTS "Other" leaf codes to improve embedding recall.
 *
 * For HTS codes whose description chain ends in generic terms ("Other", "NES", etc.),
 * uses Claude to generate 3-6 concrete consumer product names that belong there.
 * Stores results in hts.product_synonyms column, which is then included in
 * buildSearchText() to produce better embeddings.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/generate-product-synonyms.ts
 *   npx ts-node ... --chapters=39,61,62,42,85   # focus specific chapters
 *   npx ts-node ... --limit=500                  # limit rows to process
 *   npx ts-node ... --dry-run                    # print samples, no DB writes
 *   npx ts-node ... --force                      # regenerate even if already set
 */
import 'tsconfig-paths/register';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── Config ────────────────────────────────────────────────────────────────────

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const m = process.argv.find((a) => a.startsWith(prefix));
  return m ? m.slice(prefix.length) : fallback;
}

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const CHAPTERS_ARG = getArg('chapters'); // e.g. "39,61,62"
const LIMIT = parseInt(getArg('limit', '10000')!, 10);
const BATCH_SIZE = 10; // codes per Claude call
const CONCURRENCY = 4;
const PROGRESS_FILE = '/tmp/synonyms-progress.json';

// ── Generic description patterns that indicate vocabulary gap ─────────────────
const GENERIC_PATTERNS = [
  /^other$/i,
  /^other[:;,]/i,
  /\bother\b.*\bnes\b/i,
  /^not elsewhere specified/i,
  /^nes$/i,
  /^n\.e\.s\./i,
];

function isGenericDescription(desc: string): boolean {
  const trimmed = desc.trim();
  return GENERIC_PATTERNS.some((p) => p.test(trimmed));
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface HtsRow {
  id: number;
  hts_number: string;
  description: string;
  chapter: string;
  indent: number;
  full_description: string[] | null;
  product_synonyms: string | null;
}

interface SynonymResult {
  hts_number: string;
  synonyms: string[];
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function loadProgress(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveProgress(progress: Record<string, string[]>): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress), 'utf8');
}

// ── Claude synonym generation ─────────────────────────────────────────────────

async function generateSynonymsBatch(
  client: Anthropic,
  rows: HtsRow[],
): Promise<SynonymResult[]> {
  const itemsText = rows
    .map((row, i) => {
      const fullDesc = (row.full_description || []) as string[];
      const hierarchy = fullDesc.length > 0
        ? fullDesc.join(' > ')
        : `Chapter ${row.chapter}`;

      return [
        `## Code ${i + 1}: ${row.hts_number}`,
        `Classification path: ${hierarchy}`,
        `Leaf description: ${row.description}`,
      ].join('\n');
    })
    .join('\n\n');

  const prompt = `You are an HTS classification expert. For each HTS code below, list 3-6 specific consumer product names that would be classified under that code.

${itemsText}

Requirements:
- Be specific and concrete: "hockey puck" not "sporting goods"
- Use common names buyers use when searching: "extension cord" not "flexible cord"
- 2-4 words max per synonym
- No brand names
- Only list products that CLEARLY belong to this exact HTS code (not just the chapter)
- Skip if the code is too broad or ambiguous (return empty array)

Respond with JSON only:
{
  "results": [
    {"code_index": 1, "synonyms": ["product a", "product b", ...]},
    ...
  ]
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0] as { type: string; text: string }).text.trim();
  let parsed: { results: Array<{ code_index: number; synonyms: string[] }> };

  try {
    const clean = text.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    parsed = JSON.parse(clean);
  } catch {
    console.error('Failed to parse synonyms response:', text.slice(0, 200));
    return rows.map((r) => ({ hts_number: r.hts_number, synonyms: [] }));
  }

  return rows.map((row, i) => {
    const r = parsed.results.find((x) => x.code_index === i + 1) || parsed.results[i];
    return {
      hts_number: row.hts_number,
      synonyms: (r?.synonyms ?? []).filter((s) => typeof s === 'string' && s.trim()),
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  const db = new Client({
    host: process.env.DB_HOST || '192.168.1.209',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'wbroot0216',
    database: process.env.DB_DATABASE || 'hts',
  });
  await db.connect();
  console.log('Connected to DB');

  // ── Check / add product_synonyms column ──────────────────────────────────
  const colCheck = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hts' AND column_name = 'product_synonyms'
  `);

  if (colCheck.rows.length === 0) {
    console.log('Adding product_synonyms column...');
    if (!DRY_RUN) {
      await db.query(`ALTER TABLE hts ADD COLUMN product_synonyms TEXT NULL`);
    }
    console.log('Column added.');
  } else {
    console.log('product_synonyms column already exists.');
  }

  // ── Load target HTS codes ─────────────────────────────────────────────────
  let chaptersFilter = '';
  if (CHAPTERS_ARG) {
    const chapters = CHAPTERS_ARG.split(',').map((c) => c.trim().padStart(2, '0'));
    chaptersFilter = `AND chapter = ANY(ARRAY[${chapters.map((c) => `'${c}'`).join(',')}])`;
  }

  const existingFilter = FORCE ? '' : 'AND product_synonyms IS NULL';

  const result = await db.query<HtsRow>(`
    SELECT id, hts_number, description, chapter, indent,
           COALESCE(full_description::text, '[]') AS full_description,
           product_synonyms
    FROM hts
    WHERE is_active = true
      AND indent >= 3
      AND description IS NOT NULL
      ${chaptersFilter}
      ${existingFilter}
    ORDER BY chapter, hts_number
    LIMIT $1
  `, [LIMIT]);

  const allRows = result.rows.map((r) => ({
    ...r,
    full_description: (() => {
      try { return JSON.parse(r.full_description as unknown as string); } catch { return []; }
    })(),
  }));

  // Filter to rows with generic leaf descriptions (biggest vocabulary gap)
  const targetRows = allRows.filter((r) => {
    const desc = r.description || '';
    return isGenericDescription(desc) || desc.length < 15;
  });

  console.log(`Found ${allRows.length} candidate rows, ${targetRows.length} with generic descriptions`);

  if (DRY_RUN) {
    console.log('\nSample target codes:');
    for (const r of targetRows.slice(0, 10)) {
      const fd = (r.full_description || []) as string[];
      console.log(`  ${r.hts_number} (ch.${r.chapter}): ${fd.slice(-2).join(' > ')} → "${r.description}"`);
    }
    // Process first 10 as dry run
    const sample = targetRows.slice(0, 10);
    const results = await generateSynonymsBatch(client, sample);
    console.log('\nSample synonyms:');
    for (const r of results) {
      console.log(`  ${r.hts_number}: ${r.synonyms.join(', ')}`);
    }
    await db.end();
    return;
  }

  // ── Process in batches ────────────────────────────────────────────────────
  const progress = await loadProgress();
  const pending = targetRows.filter((r) => !progress[r.hts_number]);
  console.log(`${pending.length} codes to process (${Object.keys(progress).length} already done)`);

  const batches: HtsRow[][] = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  let processedCount = Object.keys(progress).length;
  let withSynonyms = 0;

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const concurrent = batches.slice(i, i + CONCURRENCY);

    await Promise.all(concurrent.map(async (batch) => {
      const results = await generateSynonymsBatch(client, batch);

      for (const r of results) {
        progress[r.hts_number] = r.synonyms;
        if (r.synonyms.length > 0) withSynonyms++;

        if (r.synonyms.length > 0) {
          const synonymText = r.synonyms.join(', ');
          await db.query(
            `UPDATE hts SET product_synonyms = $1 WHERE hts_number = $2 AND is_active = true`,
            [synonymText, r.hts_number],
          );
        }

        processedCount++;
      }

      process.stdout.write(
        `\rProcessed ${processedCount}/${targetRows.length} (${withSynonyms} with synonyms)...`,
      );
      saveProgress(progress);
    }));

    if (i + CONCURRENCY < batches.length) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.log(`\nDone. ${withSynonyms}/${processedCount} codes received synonyms.`);
  console.log('\nNext steps:');
  console.log('  1. Update HtsEntity to include productSynonyms in buildSearchText()');
  console.log('  2. Run: npx ts-node scripts/refresh-hts-embeddings.ts --synonyms-only');
  console.log('  3. Re-run benchmark to measure improvement');

  await db.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
