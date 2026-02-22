#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import dataSource from '../src/db/data-source';

type EvaluationEndpoint = 'autocomplete' | 'search' | 'classify';

interface EvalRow {
  id: string;
  query: string;
  expectedHtsNumber?: string;
  expectedChapter?: string;
  acceptableHtsNumbers?: string[];
  acceptableChapters?: string[];
  ambiguity?: string;
  endpoints?: EvaluationEndpoint[];
}

interface ValidationIssue {
  severity: 'error' | 'warn';
  id?: string;
  reason: string;
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

function boolArg(name: string, fallback: boolean): boolean {
  const raw = parseArg(name);
  if (!raw) {
    return fallback;
  }
  return raw === 'true';
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsAny(text: string, terms: string[]): boolean {
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term));
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    process.cwd(),
    parseArg('set') || 'docs/evaluation/lookup-evaluation-set-v1.jsonl',
  );
  const strict = boolArg('strict', false);
  const checkActive = boolArg('check-active', true);

  const raw = await readFile(datasetPath, 'utf-8');
  const lines = raw.split('\n');
  const rows: EvalRow[] = [];
  const issues: ValidationIssue[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as EvalRow;
      rows.push(parsed);
    } catch {
      issues.push({
        severity: 'error',
        reason: `Invalid JSON at line ${index + 1}`,
      });
    }
  }

  const seenId = new Set<string>();
  const queryToRows = new Map<string, EvalRow[]>();
  const allHts = new Set<string>();

  for (const row of rows) {
    const id = (row.id || '').trim();
    const query = (row.query || '').trim();

    if (!id || !query) {
      issues.push({ severity: 'error', id, reason: 'Missing id or query' });
      continue;
    }

    if (seenId.has(id)) {
      issues.push({ severity: 'error', id, reason: 'Duplicate id' });
    }
    seenId.add(id);

    const acceptable = [
      ...new Set(
        [
          ...(Array.isArray(row.acceptableHtsNumbers)
            ? row.acceptableHtsNumbers
            : []),
          row.expectedHtsNumber || '',
        ]
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];

    if (acceptable.length === 0) {
      issues.push({ severity: 'error', id, reason: 'No expected/acceptable HTS' });
      continue;
    }

    for (const hts of acceptable) {
      allHts.add(hts);
    }

    const expected = (row.expectedHtsNumber || '').trim() || acceptable[0];
    if (!acceptable.includes(expected)) {
      issues.push({
        severity: 'error',
        id,
        reason: 'expectedHtsNumber is not included in acceptableHtsNumbers',
      });
    }

    const chapters = [
      ...new Set(
        [
          ...(Array.isArray(row.acceptableChapters) ? row.acceptableChapters : []),
          row.expectedChapter || '',
          ...acceptable.map((item) => item.substring(0, 2)),
        ]
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];

    if (chapters.length === 0) {
      issues.push({ severity: 'error', id, reason: 'No chapter labels available' });
    }

    const endpoints = [
      ...new Set(
        (row.endpoints || ['autocomplete', 'search', 'classify']).filter(
          (value): value is EvaluationEndpoint =>
            value === 'autocomplete' ||
            value === 'search' ||
            value === 'classify',
        ),
      ),
    ];

    if (acceptable.length > 1 && endpoints.includes('classify')) {
      issues.push({
        severity: 'warn',
        id,
        reason: 'Ambiguous row should not include classify endpoint',
      });
    }

    if (normalize(query) === 'other' || normalize(query) === 'other other') {
      issues.push({
        severity: 'warn',
        id,
        reason: 'Low-information query text may create noisy labels',
      });
    }

    const key = normalize(query);
    if (!queryToRows.has(key)) {
      queryToRows.set(key, []);
    }
    queryToRows.get(key)!.push(row);

    const isComicQuery = containsAny(query, ['comic', 'comics']);
    const hasDisambiguator = containsAny(query, [
      'page',
      'pages',
      'periodical',
      'journal',
      'magazine',
      'newspaper',
      '49',
      '48',
    ]);
    const comicHtsCodes = ['4901.99.00.92', '4901.99.00.93'];
    const includesComicLeaf = acceptable.some((item) =>
      comicHtsCodes.includes(item),
    );
    const includesPeriodical = acceptable.some((item) => item.startsWith('4902'));

    if (isComicQuery && !hasDisambiguator && (includesComicLeaf || includesPeriodical)) {
      if (acceptable.length === 1) {
        issues.push({
          severity: 'warn',
          id,
          reason:
            'Comic query lacks page/periodical disambiguator but has single-label expectation',
        });
      }
    }
  }

  for (const [query, bucket] of queryToRows.entries()) {
    if (bucket.length <= 1) {
      continue;
    }

    const labels = [
      ...new Set(
        bucket.flatMap((row) => [
          ...(Array.isArray(row.acceptableHtsNumbers)
            ? row.acceptableHtsNumbers
            : []),
          row.expectedHtsNumber || '',
        ]),
      ),
    ].filter(Boolean);

    if (labels.length > 1) {
      issues.push({
        severity: 'error',
        reason: `Duplicate query mapped by multiple rows: \"${query}\"`,
      });
    }
  }

  let missingActive = 0;
  if (checkActive && allHts.size > 0) {
    await dataSource.initialize();

    try {
      const values = [...allHts];
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const existingRows = (await dataSource.query(
        `
          SELECT hts_number
          FROM hts
          WHERE is_active = true
            AND hts_number IN (${placeholders})
        `,
        values,
      )) as Array<{ hts_number: string }>;

      const existing = new Set(existingRows.map((row) => row.hts_number));
      for (const code of values) {
        if (!existing.has(code)) {
          missingActive++;
          issues.push({
            severity: 'error',
            reason: `HTS code not found as active in DB: ${code}`,
          });
        }
      }
    } finally {
      await dataSource.destroy();
    }
  }

  const errors = issues.filter((item) => item.severity === 'error');
  const warnings = issues.filter((item) => item.severity === 'warn');

  const summary = {
    datasetPath,
    rows: rows.length,
    uniqueQueries: queryToRows.size,
    errors: errors.length,
    warnings: warnings.length,
    missingActive,
    strict,
  };

  console.log(JSON.stringify(summary, null, 2));

  const maxPrinted = 40;
  if (issues.length > 0) {
    console.log('');
    console.log('Issues (first 40):');
    for (const issue of issues.slice(0, maxPrinted)) {
      const prefix = issue.id ? `[${issue.id}] ` : '';
      console.log(`- ${issue.severity.toUpperCase()}: ${prefix}${issue.reason}`);
    }
  }

  const shouldFail = errors.length > 0 || (strict && warnings.length > 0);
  if (shouldFail) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
  process.exit(1);
});
