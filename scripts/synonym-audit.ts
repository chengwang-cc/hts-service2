#!/usr/bin/env ts-node
/**
 * Phase 3 — Synonym Quality Audit
 *
 * For each key in SearchService.QUERY_SYNONYMS:
 *   1. Static check: does any consumer eval query contain this token?
 *      No → "dead weight" (never triggered in eval set)
 *   2. Dynamic test: run affected queries with synonym disabled vs enabled.
 *      deltaHit10 > 0 or deltaChap10 > 0 → beneficial (keep)
 *      delta = 0 → neutral (review)
 *      deltaHit10 < 0 or deltaChap10 < 0 → harmful (remove)
 *
 * Output: sorted report: harmful → neutral → beneficial → dead-weight
 *
 * NOTE: Eval set of 191 consumer queries is a representative sample, not exhaustive.
 * Dead-weight keys may still benefit real-world queries outside the eval set. Re-run
 * after expanding the eval set to 500+ entries before removing dead-weight synonyms.
 *
 * Usage:
 *   cd hts-service
 *   npx ts-node -r tsconfig-paths/register scripts/synonym-audit.ts
 *   npx ts-node -r tsconfig-paths/register scripts/synonym-audit.ts --set=docs/evaluation/lookup-evaluation-consumer-v1.jsonl
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { AppModule } from '../src/app.module';
import { SearchService } from '../src/modules/lookup/services';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvalRecord {
  id: string;
  query: string;
  expectedHtsNumber: string;
  acceptableHtsNumbers: string[];  // always non-empty (validated in loadEvalSet)
  acceptableChapters: string[];
}

interface QueryScore {
  hit1: boolean;
  hit3: boolean;
  hit10: boolean;
  chap10: boolean;
}

type Classification = 'harmful' | 'neutral' | 'beneficial' | 'dead-weight';

interface AuditEntry {
  key: string;
  synonyms: string[];
  affectedQueries: string[];
  deltaHit10: number;   // baseline - disabled (positive = synonym helps, negative = synonym hurts)
  deltaChap10: number;
  classification: Classification;
  // Per-query detail: OR'd across both autocomplete and hybridSearch endpoints.
  // OR logic means: if either endpoint got a hit, the OR is true.
  // This can mask per-endpoint differences; see the detailed delta for full picture.
  perQuery: Array<{
    query: string;
    baseHit10: boolean;
    disabledHit10: boolean;
    baseChap10: boolean;
    disabledChap10: boolean;
  }>;
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────
// MUST match search.service.ts normalizeQuery() + tokenizeQuery() exactly.
// If either function changes in the service, update here too.

// Identical to the stopWords Set in search.service.ts tokenizeQuery()
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'for', 'and', 'with', 'to', 'of', 'in', 'on', 'by', 'or', 'at', 'from',
]);

function normalizeQuery(query: string): string {
  return (query ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\btransfomer\b/gi, 'transformer')
    .replace(/\btranformer\b/gi, 'transformer')
    .replace(/\bcomic[\s-]?books?\b/gi, 'comic book')
    .replace(/\bt[\s-]?shirts?\b/gi, 'tshirt')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenizeQuery(query: string): Set<string> {
  const raw = (query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const corrected = raw.map((t) =>
    t === 'transfomer' || t === 'tranformer' ? 'transformer' : t,
  );
  // Same deduplication (Set) and filtering as the service
  return new Set(corrected.filter((t) => t.length > 1 && !STOP_WORDS.has(t)));
}

// ── JSONL loader ──────────────────────────────────────────────────────────────

async function loadEvalSet(path: string): Promise<EvalRecord[]> {
  const raw = await readFile(path, 'utf-8');
  const records: EvalRecord[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const expected = ((obj.expectedHtsNumber as string) || '').trim();
      if (!obj.id || !obj.query || !expected) continue;
      const extra = Array.isArray(obj.acceptableHtsNumbers)
        ? (obj.acceptableHtsNumbers as string[]).map((s) => s.trim()).filter(Boolean)
        : [];
      const acceptableHtsNumbers = [...new Set([expected, ...extra])];
      // Guard: skip records with no valid HTS numbers to avoid scoring bugs
      if (acceptableHtsNumbers.length === 0) continue;
      const fromHts = acceptableHtsNumbers.map((h) => h.substring(0, 2));
      const explicitChapters = Array.isArray(obj.acceptableChapters)
        ? (obj.acceptableChapters as string[]).map((s) => String(s).trim()).filter(Boolean)
        : obj.expectedChapter
          ? [String(obj.expectedChapter).trim()]
          : [];
      const acceptableChapters = [...new Set([...explicitChapters, ...fromHts])];
      records.push({
        id: obj.id as string,
        query: obj.query as string,
        expectedHtsNumber: expected,
        acceptableHtsNumbers,
        acceptableChapters,
      });
    } catch {
      // skip invalid/unparseable lines
    }
  }
  return records;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreRows(rows: Array<{ htsNumber: string }>, record: EvalRecord): QueryScore {
  const top10 = rows.slice(0, 10).map((r) => r.htsNumber);
  return {
    hit1: record.acceptableHtsNumbers.includes(top10[0] ?? ''),
    hit3: top10.slice(0, 3).some((h) => record.acceptableHtsNumbers.includes(h)),
    hit10: top10.some((h) => record.acceptableHtsNumbers.includes(h)),
    chap10: top10.some((h) => record.acceptableChapters.includes(h.substring(0, 2))),
  };
}

// ── Query execution ────────────────────────────────────────────────────────────

const QUERY_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

async function queryBoth(
  svc: SearchService,
  query: string,
  limit: number,
): Promise<{ ac: Array<{ htsNumber: string }>; hs: Array<{ htsNumber: string }> }> {
  const [acResult, hsResult] = await Promise.allSettled([
    withTimeout(svc.autocomplete(query, limit), QUERY_TIMEOUT_MS, `autocomplete("${query}")`),
    withTimeout(svc.hybridSearch(query, limit), QUERY_TIMEOUT_MS, `hybridSearch("${query}")`),
  ]);

  if (acResult.status === 'rejected') {
    console.warn(`  [WARN] autocomplete failed for "${query}": ${acResult.reason instanceof Error ? acResult.reason.message : String(acResult.reason)}`);
  }
  if (hsResult.status === 'rejected') {
    console.warn(`  [WARN] hybridSearch failed for "${query}": ${hsResult.reason instanceof Error ? hsResult.reason.message : String(hsResult.reason)}`);
  }

  return {
    ac: acResult.status === 'fulfilled' ? acResult.value : [],
    hs: hsResult.status === 'fulfilled' ? hsResult.value : [],
  };
}

// ── Classification ─────────────────────────────────────────────────────────────
// Both metrics use consistent threshold: any negative delta = harmful.
// deltaHit10 and deltaChap10 are sums across affected queries × 2 endpoints.

function classify(deltaHit10: number, deltaChap10: number): Classification {
  if (deltaHit10 < 0 || deltaChap10 < 0) return 'harmful';
  if (deltaHit10 > 0 || deltaChap10 > 0) return 'beneficial';
  return 'neutral';
}

// ── Report ─────────────────────────────────────────────────────────────────────

function printReport(entries: AuditEntry[], elapsedMs: number, datasetPath: string): void {
  const byClass = (c: Classification) => entries.filter((e) => e.classification === c);
  const harmful = byClass('harmful');
  const neutral = byClass('neutral');
  const beneficial = byClass('beneficial');
  const dead = byClass('dead-weight');
  const activeCount = entries.filter((e) => e.affectedQueries.length > 0).length;

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  SYNONYM QUALITY AUDIT — PHASE 3 REPORT');
  console.log(`  dataset: ${datasetPath}`);
  console.log(`  elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  active keys tested: ${activeCount}`);
  console.log(`  dead-weight keys (eval set only): ${dead.length}`);
  console.log('  NOTE: dead-weight = not triggered in THIS eval set.');
  console.log('        May still help real-world queries. Expand eval set before removing.');
  console.log('════════════════════════════════════════════════════════');

  if (harmful.length > 0) {
    console.log('\n[HARMFUL] — synonym hurts accuracy → REMOVE');
    for (const e of harmful) {
      console.log(`\n  key: "${e.key}" → [${e.synonyms.join(', ')}]`);
      console.log(`  queries: ${e.affectedQueries.join(', ')}`);
      console.log(`  delta  hit@10=${e.deltaHit10}  chap@10=${e.deltaChap10}`);
      for (const q of e.perQuery) {
        const changed = q.baseHit10 !== q.disabledHit10 || q.baseChap10 !== q.disabledChap10;
        if (changed) {
          // baseX→disabledX: positive delta (base>disabled) = synonym was helping that query
          console.log(`    "${q.query}": hit10: ${q.baseHit10}→${q.disabledHit10}  chap10: ${q.baseChap10}→${q.disabledChap10}`);
        }
      }
    }
  }

  if (beneficial.length > 0) {
    console.log('\n[BENEFICIAL] — synonym improves accuracy → KEEP');
    for (const e of beneficial) {
      console.log(`\n  key: "${e.key}" → [${e.synonyms.join(', ')}]`);
      console.log(`  queries: ${e.affectedQueries.join(', ')}`);
      console.log(`  delta  hit@10=${e.deltaHit10}  chap@10=${e.deltaChap10}`);
    }
  }

  if (neutral.length > 0) {
    console.log('\n[NEUTRAL] — no measurable accuracy effect on eval set → REVIEW');
    for (const e of neutral) {
      console.log(`  "${e.key}"  queries: ${e.affectedQueries.join(', ')}`);
    }
  }

  if (dead.length > 0) {
    console.log('\n[DEAD WEIGHT] — no eval queries trigger this key (keep until eval set > 500)');
    const cols = 6;
    for (let i = 0; i < dead.length; i += cols) {
      console.log('  ' + dead.slice(i, i + cols).map((e) => `"${e.key}"`).join('  '));
    }
  }

  console.log('');
  console.log('────────────────────────────────────────────────────────');
  console.log(`  harmful=${harmful.length}  neutral=${neutral.length}  beneficial=${beneficial.length}  dead-weight=${dead.length}`);
  console.log('════════════════════════════════════════════════════════');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const setArg = process.argv.find((a) => a.startsWith('--set='));
  const datasetPath = resolve(
    process.cwd(),
    setArg ? setArg.slice('--set='.length) : 'docs/evaluation/lookup-evaluation-consumer-v1.jsonl',
  );
  const LIMIT = 10;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(SearchService, { strict: false });
    // Deep copy returned — mutations to allSynonyms won't affect the service
    const allSynonyms = svc.getAllSynonyms();
    const synonymKeys = Object.keys(allSynonyms);
    const allRecords = await loadEvalSet(datasetPath);

    if (allRecords.length === 0) {
      throw new Error(`No valid eval records found in: ${datasetPath}`);
    }

    console.log(`Loaded ${allRecords.length} eval records`);
    console.log(`Analyzing ${synonymKeys.length} synonym keys...`);

    // Static analysis: map each synonym key → which queries trigger it
    const keyToRecords = new Map<string, EvalRecord[]>(
      synonymKeys.map((k) => [k, []]),
    );
    for (const record of allRecords) {
      const tokens = tokenizeQuery(normalizeQuery(record.query));
      for (const key of synonymKeys) {
        if (tokens.has(key)) {
          keyToRecords.get(key)!.push(record);
        }
      }
    }

    const activeKeys = synonymKeys.filter((k) => keyToRecords.get(k)!.length > 0);
    const deadKeys = synonymKeys.filter((k) => keyToRecords.get(k)!.length === 0);

    console.log(`Static analysis: ${activeKeys.length} active, ${deadKeys.length} dead-weight`);
    console.log(`Running dynamic tests on ${activeKeys.length} keys...\n`);

    const startedAt = Date.now();
    const results: AuditEntry[] = [];

    // Dead-weight entries (no dynamic test needed)
    for (const key of deadKeys) {
      results.push({
        key,
        synonyms: allSynonyms[key] ?? [],
        affectedQueries: [],
        deltaHit10: 0,
        deltaChap10: 0,
        classification: 'dead-weight',
        perQuery: [],
      });
    }

    // Active keys: baseline vs disabled
    for (const key of activeKeys) {
      const affectedRecords = keyToRecords.get(key)!;
      const originalSynonyms = allSynonyms[key] ?? [];

      let deltaHit10 = 0;
      let deltaChap10 = 0;
      const perQuery: AuditEntry['perQuery'] = [];

      // Ensure synonym is at original state before baseline
      svc.restoreSynonym(key, originalSynonyms);

      for (const record of affectedRecords) {
        // ── Baseline: synonym enabled ──
        const { ac: acBase, hs: hsBase } = await queryBoth(svc, record.query, LIMIT);
        const baseAc = scoreRows(acBase, record);
        const baseHs = scoreRows(hsBase, record);

        // ── Disabled: synonym → [] ──
        svc.setSynonymOverride(key, []);
        const { ac: acDis, hs: hsDis } = await queryBoth(svc, record.query, LIMIT);
        const disAc = scoreRows(acDis, record);
        const disHs = scoreRows(hsDis, record);
        svc.restoreSynonym(key, originalSynonyms);

        // Accumulate deltas across both endpoints (score range per query: -2 to +2)
        deltaHit10  += (baseAc.hit10  ? 1 : 0) + (baseHs.hit10  ? 1 : 0)
                     - (disAc.hit10   ? 1 : 0) - (disHs.hit10   ? 1 : 0);
        deltaChap10 += (baseAc.chap10 ? 1 : 0) + (baseHs.chap10 ? 1 : 0)
                     - (disAc.chap10  ? 1 : 0) - (disHs.chap10  ? 1 : 0);

        // perQuery uses OR across endpoints: true if either AC or HS got a hit.
        // This is a summary view — the detailed deltaHit10/deltaChap10 captures the full picture.
        perQuery.push({
          query: record.query,
          baseHit10: baseAc.hit10 || baseHs.hit10,
          disabledHit10: disAc.hit10 || disHs.hit10,
          baseChap10: baseAc.chap10 || baseHs.chap10,
          disabledChap10: disAc.chap10 || disHs.chap10,
        });
      }

      const classification = classify(deltaHit10, deltaChap10);
      results.push({
        key,
        synonyms: originalSynonyms,
        affectedQueries: affectedRecords.map((r) => r.query),
        deltaHit10,
        deltaChap10,
        classification,
        perQuery,
      });

      const icon = classification === 'harmful' ? '✗' : classification === 'beneficial' ? '✓' : '·';
      process.stdout.write(
        `  ${icon} "${key}"  queries=${affectedRecords.length}  Δhit@10=${deltaHit10}  Δchap@10=${deltaChap10}  [${classification}]\n`,
      );
    }

    // Sort: harmful → neutral → beneficial → dead-weight
    const ORDER: Record<Classification, number> = {
      harmful: 0,
      neutral: 1,
      beneficial: 2,
      'dead-weight': 3,
    };
    results.sort((a, b) => ORDER[a.classification] - ORDER[b.classification]);

    printReport(results, Date.now() - startedAt, datasetPath);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
