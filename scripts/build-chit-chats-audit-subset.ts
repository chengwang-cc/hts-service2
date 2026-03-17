#!/usr/bin/env ts-node
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';

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

interface SearchItem {
  htsNumber: string;
  description: string;
}

interface SearchProbeResult {
  status: number;
  latencyMs: number;
  normalizedQuery: string;
  top10: SearchItem[];
  error?: string;
}

interface AuditCandidate {
  auditId: string;
  priorityScore: number;
  priorityFlags: string[];
  queryId: string;
  standardizedQuery: string;
  normalizedQuery: string;
  representativeDescription: string;
  expectedHtsNumber: string;
  acceptableHtsNumbers: string[];
  expectedChapter: string;
  ambiguity: string;
  contributingStandardizedRows: number;
  maxNoiseScore: number;
  liveStatus: number;
  liveLatencyMs: number;
  liveTop1HtsNumber: string;
  liveTop1Description: string;
  liveTop10HtsNumbers: string[];
  liveExactTop1: boolean;
  liveExactTop10: boolean;
  expectedHtsDescription: string;
  expectedHtsPath: string;
  auditStatus: 'PENDING';
  auditedHtsNumber: string;
  auditedDescription: string;
  reviewerNotes: string;
}

interface HtsDetail {
  description?: string;
  fullDescription?: string[] | null;
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

async function fetchJson<T>(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; payload: T | null; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as T | null;
    return {
      status: response.status,
      payload,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: 0,
      payload: null,
      error:
        error instanceof Error && error.name === 'AbortError'
          ? `Timeout after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callSearch(
  baseUrl: string,
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/lookup/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, limit }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const results = Array.isArray(payload.results)
      ? (payload.results as Array<Record<string, unknown>>)
      : [];

    return {
      status: response.status,
      latencyMs,
      normalizedQuery:
        String(payload.normalizedQuery || payload.standardizedQuery || query).trim(),
      top10: results
        .map((item) => ({
          htsNumber: String(item.htsNumber || item.hts_number || '').trim(),
          description: String(item.description || '').trim(),
        }))
        .filter((item) => item.htsNumber)
        .slice(0, 10),
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: 0,
      latencyMs: Date.now() - startedAt,
      normalizedQuery: query,
      top10: [],
      error:
        error instanceof Error && error.name === 'AbortError'
          ? `Timeout after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function computeStaticPriority(row: EvalCsvRow): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;
  const tokenCount = row.standardized_query.split(/\s+/).filter(Boolean).length;
  const noiseScore = Number(row.max_noise_score || '0');
  const contributors = Number(row.contributing_standardized_rows || '1');

  if (row.ambiguity === 'multi_label') {
    score += 45;
    flags.push('multi_label');
  }

  if (noiseScore >= 2) {
    score += 20;
    flags.push('high_noise');
  } else if (noiseScore === 1) {
    score += 10;
    flags.push('moderate_noise');
  }

  if (contributors >= 3) {
    score += 20;
    flags.push('many_contributors');
  } else if (contributors === 2) {
    score += 10;
    flags.push('multi_source');
  }

  if (tokenCount <= 3) {
    score += 15;
    flags.push('short_query');
  }

  if (tokenCount >= 10) {
    score += 10;
    flags.push('long_query');
  }

  if (['42', '61', '62', '64', '71', '85', '95'].includes(row.expected_chapter)) {
    score += 10;
    flags.push(`high_value_chapter_${row.expected_chapter}`);
  }

  return { score, flags };
}

function applyDynamicPriority(
  baseScore: number,
  baseFlags: string[],
  row: EvalCsvRow,
  probe: SearchProbeResult,
): { score: number; flags: string[] } {
  const flags = [...baseFlags];
  let score = baseScore;
  const acceptable = row.acceptable_hts_numbers.split('|').map((item) => item.trim());
  const top1 = probe.top10[0]?.htsNumber || '';
  const exactTop10 = probe.top10.some((item) => acceptable.includes(item.htsNumber));

  if (probe.error) {
    score += 40;
    flags.push('search_error');
  } else {
    if (!top1) {
      score += 35;
      flags.push('no_results');
    } else if (!acceptable.includes(top1)) {
      score += 25;
      flags.push('top1_mismatch');
    } else {
      score -= 10;
      flags.push('top1_match');
    }

    if (!exactTop10) {
      score += 50;
      flags.push('top10_miss');
    }

    if (probe.latencyMs >= 1500) {
      score += 10;
      flags.push('slow_search');
    }
  }

  return { score, flags };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (true) {
      const current = cursor++;
      if (current >= values.length) {
        return;
      }
      results[current] = await worker(values[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, () => run()),
  );

  return results;
}

async function main(): Promise<void> {
  const baseUrl =
    parseArg('base-url') || process.env.BASE_URL || 'https://api.usahts.com/api/v1';
  const input = resolve(
    process.cwd(),
    parseArg('in') || 'docs/evaluation/chit-chats-live-eval.csv',
  );
  const outCsv = resolve(
    process.cwd(),
    parseArg('out-csv') || 'docs/evaluation/chit-chats-manual-audit.csv',
  );
  const outJson = resolve(
    process.cwd(),
    parseArg('out-json') || 'docs/evaluation/chit-chats-manual-audit.summary.json',
  );
  const subsetSize = Math.max(parseInt(parseArg('subset-size') || '300', 10) || 300, 25);
  const probeLimit = Math.max(parseInt(parseArg('probe-limit') || '10', 10) || 10, 3);
  const probeTimeoutMs = Math.max(
    parseInt(parseArg('probe-timeout-ms') || '15000', 10) || 15000,
    1000,
  );
  const concurrency = Math.max(parseInt(parseArg('concurrency') || '6', 10) || 6, 1);

  const raw = await readFile(input, 'utf-8');
  const parsed = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as EvalCsvRow[];

  const staticRanked = [...parsed]
    .map((row) => ({
      row,
      ...computeStaticPriority(row),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return md5(`${a.row.query_id}:${a.row.standardized_query}`).localeCompare(
        md5(`${b.row.query_id}:${b.row.standardized_query}`),
      );
    });

  const probeCandidates = staticRanked.slice(0, Math.min(parsed.length, subsetSize * 2));
  const probed = await mapWithConcurrency(
    probeCandidates,
    concurrency,
    async (candidate) => {
      const probe = await callSearch(
        baseUrl,
        candidate.row.standardized_query,
        probeLimit,
        probeTimeoutMs,
      );
      const dynamic = applyDynamicPriority(
        candidate.score,
        candidate.flags,
        candidate.row,
        probe,
      );

      return {
        row: candidate.row,
        probe,
        priorityScore: dynamic.score,
        priorityFlags: [...new Set(dynamic.flags)],
      };
    },
  );

  const selected = probed
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      return md5(`${a.row.query_id}:${a.row.standardized_query}`).localeCompare(
        md5(`${b.row.query_id}:${b.row.standardized_query}`),
      );
    })
    .slice(0, subsetSize);

  const detailCache = new Map<string, HtsDetail>();
  async function getDetail(code: string): Promise<HtsDetail | null> {
    if (!code) {
      return null;
    }
    if (detailCache.has(code)) {
      return detailCache.get(code)!;
    }
    const response = await fetchJson<HtsDetail>(
      `${baseUrl}/lookup/hts/${encodeURIComponent(code)}`,
      probeTimeoutMs,
    );
    const detail = response.payload;
    if (detail) {
      detailCache.set(code, detail);
    }
    return detail;
  }

  const detailCodes = [...new Set(
    selected.flatMap((item) => [
      item.row.expected_hts_number,
      item.probe.top10[0]?.htsNumber || '',
    ]).filter(Boolean),
  )];

  await mapWithConcurrency(detailCodes, concurrency, async (code) => {
    await getDetail(code);
  });

  const auditRows: AuditCandidate[] = [];
  for (const item of selected) {
    const expectedDetail = await getDetail(item.row.expected_hts_number);
    const top1 = item.probe.top10[0];
    const acceptable = item.row.acceptable_hts_numbers
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean);

    auditRows.push({
      auditId: `audit-${item.row.query_id}`,
      priorityScore: item.priorityScore,
      priorityFlags: item.priorityFlags,
      queryId: item.row.query_id,
      standardizedQuery: item.row.standardized_query,
      normalizedQuery: item.probe.normalizedQuery,
      representativeDescription: item.row.representative_description,
      expectedHtsNumber: item.row.expected_hts_number,
      acceptableHtsNumbers: acceptable,
      expectedChapter: item.row.expected_chapter,
      ambiguity: item.row.ambiguity,
      contributingStandardizedRows: Number(item.row.contributing_standardized_rows || '1'),
      maxNoiseScore: Number(item.row.max_noise_score || '0'),
      liveStatus: item.probe.status,
      liveLatencyMs: item.probe.latencyMs,
      liveTop1HtsNumber: top1?.htsNumber || '',
      liveTop1Description: top1?.description || '',
      liveTop10HtsNumbers: item.probe.top10.map((entry) => entry.htsNumber),
      liveExactTop1: Boolean(top1 && acceptable.includes(top1.htsNumber)),
      liveExactTop10: item.probe.top10.some((entry) => acceptable.includes(entry.htsNumber)),
      expectedHtsDescription: expectedDetail?.description || '',
      expectedHtsPath: (expectedDetail?.fullDescription || []).join(' > '),
      auditStatus: 'PENDING',
      auditedHtsNumber: '',
      auditedDescription: '',
      reviewerNotes: '',
    });
  }

  await mkdir(dirname(outCsv), { recursive: true });
  await mkdir(dirname(outJson), { recursive: true });

  const auditCsv = csvStringify(
    auditRows.map((row) => ({
      audit_id: row.auditId,
      priority_score: row.priorityScore,
      priority_flags: row.priorityFlags.join('|'),
      query_id: row.queryId,
      standardized_query: row.standardizedQuery,
      normalized_query: row.normalizedQuery,
      representative_description: row.representativeDescription,
      expected_hts_number: row.expectedHtsNumber,
      acceptable_hts_numbers: row.acceptableHtsNumbers.join('|'),
      expected_chapter: row.expectedChapter,
      ambiguity: row.ambiguity,
      contributing_standardized_rows: row.contributingStandardizedRows,
      max_noise_score: row.maxNoiseScore,
      live_status: row.liveStatus,
      live_latency_ms: row.liveLatencyMs,
      live_top1_hts_number: row.liveTop1HtsNumber,
      live_top1_description: row.liveTop1Description,
      live_top10_hts_numbers: row.liveTop10HtsNumbers.join('|'),
      live_exact_top1: row.liveExactTop1,
      live_exact_top10: row.liveExactTop10,
      expected_hts_description: row.expectedHtsDescription,
      expected_hts_path: row.expectedHtsPath,
      audit_status: row.auditStatus,
      audited_hts_number: row.auditedHtsNumber,
      audited_description: row.auditedDescription,
      reviewer_notes: row.reviewerNotes,
    })),
    { header: true },
  );

  const summary = {
    input,
    outCsv,
    subsetSize: auditRows.length,
    probedCandidates: probeCandidates.length,
    pendingAudits: auditRows.length,
    topPriorityFlags: Object.entries(
      auditRows.reduce<Record<string, number>>((acc, row) => {
        for (const flag of row.priorityFlags) {
          acc[flag] = (acc[flag] || 0) + 1;
        }
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20),
    exactTop1InSubset: auditRows.filter((row) => row.liveExactTop1).length,
    exactTop10InSubset: auditRows.filter((row) => row.liveExactTop10).length,
  };

  await writeFile(outCsv, auditCsv, 'utf-8');
  await writeFile(outJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  console.log(
    JSON.stringify(
      {
        outCsv,
        outJson,
        summary,
      },
      null,
      2,
    ),
  );

  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
