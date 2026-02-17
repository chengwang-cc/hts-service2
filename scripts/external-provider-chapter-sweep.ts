import axios, { AxiosError } from 'axios';
import { Client } from 'pg';
import { promises as fs } from 'fs';
import path from 'path';

type ChapterCode = {
  chapter: string;
  htsNumber: string;
  isHeading: boolean;
};

type ValidationTarget = {
  provider: string;
  chapter: string;
  htsNumber: string;
  countryCode: string;
  entryDate: string;
  modeOfTransport: string;
  value?: number;
  productName?: string;
  inputContext?: Record<string, any>;
  useMock: boolean;
  requireFormulaExtraction: boolean;
  useAiExtraction: boolean;
  autoAnalyzeOnMismatch: boolean;
};

type ValidationResultRecord = {
  key: string;
  chapter: string;
  htsNumber: string;
  countryCode: string;
  startedAt: string;
  completedAt: string;
  status: 'SUCCESS' | 'FAILED';
  httpStatus?: number;
  snapshotAction?: string;
  isMatch?: boolean;
  mismatchReason?: string | null;
  formulaExtracted?: boolean;
  extractionMethod?: string | null;
  extractionConfidence?: number | null;
  analysisProvider?: 'ai' | 'rules' | null;
  analysisSummary?: string | null;
  errorMessage?: string;
  errorPayload?: any;
};

type SweepConfig = {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
  provider: string;
  countries: string[];
  chapterStart: number;
  chapterEnd: number;
  excludedChapters: Set<number>;
  codesPerChapter: number;
  entryDate: string;
  modeOfTransport: string;
  value?: number;
  productName?: string;
  inputContext: Record<string, any>;
  useMock: boolean;
  requireFormulaExtraction: boolean;
  useAiExtraction: boolean;
  autoAnalyzeOnMismatch: boolean;
  requestSpacingMs: number;
  requestJitterMs: number;
  blockedRetryAttempts: number;
  blockedRetryDelayMs: number;
  blockedRetryBackoffMs: number;
  failOnChapterGap: boolean;
  concurrency: number;
  maxTargets?: number;
  resume: boolean;
  resumeOnlySuccess: boolean;
  outputFile: string;
  summaryFile: string;
  targetsFile?: string;
  planOnly: boolean;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
};

type SweepSummary = {
  startedAt: string;
  completedAt: string;
  baseUrl: string;
  provider: string;
  countries: string[];
  chapterRange: string;
  excludedChapters: number[];
  codesPerChapter: number;
  expectedTargets: number;
  plannedTargets: number;
  skippedFromResume: number;
  executedTargets: number;
  success: number;
  failed: number;
  matches: number;
  mismatches: number;
  extractedFormulaSuccess: number;
  analysisGenerated: number;
  missingChapterCodes: Array<{ chapter: string; found: number; needed: number }>;
  planOnly: boolean;
};

const log = (message: string) => process.stdout.write(`[chapter-sweep] ${message}\n`);

function sleep(ms: number): Promise<void> {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value: string | undefined): string {
  if (!value || !value.trim()) {
    return new Date().toISOString().slice(0, 10);
  }
  return value.trim();
}

function parseChapterSet(value: string | undefined): Set<number> {
  if (!value || !value.trim()) {
    return new Set([77]);
  }
  const parsed = value
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v));
  return new Set(parsed);
}

function parseCountries(value: string | undefined): string[] {
  const raw = value?.trim() || 'CA,CN,EU,RU';
  return raw
    .split(',')
    .map((country) => country.trim().toUpperCase())
    .filter((country) => country.length > 0);
}

function parseJson(value: string | undefined): Record<string, any> {
  if (!value || !value.trim()) {
    return {};
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('EXTERNAL_PROVIDER_SWEEP_INPUT_CONTEXT_JSON must be a JSON object');
  }
  return parsed;
}

function loadConfig(): SweepConfig {
  const baseUrl = (process.env.HTS_BASE_URL || 'http://localhost:3100').replace(/\/$/, '');
  const adminEmail = process.env.HTS_ADMIN_EMAIL || '';
  const adminPassword = process.env.HTS_ADMIN_PASSWORD || '';
  if (!adminEmail || !adminPassword) {
    throw new Error('HTS_ADMIN_EMAIL and HTS_ADMIN_PASSWORD are required');
  }

  const config: SweepConfig = {
    baseUrl,
    adminEmail,
    adminPassword,
    provider: (process.env.EXTERNAL_PROVIDER_SWEEP_PROVIDER || 'FLEXPORT').trim().toUpperCase(),
    countries: parseCountries(process.env.EXTERNAL_PROVIDER_SWEEP_COUNTRIES),
    chapterStart: parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_CHAPTER_START, 1),
    chapterEnd: parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_CHAPTER_END, 97),
    excludedChapters: parseChapterSet(process.env.EXTERNAL_PROVIDER_SWEEP_EXCLUDED_CHAPTERS),
    codesPerChapter: parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_CODES_PER_CHAPTER, 2),
    entryDate: parseDate(process.env.EXTERNAL_PROVIDER_SWEEP_ENTRY_DATE),
    modeOfTransport: (process.env.EXTERNAL_PROVIDER_SWEEP_MODE || 'OCEAN').trim().toUpperCase(),
    value: process.env.EXTERNAL_PROVIDER_SWEEP_VALUE
      ? parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_VALUE, 10000)
      : 10000,
    productName: process.env.EXTERNAL_PROVIDER_SWEEP_PRODUCT_NAME?.trim() || undefined,
    inputContext: parseJson(process.env.EXTERNAL_PROVIDER_SWEEP_INPUT_CONTEXT_JSON),
    useMock: parseBoolean(process.env.EXTERNAL_PROVIDER_SWEEP_USE_MOCK, false),
    requireFormulaExtraction: parseBoolean(
      process.env.EXTERNAL_PROVIDER_SWEEP_REQUIRE_FORMULA_EXTRACTION,
      true,
    ),
    useAiExtraction: parseBoolean(
      process.env.EXTERNAL_PROVIDER_SWEEP_USE_AI_EXTRACTION,
      true,
    ),
    autoAnalyzeOnMismatch: parseBoolean(
      process.env.EXTERNAL_PROVIDER_SWEEP_AUTO_ANALYZE_ON_MISMATCH,
      true,
    ),
    requestSpacingMs: Math.max(
      0,
      parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_REQUEST_SPACING_MS, 1200),
    ),
    requestJitterMs: Math.max(
      0,
      parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_REQUEST_JITTER_MS, 500),
    ),
    blockedRetryAttempts: Math.max(
      0,
      parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_BLOCKED_RETRIES, 2),
    ),
    blockedRetryDelayMs: Math.max(
      0,
      parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_BLOCKED_RETRY_DELAY_MS, 15000),
    ),
    blockedRetryBackoffMs: Math.max(
      0,
      parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_BLOCKED_RETRY_BACKOFF_MS, 10000),
    ),
    failOnChapterGap: parseBoolean(process.env.EXTERNAL_PROVIDER_SWEEP_FAIL_ON_CHAPTER_GAP, true),
    concurrency: Math.max(1, parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_CONCURRENCY, 1)),
    maxTargets: process.env.EXTERNAL_PROVIDER_SWEEP_MAX_TARGETS
      ? parseNumber(process.env.EXTERNAL_PROVIDER_SWEEP_MAX_TARGETS, 0)
      : undefined,
    resume: parseBoolean(process.env.EXTERNAL_PROVIDER_SWEEP_RESUME, true),
    resumeOnlySuccess: parseBoolean(
      process.env.EXTERNAL_PROVIDER_SWEEP_RESUME_ONLY_SUCCESS,
      true,
    ),
    outputFile:
      process.env.EXTERNAL_PROVIDER_SWEEP_OUTPUT_FILE ||
      '/tmp/external-provider-chapter-sweep-results.jsonl',
    summaryFile:
      process.env.EXTERNAL_PROVIDER_SWEEP_SUMMARY_FILE ||
      '/tmp/external-provider-chapter-sweep-summary.json',
    targetsFile: process.env.EXTERNAL_PROVIDER_SWEEP_TARGETS_FILE || undefined,
    planOnly: parseBoolean(process.env.EXTERNAL_PROVIDER_SWEEP_PLAN_ONLY, false),
    dbHost: process.env.DB_HOST || 'localhost',
    dbPort: parseNumber(process.env.DB_PORT, 5432),
    dbUser: process.env.DB_USERNAME || 'postgres',
    dbPassword: process.env.DB_PASSWORD || 'postgres',
    dbName: process.env.DB_DATABASE || 'hts',
  };

  if (config.chapterStart > config.chapterEnd) {
    throw new Error('EXTERNAL_PROVIDER_SWEEP_CHAPTER_START must be <= EXTERNAL_PROVIDER_SWEEP_CHAPTER_END');
  }
  if (config.codesPerChapter < 1) {
    throw new Error('EXTERNAL_PROVIDER_SWEEP_CODES_PER_CHAPTER must be >= 1');
  }
  return config;
}

function buildChapterList(config: SweepConfig): string[] {
  const chapters: string[] = [];
  for (let chapter = config.chapterStart; chapter <= config.chapterEnd; chapter += 1) {
    if (config.excludedChapters.has(chapter)) continue;
    chapters.push(String(chapter).padStart(2, '0'));
  }
  return chapters;
}

function targetKey(target: ValidationTarget): string {
  return [
    target.provider,
    target.chapter,
    target.htsNumber,
    target.countryCode,
    target.entryDate,
    target.modeOfTransport,
  ].join('|');
}

async function ensureOutputDirectories(config: SweepConfig): Promise<void> {
  await fs.mkdir(path.dirname(config.outputFile), { recursive: true });
  await fs.mkdir(path.dirname(config.summaryFile), { recursive: true });
}

async function loadCompletedKeys(config: SweepConfig): Promise<Set<string>> {
  if (!config.resume) return new Set<string>();

  try {
    const content = await fs.readFile(config.outputFile, 'utf8');
    const keys = new Set<string>();
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as ValidationResultRecord;
        if (record?.key) {
          if (config.resumeOnlySuccess && record.status !== 'SUCCESS') {
            continue;
          }
          keys.add(record.key);
        }
      } catch {
        // skip invalid line
      }
    }
    return keys;
  } catch {
    return new Set<string>();
  }
}

async function fetchChapterCodes(config: SweepConfig, chapters: string[]): Promise<ChapterCode[]> {
  const client = new Client({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
  });

  await client.connect();
  try {
    const query = `
      WITH ranked AS (
        SELECT
          h.chapter AS chapter,
          h.hts_number AS hts_number,
          h.is_heading AS is_heading,
          row_number() OVER (
            PARTITION BY h.chapter
            ORDER BY
              CASE
                WHEN h.hts_number ~ '^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$' THEN 0
                ELSE 1
              END ASC,
              h.is_heading ASC,
              length(replace(h.hts_number, '.', '')) DESC,
              h.hts_number ASC
          ) AS rn
        FROM hts h
        WHERE h.is_active = true
          AND h.chapter = ANY($1::text[])
      )
      SELECT chapter, hts_number, is_heading
      FROM ranked
      WHERE rn <= $2
      ORDER BY chapter ASC, rn ASC;
    `;
    const result = await client.query(query, [chapters, config.codesPerChapter]);
    return result.rows.map((row) => ({
      chapter: String(row.chapter),
      htsNumber: String(row.hts_number),
      isHeading: row.is_heading === true,
    }));
  } finally {
    await client.end();
  }
}

async function login(config: SweepConfig): Promise<string> {
  const response = await axios.post(`${config.baseUrl}/auth/login`, {
    email: config.adminEmail,
    password: config.adminPassword,
  });
  const responseBody = response.data || {};
  if (
    typeof responseBody?.statusCode === 'number' &&
    responseBody.statusCode >= 400
  ) {
    throw new Error(
      `Login failed: ${responseBody.message || 'invalid credentials'} (statusCode=${responseBody.statusCode})`,
    );
  }
  const token =
    response.data?.accessToken ||
    response.data?.data?.accessToken ||
    response.data?.tokens?.accessToken ||
    response.data?.data?.tokens?.accessToken;
  if (!token) {
    throw new Error(
      `Login failed: no access token in response (body keys=${Object.keys(responseBody).join(',')})`,
    );
  }
  return String(token);
}

async function validateTarget(
  config: SweepConfig,
  token: string,
  target: ValidationTarget,
): Promise<ValidationResultRecord> {
  const startedAt = new Date().toISOString();
  const payload = {
    provider: target.provider,
    htsNumber: target.htsNumber,
    countryCode: target.countryCode,
    entryDate: target.entryDate,
    modeOfTransport: target.modeOfTransport,
    value: target.value,
    productName: target.productName,
    inputContext: target.inputContext || {},
    useMock: target.useMock,
    requireFormulaExtraction: target.requireFormulaExtraction,
    useAiExtraction: target.useAiExtraction,
    autoAnalyzeOnMismatch: target.autoAnalyzeOnMismatch,
    upsertLatest: true,
  };

  try {
    const response = await axios.post(
      `${config.baseUrl}/admin/external-provider-formulas/validate`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 180_000,
      },
    );
    const data = response.data?.data || {};
    const completedAt = new Date().toISOString();
    return {
      key: targetKey(target),
      chapter: target.chapter,
      htsNumber: target.htsNumber,
      countryCode: target.countryCode,
      startedAt,
      completedAt,
      status: 'SUCCESS',
      httpStatus: response.status,
      snapshotAction: data?.snapshotAction || null,
      isMatch: data?.comparison?.comparison?.isMatch === true,
      mismatchReason: data?.comparison?.comparison?.mismatchReason || null,
      formulaExtracted: data?.providerFetch?.formulaExtracted === true,
      extractionMethod: data?.providerFetch?.extractionMethod || null,
      extractionConfidence:
        typeof data?.providerFetch?.extractionConfidence === 'number'
          ? data.providerFetch.extractionConfidence
          : null,
      analysisProvider: data?.analysis?.provider || null,
      analysisSummary: data?.analysis?.summary || null,
    };
  } catch (error: any) {
    const completedAt = new Date().toISOString();
    const axiosError = error as AxiosError<any>;
    const status = axiosError.response?.status;
    return {
      key: targetKey(target),
      chapter: target.chapter,
      htsNumber: target.htsNumber,
      countryCode: target.countryCode,
      startedAt,
      completedAt,
      status: 'FAILED',
      httpStatus: status,
      errorMessage: axiosError.message || 'unknown error',
      errorPayload: axiosError.response?.data || null,
    };
  }
}

function isLikelyProviderBlockFailure(record: ValidationResultRecord): boolean {
  if (record.status !== 'FAILED') return false;
  const payloadText = JSON.stringify(record.errorPayload || {});
  const message = `${record.errorMessage || ''} ${payloadText}`.toLowerCase();
  return (
    message.includes('blocked automated access') ||
    message.includes('request blocked') ||
    message.includes('the request could not be satisfied') ||
    message.includes('cloudfront') ||
    message.includes('unusual traffic')
  );
}

async function appendResult(config: SweepConfig, record: ValidationResultRecord): Promise<void> {
  await fs.appendFile(config.outputFile, `${JSON.stringify(record)}\n`, 'utf8');
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  const runners = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await worker(items[current], current);
    }
  });

  await Promise.all(runners);
}

function createGlobalPacer(config: SweepConfig): () => Promise<number> {
  if (config.requestSpacingMs <= 0 && config.requestJitterMs <= 0) {
    return async () => 0;
  }

  let gate: Promise<void> = Promise.resolve();
  let nextAllowedAt = Date.now();

  return async () => {
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = gate;
    gate = current;
    await previous;

    const now = Date.now();
    const baseWait = Math.max(0, nextAllowedAt - now);
    const jitter =
      config.requestJitterMs > 0
        ? Math.floor(Math.random() * (config.requestJitterMs + 1))
        : 0;
    const waitMs = baseWait + jitter;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    nextAllowedAt = Date.now() + config.requestSpacingMs;
    release();
    return waitMs;
  };
}

function computeSummary(
  config: SweepConfig,
  startedAt: string,
  chapters: string[],
  targets: ValidationTarget[],
  skippedFromResume: number,
  results: ValidationResultRecord[],
  missingChapterCodes: Array<{ chapter: string; found: number; needed: number }>,
): SweepSummary {
  const success = results.filter((record) => record.status === 'SUCCESS').length;
  const failed = results.filter((record) => record.status === 'FAILED').length;
  const matches = results.filter((record) => record.status === 'SUCCESS' && record.isMatch === true).length;
  const mismatches = results.filter(
    (record) => record.status === 'SUCCESS' && record.isMatch === false,
  ).length;
  const extractedFormulaSuccess = results.filter(
    (record) => record.status === 'SUCCESS' && record.formulaExtracted === true,
  ).length;
  const analysisGenerated = results.filter(
    (record) => record.status === 'SUCCESS' && !!record.analysisSummary,
  ).length;

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    provider: config.provider,
    countries: config.countries,
    chapterRange: `${String(config.chapterStart).padStart(2, '0')}-${String(config.chapterEnd).padStart(2, '0')}`,
    excludedChapters: Array.from(config.excludedChapters.values()).sort((a, b) => a - b),
    codesPerChapter: config.codesPerChapter,
    expectedTargets: chapters.length * config.codesPerChapter * config.countries.length,
    plannedTargets: targets.length + skippedFromResume,
    skippedFromResume,
    executedTargets: targets.length,
    success,
    failed,
    matches,
    mismatches,
    extractedFormulaSuccess,
    analysisGenerated,
    missingChapterCodes,
    planOnly: config.planOnly,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const startedAt = new Date().toISOString();
  await ensureOutputDirectories(config);
  const completedKeys = await loadCompletedKeys(config);

  log(`Using provider=${config.provider}, countries=${config.countries.join(',')}`);
  log(`Chapter range ${config.chapterStart}-${config.chapterEnd}, excluded=${Array.from(config.excludedChapters).join(',') || 'none'}`);
  log(`DB source: ${config.dbHost}:${config.dbPort}/${config.dbName}`);
  log(
    `Pacing spacing=${config.requestSpacingMs}ms jitter<=${config.requestJitterMs}ms ai_extraction=${config.useAiExtraction ? 'on' : 'off'}`,
  );
  log(
    `Block retry attempts=${config.blockedRetryAttempts} base_delay=${config.blockedRetryDelayMs}ms backoff_step=${config.blockedRetryBackoffMs}ms`,
  );
  log(
    `Resume mode=${config.resume ? 'on' : 'off'} skip=${config.resumeOnlySuccess ? 'success-only' : 'all-recorded'}`,
  );

  const chapters = buildChapterList(config);
  const chapterCodes = await fetchChapterCodes(config, chapters);
  const chapterCodeMap = new Map<string, ChapterCode[]>();
  for (const chapter of chapters) {
    chapterCodeMap.set(chapter, []);
  }
  for (const code of chapterCodes) {
    if (!chapterCodeMap.has(code.chapter)) {
      chapterCodeMap.set(code.chapter, []);
    }
    chapterCodeMap.get(code.chapter)!.push(code);
  }

  const missingChapterCodes: Array<{ chapter: string; found: number; needed: number }> = [];
  for (const chapter of chapters) {
    const found = chapterCodeMap.get(chapter)?.length || 0;
    if (found < config.codesPerChapter) {
      missingChapterCodes.push({
        chapter,
        found,
        needed: config.codesPerChapter,
      });
    }
  }

  if (missingChapterCodes.length > 0) {
    log(
      `Chapter coverage gaps detected (${missingChapterCodes.length} chapters): ${missingChapterCodes
        .slice(0, 12)
        .map((item) => `${item.chapter}[${item.found}/${item.needed}]`)
        .join(', ')}${missingChapterCodes.length > 12 ? ', ...' : ''}`,
    );
    if (config.failOnChapterGap) {
      throw new Error(
        `Chapter coverage incomplete. Missing required codes in ${missingChapterCodes.length} chapter(s).`,
      );
    }
  }

  let targets: ValidationTarget[] = [];
  for (const chapter of chapters) {
    const codes = (chapterCodeMap.get(chapter) || []).slice(0, config.codesPerChapter);
    for (const code of codes) {
      for (const countryCode of config.countries) {
        targets.push({
          provider: config.provider,
          chapter,
          htsNumber: code.htsNumber,
          countryCode,
          entryDate: config.entryDate,
          modeOfTransport: config.modeOfTransport,
          value: config.value,
          productName: config.productName,
          inputContext: config.inputContext,
          useMock: config.useMock,
          requireFormulaExtraction: config.requireFormulaExtraction,
          useAiExtraction: config.useAiExtraction,
          autoAnalyzeOnMismatch: config.autoAnalyzeOnMismatch,
        });
      }
    }
  }

  if (typeof config.maxTargets === 'number' && config.maxTargets > 0) {
    targets = targets.slice(0, config.maxTargets);
  }

  if (config.targetsFile) {
    await fs.writeFile(config.targetsFile, JSON.stringify(targets, null, 2), 'utf8');
    log(`Target list written: ${config.targetsFile}`);
  }

  const filteredTargets = targets.filter((target) => !completedKeys.has(targetKey(target)));
  const skippedFromResume = targets.length - filteredTargets.length;
  targets = filteredTargets;

  log(`Planned targets=${targets.length + skippedFromResume}, skipped_from_resume=${skippedFromResume}, to_execute=${targets.length}`);
  if (targets.length === 0) {
    log('No targets to execute. Exiting.');
    return;
  }

  if (config.planOnly) {
    const summary = computeSummary(
      config,
      startedAt,
      chapters,
      targets,
      skippedFromResume,
      [],
      missingChapterCodes,
    );
    await fs.writeFile(config.summaryFile, JSON.stringify(summary, null, 2), 'utf8');
    log(`Plan-only mode. Summary written: ${config.summaryFile}`);
    return;
  }

  const token = await login(config);
  log('Authenticated admin session.');
  const pace = createGlobalPacer(config);

  const results: ValidationResultRecord[] = [];
  await runWithConcurrency(targets, config.concurrency, async (target, index) => {
    const label = `${index + 1}/${targets.length} ${target.chapter}:${target.htsNumber}:${target.countryCode}`;
    const waitMs = await pace();
    if (waitMs > 0) {
      log(`PACE ${label} waited=${waitMs}ms`);
    }
    log(`VALIDATE ${label}`);
    let result = await validateTarget(config, token, target);

    for (
      let retry = 1;
      retry <= config.blockedRetryAttempts && isLikelyProviderBlockFailure(result);
      retry += 1
    ) {
      const retryWaitMs =
        config.blockedRetryDelayMs + (retry - 1) * config.blockedRetryBackoffMs;
      if (retryWaitMs > 0) {
        log(`BLOCKED ${label} retry=${retry}/${config.blockedRetryAttempts} wait=${retryWaitMs}ms`);
        await sleep(retryWaitMs);
      } else {
        log(`BLOCKED ${label} retry=${retry}/${config.blockedRetryAttempts}`);
      }
      result = await validateTarget(config, token, target);
    }

    results.push(result);
    await appendResult(config, result);

    if (result.status === 'SUCCESS') {
      log(
        `DONE ${label} status=SUCCESS match=${result.isMatch ? 'Y' : 'N'} extracted=${result.formulaExtracted ? 'Y' : 'N'} method=${result.extractionMethod || '-'}`,
      );
    } else {
      log(
        `DONE ${label} status=FAILED http=${result.httpStatus || '-'} error=${result.errorMessage || 'unknown'}`,
      );
    }
  });

  const summary = computeSummary(
    config,
    startedAt,
    chapters,
    targets,
    skippedFromResume,
    results,
    missingChapterCodes,
  );
  await fs.writeFile(config.summaryFile, JSON.stringify(summary, null, 2), 'utf8');
  log(`Summary written: ${config.summaryFile}`);
  log(
    `Completed success=${summary.success} failed=${summary.failed} matches=${summary.matches} mismatches=${summary.mismatches}`,
  );

  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[chapter-sweep] Fatal error:', error);
  process.exit(1);
});
