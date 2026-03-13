#!/usr/bin/env ts-node
/**
 * CSV Accuracy Test Pipeline
 *
 * 1. Reads the Chit Chats CSV
 * 2. Normalizes HTS codes (strips dots) and strips HTML
 * 3. Deduplicates entries
 * 4. Samples up to N unique queries per HTS code
 * 5. Calls the autocomplete API for each
 * 6. Reports pass/fail and finds patterns in failures
 *
 * Usage:
 *   npx ts-node scripts/run-csv-accuracy-test.ts
 *   BASE_URL=http://localhost:3100 npx ts-node scripts/run-csv-accuracy-test.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as csvParse } from 'csv-parse/sync';

const BASE_URL = process.env.BASE_URL ?? 'http://192.168.1.209:32287/api/v1';
const CSV_PATH = resolve(__dirname, '../docs/Chit Chats HTS Codes and Descriptions.csv');
const MAX_QUERIES_PER_HTS = 3;   // test up to 3 queries per HTS code
const TOP_K = 10;                  // check if correct HTS appears in top-K
const CONCURRENCY = 5;             // parallel API calls

interface TestEntry {
  htsCode: string;
  query: string;
}

interface TestResult {
  htsCode: string;
  query: string;
  topResults: string[];
  passedExact: boolean;   // exact HTS in top-K
  passedChapter: boolean; // correct chapter in top-K
  chapter: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeHts(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function chapter(hts: string): string {
  return hts.slice(0, 2);
}

async function callAutocomplete(query: string): Promise<string[]> {
  const url = `${BASE_URL}/lookup/autocomplete?q=${encodeURIComponent(query)}&limit=${TOP_K}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json() as unknown;
    // API returns { success, data: [...], meta }
    const items: unknown[] = Array.isArray((json as Record<string, unknown>)['data'])
      ? ((json as Record<string, unknown>)['data'] as unknown[])
      : Array.isArray(json) ? json : [];
    return items.map((item) => {
      const i = item as Record<string, unknown>;
      const ht = (i['htsNumber'] ?? i['hts_number'] ?? '') as string;
      return ht.replace(/\./g, '');
    });
  } catch {
    return [];
  }
}

async function runBatch(entries: TestEntry[]): Promise<TestResult[]> {
  const results: TestResult[] = [];
  // Process in chunks of CONCURRENCY
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const chunk = entries.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (e) => {
        const topHts = await callAutocomplete(e.query);
        const ch = chapter(e.htsCode);
        return {
          htsCode: e.htsCode,
          query: e.query,
          topResults: topHts.slice(0, 5),
          passedExact: topHts.includes(e.htsCode),
          passedChapter: topHts.some((h) => h.startsWith(ch)),
          chapter: ch,
        } as TestResult;
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value);
    }
    process.stdout.write(`\r  tested ${Math.min(i + CONCURRENCY, entries.length)}/${entries.length}`);
  }
  console.log();
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== CSV Accuracy Test Pipeline ===\n');

  // 1. Parse CSV
  console.log('Loading CSV...');
  const raw = readFileSync(CSV_PATH);
  const records: Record<string, string>[] = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  console.log(`  Loaded ${records.length} rows`);

  // 2. Normalize and group
  const groupMap = new Map<string, Set<string>>();
  let invalidCodes = 0;
  for (const row of records) {
    const rawCode = row['hts_code'] ?? row['hts_number'] ?? '';
    const rawDesc = row['custom_description'] ?? row['query'] ?? row['description'] ?? '';
    const code = normalizeHts(rawCode);
    if (code.length !== 10) { invalidCodes++; continue; }
    const desc = stripHtml(rawDesc);
    if (!desc) continue;
    if (!groupMap.has(code)) groupMap.set(code, new Set());
    const set = groupMap.get(code)!;
    const lower = desc.toLowerCase();
    if (![...set].some(s => s.toLowerCase() === lower)) set.add(desc);
  }
  console.log(`  ${groupMap.size} unique HTS codes (${invalidCodes} rows had invalid codes)`);

  // 3. Build test entries (sample up to MAX_QUERIES_PER_HTS per code)
  const entries: TestEntry[] = [];
  for (const [htsCode, descs] of groupMap) {
    const sample = [...descs].slice(0, MAX_QUERIES_PER_HTS);
    for (const query of sample) {
      entries.push({ htsCode, query });
    }
  }
  console.log(`  Testing ${entries.length} entries (max ${MAX_QUERIES_PER_HTS}/code)\n`);

  // 4. Run tests
  console.log(`Running autocomplete tests against ${BASE_URL}...`);
  const results = await runBatch(entries);

  // 5. Analyse results
  const exactPass = results.filter(r => r.passedExact).length;
  const chapterPass = results.filter(r => r.passedChapter).length;
  const total = results.length;

  console.log('\n=== RESULTS ===');
  console.log(`  Total tested:    ${total}`);
  console.log(`  Exact top-${TOP_K}:  ${exactPass}/${total} (${((exactPass/total)*100).toFixed(1)}%)`);
  console.log(`  Chapter top-${TOP_K}: ${chapterPass}/${total} (${((chapterPass/total)*100).toFixed(1)}%)`);

  // 6. Report failures (sorted by chapter for pattern analysis)
  const failures = results.filter(r => !r.passedExact);
  if (failures.length === 0) {
    console.log('\n✅ All entries passed!');
    return;
  }

  console.log(`\n=== FAILURES (${failures.length}) ===`);

  // Group by HTS code
  const failByCode = new Map<string, TestResult[]>();
  for (const f of failures) {
    if (!failByCode.has(f.htsCode)) failByCode.set(f.htsCode, []);
    failByCode.get(f.htsCode)!.push(f);
  }

  // Sort by chapter then code
  const sortedCodes = [...failByCode.keys()].sort((a, b) => a.localeCompare(b));

  for (const code of sortedCodes) {
    const items = failByCode.get(code)!;
    const chapterMiss = items.filter(i => !i.passedChapter).length;
    console.log(`\n  HTS ${code} (ch.${chapter(code)}) — ${items.length} failures, ${chapterMiss} chapter misses`);
    for (const item of items) {
      const topStr = item.topResults.slice(0, 3).join(', ');
      const flag = item.passedChapter ? '  ' : '❌';
      console.log(`    ${flag} query: "${item.query}"`);
      console.log(`         got:  [${topStr}]`);
    }
  }

  // 7. Chapter-level summary of failures
  console.log('\n=== FAILURE SUMMARY BY CHAPTER ===');
  const failByChapter = new Map<string, { total: number; chapterMiss: number; codes: Set<string> }>();
  for (const f of failures) {
    const ch = f.chapter;
    if (!failByChapter.has(ch)) failByChapter.set(ch, { total: 0, chapterMiss: 0, codes: new Set() });
    const entry = failByChapter.get(ch)!;
    entry.total++;
    entry.codes.add(f.htsCode);
    if (!f.passedChapter) entry.chapterMiss++;
  }
  for (const [ch, data] of [...failByChapter.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
    console.log(`  ch.${ch}: ${data.total} failures across ${data.codes.size} codes (${data.chapterMiss} chapter misses)`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
