#!/usr/bin/env ts-node
/**
 * Export cross-encoder training data for the HTS reranker (Phase 4).
 *
 * For each leaf HTS entry (8 or 10 digit), produces:
 *   - query:     product description text (from HTS hierarchy)
 *   - positive:  formatted candidate text matching what SearchService sends to /rerank
 *   - negatives: 3 hard negatives from the same chapter (wrong codes, nearby taxonomy)
 *
 * Candidate text format: "HTSNUM | leaf_description | parent1 › parent2"  (≤400 chars)
 * This matches the format used in search.service.ts hybridSearch() reranker call.
 *
 * Output JSONL: {"query": "...", "positive": "...", "negatives": ["...", ...]}
 *
 * Usage:
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/export-reranker-training-data.ts
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/export-reranker-training-data.ts --out=/tmp/reranker-training.jsonl --negatives=4
 */
import 'tsconfig-paths/register';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const v = process.argv.find((a) => a.startsWith(prefix));
  return v ? v.slice(prefix.length) : undefined;
}

function parseNumberArg(name: string, fallback: number): number {
  const raw = parseArg(name);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface HtsRow {
  hts_number: string;
  description: string;
  chapter: string;
  full_description: string[] | null;
}

interface TrainingPair {
  query: string;
  positive: string;
  negatives: string[];
}

/**
 * Build the candidate text that SearchService passes to the reranker.
 * Must match: `${r.htsNumber} | ${title} | ${breadcrumb}`.slice(0, 400)
 */
function buildCandidateText(row: HtsRow): string {
  const breadcrumb = ((row.full_description || []) as string[]).slice(-2).join(' › ');
  const title = row.description || '';
  return `${row.hts_number} | ${title} | ${breadcrumb}`.slice(0, 400);
}

/**
 * Build a natural-language product description query from the HTS hierarchy.
 * Uses the leaf description plus one parent level, stripped of HTS-isms.
 */
function buildQuery(row: HtsRow): string {
  const hierarchy = (row.full_description || []) as string[];
  // Take the most specific description (leaf) and optionally one parent
  const parts = [...hierarchy.slice(-1), row.description || '']
    .map((p) => p.trim())
    .filter(Boolean);
  const merged = [...new Set(parts)].join(' ');
  // Trim to ~200 chars — realistic query length
  return merged.slice(0, 200).trim();
}

async function main(): Promise<void> {
  const outputPath = parseArg('out') || path.resolve(__dirname, '../data/reranker-training.jsonl');
  const negativesPerEntry = parseNumberArg('negatives', 3);
  const minDigits = 8; // Only leaf nodes (8 or 10 digit HTS codes)

  const connectionString =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USERNAME || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'hts'}`;

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Load all active leaf entries with full_description
    console.log('Loading HTS leaf entries...');
    const result = await client.query<HtsRow>(`
      SELECT
        hts_number,
        description,
        chapter,
        full_description
      FROM hts
      WHERE is_active = true
        AND LENGTH(REPLACE(hts_number, '.', '')) >= $1
        AND LENGTH(REPLACE(hts_number, '.', '')) IN (8, 10)
        AND chapter NOT IN ('98', '99')
      ORDER BY hts_number
    `, [minDigits]);

    const rows = result.rows;
    console.log(`Loaded ${rows.length} leaf HTS entries`);

    // Group by chapter for hard-negative sampling
    const byChapter = new Map<string, HtsRow[]>();
    for (const row of rows) {
      const list = byChapter.get(row.chapter) ?? [];
      list.push(row);
      byChapter.set(row.chapter, list);
    }

    // Build training pairs
    const pairs: TrainingPair[] = [];
    let skipped = 0;

    for (const row of rows) {
      const query = buildQuery(row);
      if (query.length < 10) {
        skipped++;
        continue;
      }

      const positive = buildCandidateText(row);

      // Hard negatives: pick from same chapter, excluding the current entry
      const chapterPeers = byChapter.get(row.chapter) ?? [];
      const negativePool = chapterPeers.filter(
        (peer) => peer.hts_number !== row.hts_number,
      );

      if (negativePool.length === 0) {
        skipped++;
        continue;
      }

      // Sample without replacement — use deterministic shuffling seeded by hts_number
      const shuffled = shuffleDeterministic(negativePool, row.hts_number);
      const negatives = shuffled
        .slice(0, negativesPerEntry)
        .map((peer) => buildCandidateText(peer));

      pairs.push({ query, positive, negatives });
    }

    console.log(`Built ${pairs.length} training pairs (skipped ${skipped} short/no-peers)`);

    // Also add pairs from lookup_conversation_feedback if any exist
    const feedbackResult = await client.query(`
      SELECT
        f.session_id,
        f.message_id,
        f.is_correct,
        f.chosen_hts,
        m.content_json
      FROM lookup_conversation_feedback f
      JOIN lookup_conversation_messages m ON m.id = f.message_id
      WHERE f.message_id IS NOT NULL
        AND f.chosen_hts IS NOT NULL
        AND f.is_correct = false
      LIMIT 10000
    `);

    if (feedbackResult.rows.length > 0) {
      console.log(`Found ${feedbackResult.rows.length} feedback correction pairs`);
      for (const fb of feedbackResult.rows) {
        const content = fb.content_json || {};
        // Extract the user query from the session messages
        const userQuery: string | undefined = content?.answer;
        if (!userQuery || userQuery.length < 5) continue;

        const chosenHts: string = fb.chosen_hts;
        // Look up the chosen HTS entry to get positive candidate text
        const htsRow = rows.find((r) => r.hts_number === chosenHts);
        if (!htsRow) continue;

        const positive = buildCandidateText(htsRow);
        // The AI recommendation (wrong) becomes a negative
        const aiRec = content?.recommendedHts;
        const aiRow = aiRec ? rows.find((r) => r.hts_number === aiRec) : null;
        const negatives = aiRow ? [buildCandidateText(aiRow)] : [];
        if (negatives.length === 0) continue;

        pairs.push({ query: userQuery.slice(0, 200), positive, negatives });
      }
      console.log(`Total pairs after adding feedback: ${pairs.length}`);
    } else {
      console.log('No feedback correction pairs yet (lookup_conversation_feedback is empty)');
    }

    // Write output
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const lines = pairs.map((p) => JSON.stringify(p));
    fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
    console.log(`\nWrote ${pairs.length} pairs to ${outputPath}`);
    console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);
  } finally {
    await client.end();
  }
}

/**
 * Deterministic Fisher-Yates shuffle seeded by a string.
 * Avoids randomness so re-exports are reproducible.
 */
function shuffleDeterministic<T>(arr: T[], seed: string): T[] {
  const copy = [...arr];
  // Simple xor-shift based on seed string char codes
  let state = seed.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffffffff, 1);
  const rand = (): number => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
