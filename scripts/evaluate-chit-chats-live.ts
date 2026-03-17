#!/usr/bin/env ts-node
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';

type EndpointName = 'search' | 'smart-classify';

interface EvalCsvRow {
  query_id: string;
  standardized_query: string;
  representative_description: string;
  expected_hts_number: string;
  acceptable_hts_numbers: string;
  expected_chapter: string;
  ambiguity: string;
  contributing_standardized_rows: string;
  max_noise_score: string;
}

interface CaseResult {
  queryId: string;
  query: string;
  endpoint: EndpointName;
  status: number;
  latencyMs: number;
  success: boolean;
  top1: string;
  top3: string[];
  top10: string[];
  expectedHtsNumber: string;
  acceptableHtsNumbers: string[];
  exactTop1: boolean;
  exactTop3: boolean;
  exactTop10: boolean;
  chapterTop10: boolean;
  ambiguity: string;
  error?: string;
}

interface EndpointSummary {
  evaluated: number;
  exactTop1: number;
  exactTop3: number;
  exactTop10: number;
  chapterTop10: number;
  errors: number;
  latencyMs: {
    min: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    avg: number;
  };
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(results: CaseResult[]): Record<EndpointName, EndpointSummary> {
  const grouped: Record<EndpointName, CaseResult[]> = {
    search: results.filter((item) => item.endpoint === 'search'),
    'smart-classify': results.filter((item) => item.endpoint === 'smart-classify'),
  };

  return {
    search: buildEndpointSummary(grouped.search),
    'smart-classify': buildEndpointSummary(grouped['smart-classify']),
  };
}

function buildEndpointSummary(results: CaseResult[]): EndpointSummary {
  const latencies = results.map((item) => item.latencyMs);
  const avg = latencies.length
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : 0;

  return {
    evaluated: results.length,
    exactTop1: results.filter((item) => item.exactTop1).length,
    exactTop3: results.filter((item) => item.exactTop3).length,
    exactTop10: results.filter((item) => item.exactTop10).length,
    chapterTop10: results.filter((item) => item.chapterTop10).length,
    errors: results.filter((item) => !item.success).length,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : 0,
      avg: Number(avg.toFixed(2)),
    },
  };
}

function toPct(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return 'n/a';
  }
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

async function callEndpoint(
  baseUrl: string,
  endpoint: EndpointName,
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<{ status: number; top10: string[]; error?: string }> {
  const url = `${baseUrl}/lookup/${endpoint}`;
  const body =
    endpoint === 'search'
      ? JSON.stringify({ query, limit })
      : JSON.stringify({ query });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const status = response.status;
    const payload = await response.json().catch(() => ({}));

    const rawResults = endpoint === 'search'
      ? (Array.isArray((payload as Record<string, unknown>).results)
          ? ((payload as Record<string, unknown>).results as Array<Record<string, unknown>>)
          : [])
      : (Array.isArray((payload as Record<string, unknown>).results)
          ? ((payload as Record<string, unknown>).results as Array<Record<string, unknown>>)
          : []);
    const top10 = rawResults
      .map((item) => String(item.htsNumber || item.hts_number || '').trim())
      .filter(Boolean)
      .slice(0, 10);

    if (!response.ok) {
      return {
        status,
        top10,
        error: `HTTP ${status}`,
      };
    }

    return { status, top10 };
  } catch (error) {
    clearTimeout(timeout);
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `Timeout after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      status: 0,
      top10: [],
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateCase(
  baseUrl: string,
  row: EvalCsvRow,
  endpoint: EndpointName,
  limit: number,
  timeoutMs: number,
): Promise<CaseResult> {
  const acceptableHtsNumbers = row.acceptable_hts_numbers
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  const expectedChapter = row.expected_chapter;

  const startedAt = Date.now();
  const outcome = await callEndpoint(baseUrl, endpoint, row.standardized_query, limit, timeoutMs);
  const latencyMs = Date.now() - startedAt;
  const top10 = outcome.top10;

  return {
    queryId: row.query_id,
    query: row.standardized_query,
    endpoint,
    status: outcome.status,
    latencyMs,
    success: !outcome.error,
    top1: top10[0] || '',
    top3: top10.slice(0, 3),
    top10,
    expectedHtsNumber: row.expected_hts_number,
    acceptableHtsNumbers,
    exactTop1: Boolean(top10[0] && acceptableHtsNumbers.includes(top10[0])),
    exactTop3: top10.slice(0, 3).some((item) => acceptableHtsNumbers.includes(item)),
    exactTop10: top10.some((item) => acceptableHtsNumbers.includes(item)),
    chapterTop10: top10.some((item) => item.startsWith(expectedChapter)),
    ambiguity: row.ambiguity,
    error: outcome.error,
  };
}

async function main(): Promise<void> {
  const baseUrl = parseArg('base-url') || process.env.BASE_URL || 'https://api.usahts.com/api/v1';
  const input = resolve(
    process.cwd(),
    parseArg('in') || 'docs/evaluation/chit-chats-live-eval.csv',
  );
  const outJson = resolve(
    process.cwd(),
    parseArg('out-json') || 'docs/reports/lookup-eval/chit-chats-live-report.json',
  );
  const outCsv = resolve(
    process.cwd(),
    parseArg('out-csv') || 'docs/reports/lookup-eval/chit-chats-live-results.csv',
  );
  const outSummary = resolve(
    process.cwd(),
    parseArg('out-summary') || 'docs/reports/lookup-eval/chit-chats-live-summary.txt',
  );
  const endpoints = (parseArg('endpoints') || 'search,smart-classify')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) as EndpointName[];
  const maxRows = Math.max(parseInt(parseArg('max') || '0', 10) || 0, 0);
  const limit = Math.max(parseInt(parseArg('limit') || '10', 10) || 10, 1);
  const timeoutMs = Math.max(parseInt(parseArg('timeout-ms') || '20000', 10) || 20000, 1000);

  const raw = await readFile(input, 'utf-8');
  const parsed = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as EvalCsvRow[];

  const ordered = [...parsed].sort((a, b) =>
    md5(`${a.query_id}:${a.standardized_query}`).localeCompare(
      md5(`${b.query_id}:${b.standardized_query}`),
    ),
  );
  const rows = maxRows > 0 ? ordered.slice(0, maxRows) : ordered;
  const results: CaseResult[] = [];

  for (const [index, row] of rows.entries()) {
    for (const endpoint of endpoints) {
      const result = await evaluateCase(baseUrl, row, endpoint, limit, timeoutMs);
      results.push(result);
    }
    if ((index + 1) % 50 === 0 || index + 1 === rows.length) {
      process.stdout.write(`\rEvaluated ${index + 1}/${rows.length} queries`);
    }
  }
  process.stdout.write('\n');

  const summary = summarize(results);
  const report = {
    baseUrl,
    input,
    rowsEvaluated: rows.length,
    endpoints,
    summary,
    generatedAt: new Date().toISOString(),
  };

  const failureCsv = csvStringify(
    results
      .filter((item) => !item.exactTop10)
      .map((item) => ({
        query_id: item.queryId,
        endpoint: item.endpoint,
        query: item.query,
        expected_hts_number: item.expectedHtsNumber,
        acceptable_hts_numbers: item.acceptableHtsNumbers.join('|'),
        top1: item.top1,
        top3: item.top3.join('|'),
        top10: item.top10.join('|'),
        latency_ms: item.latencyMs,
        status: item.status,
        ambiguity: item.ambiguity,
        error: item.error || '',
      })),
    { header: true },
  );

  const summaryLines = endpoints.map((endpoint) => {
    const item = summary[endpoint];
    return [
      `[${endpoint}]`,
      `evaluated: ${item.evaluated}`,
      `exact@1: ${toPct(item.exactTop1, item.evaluated)}`,
      `exact@3: ${toPct(item.exactTop3, item.evaluated)}`,
      `exact@10: ${toPct(item.exactTop10, item.evaluated)}`,
      `chapter@10: ${toPct(item.chapterTop10, item.evaluated)}`,
      `errors: ${item.errors}`,
      `latency_ms: min=${item.latencyMs.min} p50=${item.latencyMs.p50} p95=${item.latencyMs.p95} p99=${item.latencyMs.p99} max=${item.latencyMs.max} avg=${item.latencyMs.avg}`,
    ].join('\n');
  });

  await mkdir(dirname(outJson), { recursive: true });
  await mkdir(dirname(outCsv), { recursive: true });
  await mkdir(dirname(outSummary), { recursive: true });

  await writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await writeFile(outCsv, failureCsv, 'utf-8');
  await writeFile(outSummary, `${summaryLines.join('\n\n')}\n`, 'utf-8');

  console.log(`Saved: ${outJson}`);
  console.log(`Saved: ${outCsv}`);
  console.log(`Saved: ${outSummary}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
