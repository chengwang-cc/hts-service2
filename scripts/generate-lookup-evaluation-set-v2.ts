#!/usr/bin/env ts-node
/**
 * Chapter-stratified HTS evaluation set generator (v2).
 *
 * Unlike v1 (random sampling), v2 ensures at least --per-chapter entries from
 * every HTS chapter, giving balanced coverage across all 98 chapters.
 *
 * Usage:
 *   npx ts-node scripts/generate-lookup-evaluation-set-v2.ts
 *   npx ts-node scripts/generate-lookup-evaluation-set-v2.ts --per-chapter=50 --out=docs/evaluation/lookup-evaluation-set-v2.jsonl
 */
import 'tsconfig-paths/register';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import dataSource from '../src/db/data-source';

interface HtsRow {
  hts_number: string;
  chapter: string;
  description: string;
  full_description: string[] | null;
}

interface EvalRow {
  id: string;
  query: string;
  expectedHtsNumber: string;
  expectedChapter: string;
  acceptableHtsNumbers?: string[];
  acceptableChapters?: string[];
  ambiguity?: 'multi_label';
  endpoints: Array<'autocomplete' | 'search' | 'classify'>;
  source: 'generated-v2';
  generatedAt: string;
}

interface QueryCandidate {
  query: string;
  htsNumber: string;
  chapter: string;
  includeClassify: boolean;
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : undefined;
}

function normalizeQueryText(value: string): string {
  return value
    .replace(/\(\d+\)/g, ' ')
    .replace(/[^a-zA-Z0-9/%\-. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildQueryVariants(row: HtsRow): string[] {
  const description = normalizeQueryText(row.description || '');
  const fullDesc = Array.isArray(row.full_description)
    ? row.full_description.map((item) => normalizeQueryText(String(item)))
    : [];

  const variants: string[] = [];
  if (description) {
    variants.push(description);
  }

  const parent = fullDesc.length >= 2 ? fullDesc[fullDesc.length - 2] : '';
  const grandParent = fullDesc.length >= 3 ? fullDesc[fullDesc.length - 3] : '';

  if (description && parent) {
    variants.push(`${description} ${parent}`.trim());
  }

  if (description && parent && grandParent) {
    variants.push(`${description} ${parent} ${grandParent}`.trim());
  }

  return [...new Set(variants.map((item) => normalizeQueryText(item)).filter(Boolean))];
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function isLowInformationQuery(query: string): boolean {
  const normalized = query.toLowerCase().trim();
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;

  if (normalized.length < 4) return true;

  if (
    [
      'other', 'other other', 'men', 'women', 'boys', 'girls',
      'not knitted or crocheted', 'knitted or crocheted',
    ].includes(normalized)
  ) {
    return true;
  }

  if (normalized.startsWith('other ') && tokenCount <= 3) return true;

  if (
    (normalized.startsWith('of ') ||
      normalized.startsWith('for ') ||
      normalized.startsWith('with ')) &&
    tokenCount <= 2
  ) {
    return true;
  }

  return false;
}

function shouldIncludeClassify(query: string, description: string): boolean {
  const normalizedDescription = description.toLowerCase();
  if (!query || query.length < 4) return false;
  if (normalizedDescription === 'other' || normalizedDescription.startsWith('other ')) return false;
  return true;
}

async function main(): Promise<void> {
  const perChapterLimit = Math.min(
    Math.max(parseInt(parseArg('per-chapter') || '50', 10) || 50, 10),
    200,
  );
  const output = resolve(
    process.cwd(),
    parseArg('out') || 'docs/evaluation/lookup-evaluation-set-v2.jsonl',
  );

  await dataSource.initialize();

  const rows = (await dataSource.query(
    `
      SELECT
        hts_number,
        chapter,
        description,
        full_description
      FROM hts
      WHERE is_active = true
        AND chapter NOT IN ('98', '99')
        AND LENGTH(REPLACE(hts_number, '.', '')) IN (8, 10)
        AND COALESCE(BTRIM(description), '') <> ''
      ORDER BY chapter, md5(hts_number)
    `,
  )) as HtsRow[];

  const generatedAt = new Date().toISOString();

  // Group query candidates by chapter
  const byChapter = new Map<string, Map<string, QueryCandidate[]>>();

  for (const row of rows) {
    const ch = row.chapter;
    if (!byChapter.has(ch)) byChapter.set(ch, new Map());
    const chapterMap = byChapter.get(ch)!;

    const variants = buildQueryVariants(row);
    for (const query of variants) {
      const key = query.toLowerCase();
      if (!chapterMap.has(key)) chapterMap.set(key, []);
      chapterMap.get(key)!.push({
        query,
        htsNumber: row.hts_number,
        chapter: ch,
        includeClassify: shouldIncludeClassify(query, row.description),
      });
    }
  }

  // ── Phase 1: Per-chapter candidate collection ─────────────────────────────
  // Collect up to perChapterLimit QueryCandidates per chapter.
  // A QueryCandidate is NOT yet deduplicated across chapters.

  const perChapterCandidates: QueryCandidate[] = [];
  const totalChapters = byChapter.size;
  let lowInfoSkipped = 0;
  const chapterStats: Record<string, number> = {};

  const sortedChapters = [...byChapter.keys()].sort();

  for (const chapter of sortedChapters) {
    const chapterMap = byChapter.get(chapter)!;
    let chapterCount = 0;

    const sortedKeys = [...chapterMap.keys()].sort((a, b) => md5(a).localeCompare(md5(b)));

    for (const key of sortedKeys) {
      if (chapterCount >= perChapterLimit) break;

      const bucket = chapterMap.get(key)!;
      const query = bucket[0].query;

      if (isLowInformationQuery(query)) {
        lowInfoSkipped++;
        continue;
      }

      // Include all candidates for this query text within this chapter
      for (const c of bucket) {
        perChapterCandidates.push(c);
      }
      chapterCount++;
    }

    chapterStats[chapter] = chapterCount;
  }

  // ── Phase 2: Global deduplication across chapters ─────────────────────────
  // The same query text (e.g. "herring") may appear in multiple chapters
  // (ch.03 fresh fish AND ch.16 prepared fish). We must merge these into one
  // multi-label row so the eval harness doesn't reject duplicate query strings.

  const globalQueryMap = new Map<string, QueryCandidate[]>();
  for (const candidate of perChapterCandidates) {
    const key = candidate.query.toLowerCase();
    if (!globalQueryMap.has(key)) globalQueryMap.set(key, []);
    globalQueryMap.get(key)!.push(candidate);
  }

  const set: EvalRow[] = [];
  let sequence = 1;
  let ambiguousRows = 0;
  const chaptersProcessed = sortedChapters.length;

  // Sort globally by md5 for determinism
  const globalSortedKeys = [...globalQueryMap.keys()].sort((a, b) => md5(a).localeCompare(md5(b)));

  for (const key of globalSortedKeys) {
    const bucket = globalQueryMap.get(key)!;
    const query = bucket[0].query;

    const acceptableHtsNumbers = [...new Set(bucket.map((item) => item.htsNumber))].sort();
    const acceptableChapters = [...new Set(bucket.map((item) => item.chapter))].sort();
    const expectedHtsNumber = acceptableHtsNumbers[0];
    const expectedChapter = acceptableChapters[0] || expectedHtsNumber.substring(0, 2);
    const isAmbiguous = acceptableHtsNumbers.length > 1;

    const endpoints: Array<'autocomplete' | 'search' | 'classify'> = ['autocomplete', 'search'];
    if (!isAmbiguous && bucket.some((item) => item.includeClassify)) {
      endpoints.push('classify');
    }

    if (isAmbiguous) ambiguousRows++;

    set.push({
      id: `eval2-${String(sequence).padStart(5, '0')}`,
      query,
      expectedHtsNumber,
      expectedChapter,
      acceptableHtsNumbers: acceptableHtsNumbers.length > 1 ? acceptableHtsNumbers : undefined,
      acceptableChapters: acceptableChapters.length > 1 ? acceptableChapters : undefined,
      ambiguity: isAmbiguous ? 'multi_label' : undefined,
      endpoints,
      source: 'generated-v2',
      generatedAt,
    });

    sequence++;
  }

  await mkdir(dirname(output), { recursive: true });

  const lines = [
    '# HTS lookup evaluation set v2 (JSONL) — chapter-stratified',
    `# Generated with per-chapter limit: ${perChapterLimit}`,
    '# One JSON object per line',
    '# expectedHtsNumber is canonical for single-label rows',
    '# acceptableHtsNumbers is used for ambiguity-tolerant scoring when present',
    ...set.map((entry) => JSON.stringify(entry)),
    '',
  ];
  await writeFile(output, lines.join('\n'), 'utf-8');

  await dataSource.destroy();

  // Print chapter coverage summary
  const coverageEntries = Object.entries(chapterStats).sort(([a], [b]) => a.localeCompare(b));
  const underCovered = coverageEntries.filter(([, count]) => count < perChapterLimit);

  console.log(
    JSON.stringify(
      {
        output,
        perChapterLimit,
        totalChaptersFound: totalChapters,
        chaptersProcessed,
        totalGenerated: set.length,
        ambiguousRows,
        lowInfoSkipped,
        classifyTagged: set.filter((row) => row.endpoints.includes('classify')).length,
        underCoveredChapters: underCovered.map(([ch, count]) => `${ch}:${count}`),
        chapterCoverage: Object.fromEntries(coverageEntries),
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
  process.exit(1);
});
