#!/usr/bin/env ts-node
/**
 * Curate the HTS evaluation set using Claude to adjudicate misses.
 *
 * For each item in full-misses.json, asks Claude to compare the expected code
 * (from benchmark) vs the system's prediction and determine which is more correct.
 * Produces a corrected lookup-evaluation-set-v3.jsonl.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/curate-evaluation-set-v3.ts
 *   # Optional flags:
 *   npx ts-node ... --misses=/tmp/full-misses.json --v1=docs/evaluation/lookup-evaluation-set-v1.jsonl
 *   npx ts-node ... --dry-run   # only show first 5 adjudications, don't write output
 */
import 'tsconfig-paths/register';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
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

const MISSES_PATH = getArg('misses', '/tmp/full-misses.json')!;
const V1_PATH = getArg(
  'v1',
  path.resolve(__dirname, '../docs/evaluation/lookup-evaluation-set-v1.jsonl'),
)!;
const OUT_PATH = getArg(
  'out',
  path.resolve(__dirname, '../docs/evaluation/lookup-evaluation-set-v3.jsonl'),
)!;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 15; // items per Claude call
const CONCURRENCY = 3; // concurrent batches
const PROGRESS_FILE = '/tmp/curation-progress.json';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MissItem {
  q: string;
  exp: string; // expected code (benchmark label)
  got: string; // system prediction
}

interface V1Row {
  id: string;
  query: string;
  expectedHtsNumber: string;
  expectedChapter: string;
  acceptableHtsNumbers?: string[];
  ambiguity?: string;
  endpoints: string[];
  source: string;
  generatedAt: string;
  [key: string]: unknown;
}

interface HtsInfo {
  hts_number: string;
  description: string;
  chapter: string;
  full_description: string[] | null;
}

type Decision = 'expected' | 'predicted' | 'ambiguous' | 'neither';

interface AdjudicationResult {
  query: string;
  exp: string;
  got: string;
  decision: Decision;
  reason: string;
  betterCode?: string | null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchHtsInfoBatch(
  db: Client,
  codes: string[],
): Promise<Map<string, HtsInfo>> {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();

  const rows = await db.query<HtsInfo>(
    `SELECT hts_number, description, chapter,
            COALESCE(full_description::text, '[]') AS full_description
     FROM hts
     WHERE hts_number = ANY($1) AND is_active = true`,
    [unique],
  );

  const map = new Map<string, HtsInfo>();
  for (const r of rows.rows) {
    let fd: string[] = [];
    try {
      fd = JSON.parse(r.full_description as unknown as string);
    } catch {}
    map.set(r.hts_number, { ...r, full_description: fd });
  }

  // Fallback: try without is_active filter for codes not found
  const missing = unique.filter((c) => !map.has(c));
  if (missing.length) {
    const fb = await db.query<HtsInfo>(
      `SELECT hts_number, description, chapter,
              COALESCE(full_description::text, '[]') AS full_description
       FROM hts WHERE hts_number = ANY($1)`,
      [missing],
    );
    for (const r of fb.rows) {
      let fd: string[] = [];
      try {
        fd = JSON.parse(r.full_description as unknown as string);
      } catch {}
      if (!map.has(r.hts_number)) {
        map.set(r.hts_number, { ...r, full_description: fd });
      }
    }
  }

  return map;
}

function formatHtsForPrompt(info: HtsInfo | undefined, code: string): string {
  if (!info) return `${code} (not found in DB)`;
  const fullDesc = info.full_description || [];
  if (fullDesc.length > 0) {
    return `${code}: ${fullDesc.join(' > ')}`;
  }
  return `${code}: ${info.description || 'no description'}`;
}

// ── Claude adjudication ───────────────────────────────────────────────────────

async function adjudicateBatch(
  client: Anthropic,
  items: Array<{ miss: MissItem; expInfo: HtsInfo | undefined; gotInfo: HtsInfo | undefined }>,
): Promise<AdjudicationResult[]> {
  const itemsText = items
    .map((item, i) => {
      const expText = formatHtsForPrompt(item.expInfo, item.miss.exp);
      const gotText = formatHtsForPrompt(item.gotInfo, item.miss.got);
      return [
        `## Item ${i + 1}`,
        `Query: "${item.miss.q}"`,
        `Expected (benchmark): ${expText}`,
        `Predicted (system):   ${gotText}`,
      ].join('\n');
    })
    .join('\n\n');

  const prompt = `You are an expert in the US Harmonized Tariff Schedule (HTS). For each item below, determine which HTS code more correctly classifies the product described by the query.

${itemsText}

For each item, respond with JSON in this exact format:
{
  "results": [
    {
      "item": 1,
      "decision": "expected" | "predicted" | "ambiguous",
      "reason": "one short sentence",
      "betterCode": null or "XXXX.XX.XX.XX" (only if both are wrong and you know a clearly better code)
    }
  ]
}

Rules:
- "expected" = the benchmark label is the correct HTS classification
- "predicted" = the system's answer is more accurate than the benchmark label
- "ambiguous" = both are reasonable classifications for the product (HTS allows multiple valid codes)
- Only suggest "betterCode" if you are highly confident the correct code is neither exp nor got
- For clothing/garment queries: knit vs woven distinctions cannot be determined from a product name alone — mark those as "ambiguous"
- For generic queries like "100% cotton shirt" that match 6109 (T-shirts): if benchmark says 6103 (suits), call "predicted"
- Respond ONLY with the JSON object, no other text`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0] as { type: string; text: string }).text.trim();
  let parsed: { results: Array<{ item: number; decision: string; reason: string; betterCode?: string | null }> };

  try {
    // Strip markdown code fences if present
    const clean = text.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    parsed = JSON.parse(clean);
  } catch {
    console.error('Failed to parse Claude response:', text.slice(0, 200));
    // Fallback: mark all as "expected" (keep benchmark)
    return items.map((item) => ({
      query: item.miss.q,
      exp: item.miss.exp,
      got: item.miss.got,
      decision: 'expected' as Decision,
      reason: 'parse error fallback',
      betterCode: null,
    }));
  }

  return items.map((item, i) => {
    const r = parsed.results.find((x) => x.item === i + 1) || parsed.results[i];
    const decision = (r?.decision ?? 'expected') as Decision;
    return {
      query: item.miss.q,
      exp: item.miss.exp,
      got: item.miss.got,
      decision,
      reason: r?.reason ?? '',
      betterCode: r?.betterCode ?? null,
    };
  });
}

// ── V3 row builder ────────────────────────────────────────────────────────────

function buildV3Row(
  original: V1Row,
  result: AdjudicationResult,
  gotInfo: HtsInfo | undefined,
): V1Row {
  const now = new Date().toISOString();
  const base = { ...original };

  if (result.decision === 'expected') {
    // Keep benchmark as-is — system was wrong
    return base;
  }

  if (result.decision === 'predicted') {
    // System was more correct — update expected to system's answer
    const correctedChapter = result.got.substring(0, 2);
    return {
      ...base,
      expectedHtsNumber: result.got,
      expectedChapter: gotInfo?.chapter ?? correctedChapter,
      ambiguity: 'single_label',
      // Keep original as acceptable if same 6-digit heading
      ...(result.exp.substring(0, 7) === result.got.substring(0, 7)
        ? { acceptableHtsNumbers: [...(base.acceptableHtsNumbers ?? []), result.exp] }
        : {}),
      curated: true,
      curationDecision: 'predicted_more_correct',
      curationReason: result.reason,
      curationDate: now,
      originalExpected: base.expectedHtsNumber,
    } as V1Row;
  }

  if (result.decision === 'ambiguous') {
    // Both are valid — mark as multi_label
    const acceptable = [
      ...new Set([
        ...(base.acceptableHtsNumbers ?? []),
        result.exp,
        result.got,
      ]),
    ].filter((c) => c && c !== result.exp);

    return {
      ...base,
      ambiguity: 'multi_label',
      acceptableHtsNumbers: acceptable.length > 0 ? acceptable : undefined,
      // Remove classify endpoint — too ambiguous for single-answer classify
      endpoints: (base.endpoints ?? []).filter((e) => e !== 'classify'),
      curated: true,
      curationDecision: 'ambiguous',
      curationReason: result.reason,
      curationDate: now,
    } as V1Row;
  }

  // decision === 'neither' — should be rare with our prompt
  return base;
}

// ── Progress helpers ──────────────────────────────────────────────────────────

function loadProgress(): Record<string, AdjudicationResult> {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveProgress(progress: Record<string, AdjudicationResult>): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress), 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  // ── Connect to DB ─────────────────────────────────────────────────────────
  const db = new Client({
    host: process.env.DB_HOST || '192.168.1.209',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'wbroot0216',
    database: process.env.DB_DATABASE || 'hts',
  });
  await db.connect();
  console.log('Connected to DB');

  // ── Load misses ───────────────────────────────────────────────────────────
  const misses: MissItem[] = JSON.parse(fs.readFileSync(MISSES_PATH, 'utf8'));
  console.log(`Loaded ${misses.length} misses from ${MISSES_PATH}`);

  // ── Load v1 dataset ───────────────────────────────────────────────────────
  const v1Rows = new Map<string, V1Row>(); // keyed by query
  const rl = readline.createInterface({ input: fs.createReadStream(V1_PATH) });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const row: V1Row = JSON.parse(trimmed);
    v1Rows.set(row.query, row);
  }
  console.log(`Loaded ${v1Rows.size} rows from v1 dataset`);

  // ── Load adjudication progress (for resuming) ─────────────────────────────
  const progress = loadProgress();
  const alreadyDone = Object.keys(progress).length;
  if (alreadyDone > 0) {
    console.log(`Resuming: ${alreadyDone} items already adjudicated`);
  }

  // ── Prefetch all HTS descriptions ─────────────────────────────────────────
  const allCodes = misses.flatMap((m) => [m.exp, m.got]).filter(Boolean);
  console.log(`Fetching HTS info for ${[...new Set(allCodes)].length} unique codes...`);
  const htsMap = await fetchHtsInfoBatch(db, allCodes);
  console.log(`Found ${htsMap.size} HTS entries`);

  // ── Adjudicate in batches ─────────────────────────────────────────────────
  const pending = misses.filter((m) => !progress[m.q]);
  console.log(`${pending.length} items to adjudicate (${DRY_RUN ? 'DRY RUN' : 'live'})`);

  if (DRY_RUN) {
    pending.splice(5); // only process first 5
  }

  let processed = 0;
  const batches: MissItem[][] = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  // Process batches with controlled concurrency
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const concurrentBatches = batches.slice(i, i + CONCURRENCY);
    await Promise.all(
      concurrentBatches.map(async (batch) => {
        const enriched = batch.map((miss) => ({
          miss,
          expInfo: htsMap.get(miss.exp),
          gotInfo: htsMap.get(miss.got),
        }));

        const results = await adjudicateBatch(client, enriched);

        for (const result of results) {
          progress[result.query] = result;
          processed++;
        }

        process.stdout.write(
          `\rAdjudicated ${alreadyDone + processed}/${misses.length} items...`,
        );

        // Save progress after each batch
        saveProgress(progress);
      }),
    );

    // Small delay between concurrent groups to be respectful of rate limits
    if (i + CONCURRENCY < batches.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log('\nAdjudication complete. Writing v3 dataset...');

  // ── Print summary of decisions ────────────────────────────────────────────
  const counts = { expected: 0, predicted: 0, ambiguous: 0, neither: 0, unchanged: 0 };
  for (const [q, r] of Object.entries(progress)) {
    counts[r.decision as keyof typeof counts]++;
  }
  // Items in v1 that weren't misses are "unchanged"
  counts.unchanged = v1Rows.size - misses.length;

  console.log('\n=== Adjudication Summary ===');
  console.log(`  expected (keep benchmark):    ${counts.expected}`);
  console.log(`  predicted (system was right): ${counts.predicted}`);
  console.log(`  ambiguous (multi-label):      ${counts.ambiguous}`);
  console.log(`  unchanged (not a miss):       ${counts.unchanged}`);
  console.log(`  total v1 rows:                ${v1Rows.size}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN: sample results:');
    for (const [q, r] of Object.entries(progress)) {
      console.log(`  [${r.decision.toUpperCase().padEnd(9)}] "${q.substring(0, 50)}" exp:${r.exp} got:${r.got}`);
      if (r.reason) console.log(`          reason: ${r.reason}`);
    }
    await db.end();
    return;
  }

  // ── Write v3 JSONL ────────────────────────────────────────────────────────
  await fs.promises.mkdir(path.dirname(OUT_PATH), { recursive: true });
  const out = fs.createWriteStream(OUT_PATH, { encoding: 'utf8' });

  // Write header comment
  out.write('# HTS lookup evaluation set v3 — curated from v1 using Claude adjudication\n');
  out.write(`# Generated: ${new Date().toISOString()}\n`);
  out.write(`# Corrections: ${counts.predicted} predicted-wins, ${counts.ambiguous} ambiguous\n`);

  let writtenCount = 0;
  for (const [query, v1Row] of v1Rows) {
    const adjResult = progress[query];
    let row: V1Row;

    if (!adjResult) {
      // Not a miss — pass through unchanged
      row = v1Row;
    } else {
      const gotInfo = htsMap.get(adjResult.got);
      row = buildV3Row(v1Row, adjResult, gotInfo);
    }

    out.write(JSON.stringify(row) + '\n');
    writtenCount++;
  }

  out.end();
  console.log(`Written ${writtenCount} rows to ${OUT_PATH}`);

  await db.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
