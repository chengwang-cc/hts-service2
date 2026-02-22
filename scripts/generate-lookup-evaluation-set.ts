#!/usr/bin/env ts-node
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
  source: 'generated';
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

  if (normalized.length < 4) {
    return true;
  }

  if (
    [
      'other',
      'other other',
      'men',
      'women',
      'boys',
      'girls',
      'not knitted or crocheted',
      'knitted or crocheted',
    ].includes(normalized)
  ) {
    return true;
  }

  // Drop short generic phrases that are typically not actionable search intent.
  if (normalized.startsWith('other ') && tokenCount <= 3) {
    return true;
  }

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
  if (!query || query.length < 4) {
    return false;
  }

  if (
    normalizedDescription === 'other' ||
    normalizedDescription.startsWith('other ')
  ) {
    return false;
  }

  return true;
}

async function main(): Promise<void> {
  const target = Math.min(
    Math.max(parseInt(parseArg('target') || '700', 10) || 700, 500),
    1000,
  );
  const output = resolve(
    process.cwd(),
    parseArg('out') || 'docs/evaluation/lookup-evaluation-set-v1.jsonl',
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
      ORDER BY md5(hts_number)
    `,
  )) as HtsRow[];

  const generatedAt = new Date().toISOString();
  const queryCandidates: QueryCandidate[] = [];

  for (const row of rows) {
    const variants = buildQueryVariants(row);
    for (const query of variants) {
      queryCandidates.push({
        query,
        htsNumber: row.hts_number,
        chapter: row.chapter,
        includeClassify: shouldIncludeClassify(query, row.description),
      });
    }
  }

  const grouped = new Map<string, QueryCandidate[]>();
  for (const item of queryCandidates) {
    const key = item.query.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(item);
  }

  const set: EvalRow[] = [];
  let sequence = 1;
  let lowInfoSkipped = 0;
  let ambiguousRows = 0;
  const sortedKeys = [...grouped.keys()].sort((a, b) => md5(a).localeCompare(md5(b)));

  for (const key of sortedKeys) {
    if (set.length >= target) {
      break;
    }

    const bucket = grouped.get(key)!;
    const query = bucket[0].query;
    if (isLowInformationQuery(query)) {
      lowInfoSkipped++;
      continue;
    }

    const acceptableHtsNumbers = [...new Set(bucket.map((item) => item.htsNumber))].sort();
    const acceptableChapters = [...new Set(bucket.map((item) => item.chapter))].sort();
    const expectedHtsNumber = acceptableHtsNumbers[0];
    const expectedChapter = acceptableChapters[0] || expectedHtsNumber.substring(0, 2);
    const isAmbiguous = acceptableHtsNumbers.length > 1;

    const endpoints: Array<'autocomplete' | 'search' | 'classify'> = [
      'autocomplete',
      'search',
    ];
    if (!isAmbiguous && bucket.some((item) => item.includeClassify)) {
      endpoints.push('classify');
    }

    if (isAmbiguous) {
      ambiguousRows++;
    }

    set.push({
      id: `eval-${String(sequence).padStart(5, '0')}`,
      query,
      expectedHtsNumber,
      expectedChapter,
      acceptableHtsNumbers:
        acceptableHtsNumbers.length > 1 ? acceptableHtsNumbers : undefined,
      acceptableChapters:
        acceptableChapters.length > 1 ? acceptableChapters : undefined,
      ambiguity: isAmbiguous ? 'multi_label' : undefined,
      endpoints,
      source: 'generated',
      generatedAt,
    });
    sequence++;
  }

  await mkdir(dirname(output), { recursive: true });

  const lines = [
    '# HTS lookup evaluation set (JSONL)',
    '# One JSON object per line',
    '# expectedHtsNumber is canonical for single-label rows',
    '# acceptableHtsNumbers is used for ambiguity-tolerant scoring when present',
    ...set.map((entry) => JSON.stringify(entry)),
    '',
  ];
  await writeFile(output, lines.join('\n'), 'utf-8');

  await dataSource.destroy();

  console.log(
    JSON.stringify(
      {
        output,
        target,
        generated: set.length,
        ambiguousRows,
        lowInfoSkipped,
        classifyTagged: set.filter((row) => row.endpoints.includes('classify'))
          .length,
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
