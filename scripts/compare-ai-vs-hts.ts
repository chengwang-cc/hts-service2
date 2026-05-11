/**
 * compare-ai-vs-hts.ts
 *
 * Compares tariff calculation results between:
 *   - ai-service: POST /v2/tariff/rates  (TARIFF_FORMULAS_API_URL)
 *   - hts-service: POST /calculator/calculate  (HTS_SERVICE_URL, defaults to localhost:3100)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/compare-ai-vs-hts.ts
 *
 * Env vars (read from .env / .env.local):
 *   TARIFF_FORMULAS_API_URL   e.g. https://staging.api.report.chitchats.com/v2/tariff
 *   TARIFF_FORMULAS_API_KEY   X-API-Key for ai-service
 *   HTS_SERVICE_URL           defaults to http://localhost:3100/calculator/calculate
 *   HTS_SERVICE_API_KEY       API key for hts-service public endpoint (optional; falls back to direct endpoint)
 *   COMPARE_CONCURRENCY       parallel requests (default 5)
 *   COMPARE_OUTPUT_DIR        where to write reports (default ./docs/reports)
 */

import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { createHash, randomUUID } from 'crypto';
import { Pool } from 'pg';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AI_BASE_URL = (process.env.TARIFF_FORMULAS_API_URL ?? 'https://staging.api.report.chitchats.com/v2/tariff').replace(/\/$/, '');
const AI_API_KEY = process.env.TARIFF_FORMULAS_API_KEY ?? '';

const HTS_CALC_URL = process.env.HTS_SERVICE_URL ?? 'http://localhost:3100/calculator/calculate';
const HTS_PUBLIC_URL = 'http://localhost:3100/api/v1/calculator/calculate';

const CONCURRENCY = Math.max(1, Number(process.env.COMPARE_CONCURRENCY ?? '5'));
const OUTPUT_DIR = process.env.COMPARE_OUTPUT_DIR ?? join(process.cwd(), 'docs', 'reports');

const TOLERANCE = 0.02; // USD — amounts within this are considered "match"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCase {
  id: string;
  description: string;
  htsNumber: string;
  countryOfOrigin: string;
  declaredValue: number;
  weightKg?: number;
  quantity?: number;
}

interface NormalizedResult {
  source: 'ai' | 'hts';
  baseDuty: number;
  additionalByType: Record<string, number>;
  totalAdditional: number;
  mpf: number | null;
  hmf: number | null;
  totalDuty: number;
  formulas: Record<string, string>;
  blocked: boolean;
  blockReason?: string | null;
  rawResponse?: unknown;
  error?: string;
}

type DiffStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'ERROR';

interface CaseResult {
  id: string;
  description: string;
  htsNumber: string;
  countryOfOrigin: string;
  declaredValue: number;
  weightKg?: number;
  quantity?: number;
  status: DiffStatus;
  ai: NormalizedResult | null;
  hts: NormalizedResult | null;
  baseDiff: number | null;
  totalDiff: number | null;
  perTypeDiffs: Record<string, { ai: number; hts: number; diff: number }>;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Formula evaluation (same sandbox as FormulaEvaluationService)
// ---------------------------------------------------------------------------

function safeEval(formula: string, value: number, weight: number, quantity: number): number {
  if (!formula || formula.trim() === '0') return 0;
  // Only allow safe characters
  if (!/^[\d\s+\-*/().a-z_]+$/i.test(formula)) return 0;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('value', 'weight', 'quantity', `return (${formula});`);
    const result = Number(fn(value, weight, quantity));
    return Number.isFinite(result) ? Math.round(result * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// AI-service call
// ---------------------------------------------------------------------------

async function callAiService(tc: TestCase): Promise<NormalizedResult> {
  const url = `${AI_BASE_URL}/rates`;
  const body = [
    {
      htsCode: tc.htsNumber,
      country: tc.countryOfOrigin,
      inputs: {
        value: tc.declaredValue,
        weight: tc.weightKg ?? 0,
        quantity: tc.quantity ?? 0,
      },
    },
  ];

  let raw: unknown;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': AI_API_KEY },
      body: JSON.stringify(body),
    });
    raw = await resp.json();
  } catch (err) {
    return { source: 'ai', baseDuty: 0, additionalByType: {}, totalAdditional: 0, mpf: null, hmf: null, totalDuty: 0, formulas: {}, blocked: false, error: String(err) };
  }

  const r = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!r) return { source: 'ai', baseDuty: 0, additionalByType: {}, totalAdditional: 0, mpf: null, hmf: null, totalDuty: 0, formulas: {}, blocked: false, error: 'empty response', rawResponse: raw };

  if (r['blocked']) {
    return { source: 'ai', baseDuty: 0, additionalByType: {}, totalAdditional: 0, mpf: null, hmf: null, totalDuty: 0, formulas: {}, blocked: true, blockReason: String(r['block_reason'] ?? ''), rawResponse: r };
  }

  const inputs = { value: tc.declaredValue, weight: tc.weightKg ?? 0, quantity: tc.quantity ?? 0 };
  const formulasArr = (r['formulas'] as Array<{ tariffType: string; formula: string }> | undefined) ?? [];

  const formulas: Record<string, string> = {};
  for (const f of formulasArr) formulas[f.tariffType] = f.formula;

  const baseFormula = formulas['base'] ?? '';
  const baseDuty = safeEval(baseFormula, inputs.value, inputs.weight, inputs.quantity);

  const additionalByType: Record<string, number> = {};
  let totalAdditional = 0;
  for (const f of formulasArr.filter((f) => f.tariffType !== 'base')) {
    const amt = safeEval(f.formula, inputs.value, inputs.weight, inputs.quantity);
    additionalByType[f.tariffType] = amt;
    totalAdditional += amt;
  }
  totalAdditional = Math.round(totalAdditional * 100) / 100;

  return {
    source: 'ai',
    baseDuty,
    additionalByType,
    totalAdditional,
    mpf: null, // ai-service does not compute MPF
    hmf: null,
    totalDuty: Math.round((baseDuty + totalAdditional) * 100) / 100,
    formulas,
    blocked: false,
    rawResponse: r,
  };
}

// ---------------------------------------------------------------------------
// HTS-service call
// ---------------------------------------------------------------------------

let htsApiKey: string | null = process.env.HTS_SERVICE_API_KEY ?? null;

async function ensureHtsApiKey(pool: Pool): Promise<string> {
  if (htsApiKey) return htsApiKey;

  const orgResult = await pool.query<{ id: string }>('SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1');
  if (!orgResult.rows.length) throw new Error('No organization found; run auth seed first');
  const organizationId = orgResult.rows[0].id;

  const plainTextKey = `hts_compare_${randomUUID().replace(/-/g, '')}`;
  const keyHash = createHash('sha256').update(plainTextKey).digest('hex');
  const keyPrefix = plainTextKey.slice(0, 20);

  await pool.query(
    `INSERT INTO api_keys (key_hash, key_prefix, name, description, organization_id, environment, permissions, rate_limit_per_minute, rate_limit_per_day, is_active, expires_at, last_used_at, ip_whitelist, allowed_origins, metadata, created_by)
     VALUES ($1, $2, 'Compare Harness', 'AI vs HTS comparison harness', $3, 'test', $4::jsonb, 200000, 5000000, true, NULL, NULL, NULL, NULL, $5::jsonb, NULL)
     ON CONFLICT (key_hash) DO UPDATE SET is_active = true, rate_limit_per_minute = EXCLUDED.rate_limit_per_minute, rate_limit_per_day = EXCLUDED.rate_limit_per_day, updated_at = now()`,
    [keyHash, keyPrefix, organizationId, JSON.stringify(['hts:calculate']), JSON.stringify({ source: 'compare-ai-vs-hts', createdAt: new Date().toISOString() })],
  );

  htsApiKey = plainTextKey;
  return plainTextKey;
}

async function callHtsService(tc: TestCase, apiKey: string): Promise<NormalizedResult> {
  const body = {
    htsNumber: tc.htsNumber,
    countryOfOrigin: tc.countryOfOrigin,
    declaredValue: tc.declaredValue,
    weightKg: tc.weightKg,
    quantity: tc.quantity,
    tradeAgreementCertificate: false,
  };

  let raw: unknown;
  try {
    const resp = await fetch(HTS_PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    });
    raw = await resp.json();
  } catch (err) {
    return { source: 'hts', baseDuty: 0, additionalByType: {}, totalAdditional: 0, mpf: null, hmf: null, totalDuty: 0, formulas: {}, blocked: false, error: String(err) };
  }

  const envelope = raw as { success?: boolean; data?: Record<string, unknown>; message?: unknown };
  if (!envelope?.success || !envelope.data) {
    return { source: 'hts', baseDuty: 0, additionalByType: {}, totalAdditional: 0, mpf: null, hmf: null, totalDuty: 0, formulas: {}, blocked: false, error: JSON.stringify(raw).slice(0, 400), rawResponse: raw };
  }

  const d = envelope.data;

  const additionalByType: Record<string, number> = {};
  const additionalItems = (d['breakdown'] as { additionalTariffs?: Array<{ type: string; amount: number }> } | undefined)?.additionalTariffs ?? [];
  for (const item of additionalItems) {
    additionalByType[normalizeTypeName(item.type)] = item.amount;
  }

  const taxItems = (d['breakdown'] as { taxes?: Array<{ type: string; amount: number }> } | undefined)?.taxes ?? [];
  let mpf: number | null = null;
  let hmf: number | null = null;
  for (const item of taxItems) {
    if (item.type === 'MPF') mpf = item.amount;
    if (item.type === 'HMF') hmf = item.amount;
  }

  const formulas: Record<string, string> = {};
  if (d['formulaUsed']) formulas['base'] = String(d['formulaUsed']);

  return {
    source: 'hts',
    baseDuty: Math.round(Number(d['baseDuty'] ?? 0) * 100) / 100,
    additionalByType,
    totalAdditional: Math.round(Number(d['additionalTariffs'] ?? 0) * 100) / 100,
    mpf,
    hmf,
    totalDuty: Math.round(Number(d['totalDuty'] ?? 0) * 100) / 100,
    formulas,
    blocked: false,
    rawResponse: d,
  };
}

// ---------------------------------------------------------------------------
// Type name normalization (map ai-service names → canonical names)
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, string> = {
  section_301: 'section_301',
  ieepa_tariff: 'ieepa',
  ieepa: 'ieepa',
  metal_tariff: 'section_232',
  static_metal_tariff: 'section_232',
  section_232: 'section_232',
  reciprocal: 'reciprocal',
  // hts-service names
  SECTION_301: 'section_301',
  IEEPA_CN: 'ieepa',
  IEEPA: 'ieepa',
  SECTION_232: 'section_232',
};

function normalizeTypeName(name: string): string {
  return TYPE_MAP[name] ?? name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function normalizeAdditionalByType(r: NormalizedResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.additionalByType)) {
    const norm = normalizeTypeName(k);
    out[norm] = (out[norm] ?? 0) + v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compareResults(tc: TestCase, ai: NormalizedResult, hts: NormalizedResult): CaseResult {
  const notes: string[] = [];

  if (ai.error) notes.push(`AI error: ${ai.error}`);
  if (hts.error) notes.push(`HTS error: ${hts.error}`);
  if (ai.blocked) notes.push(`AI: BLOCKED (${ai.blockReason})`);

  if (ai.error || hts.error) {
    return { id: tc.id, description: tc.description, htsNumber: tc.htsNumber, countryOfOrigin: tc.countryOfOrigin, declaredValue: tc.declaredValue, weightKg: tc.weightKg, quantity: tc.quantity, status: 'ERROR', ai, hts, baseDiff: null, totalDiff: null, perTypeDiffs: {}, notes };
  }

  const baseDiff = Math.round(Math.abs(ai.baseDuty - hts.baseDuty) * 100) / 100;
  const totalDiff = Math.round(Math.abs(ai.totalDuty - hts.totalDuty) * 100) / 100;

  const aiTypes = normalizeAdditionalByType(ai);
  const htsTypes = normalizeAdditionalByType(hts);
  const allTypes = new Set([...Object.keys(aiTypes), ...Object.keys(htsTypes)]);
  const perTypeDiffs: Record<string, { ai: number; hts: number; diff: number }> = {};
  for (const t of allTypes) {
    const a = aiTypes[t] ?? 0;
    const h = htsTypes[t] ?? 0;
    perTypeDiffs[t] = { ai: a, hts: h, diff: Math.round(Math.abs(a - h) * 100) / 100 };
  }

  // MPF/HMF: ai-service doesn't compute these, so exclude from total comparison
  // but document them
  if (hts.mpf !== null) notes.push(`HTS MPF: $${hts.mpf.toFixed(2)} (ai-service omits MPF)`);
  if (hts.hmf !== null) notes.push(`HTS HMF: $${hts.hmf.toFixed(2)} (ai-service omits HMF)`);

  let status: DiffStatus;
  if (baseDiff <= TOLERANCE && totalDiff <= TOLERANCE) {
    status = 'PASS';
  } else if (baseDiff <= TOLERANCE) {
    // base matches but additional tariffs differ
    status = 'PARTIAL';
    notes.push(`Base duty matches but totalDuty differs by $${totalDiff.toFixed(2)}`);
  } else {
    status = 'FAIL';
    notes.push(`Base duty differs by $${baseDiff.toFixed(2)} (ai=${ai.baseDuty}, hts=${hts.baseDuty})`);
  }

  return { id: tc.id, description: tc.description, htsNumber: tc.htsNumber, countryOfOrigin: tc.countryOfOrigin, declaredValue: tc.declaredValue, weightKg: tc.weightKg, quantity: tc.quantity, status, ai, hts, baseDiff, totalDiff, perTypeDiffs, notes };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function buildCsv(results: CaseResult[]): string {
  const header = [
    'id', 'description', 'htsNumber', 'country', 'declaredValue', 'status',
    'ai_baseDuty', 'hts_baseDuty', 'baseDiff',
    'ai_totalDuty', 'hts_totalDuty', 'totalDiff',
    'hts_mpf', 'hts_hmf',
    'ai_formulas', 'hts_formula',
    'notes',
  ];
  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of results) {
    lines.push([
      r.id, r.description, r.htsNumber, r.countryOfOrigin, r.declaredValue, r.status,
      r.ai?.baseDuty ?? '', r.hts?.baseDuty ?? '', r.baseDiff ?? '',
      r.ai?.totalDuty ?? '', r.hts?.totalDuty ?? '', r.totalDiff ?? '',
      r.hts?.mpf ?? '', r.hts?.hmf ?? '',
      JSON.stringify(r.ai?.formulas ?? {}),
      r.hts?.formulas['base'] ?? '',
      r.notes.join(' | '),
    ].map(esc).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function printTable(results: CaseResult[]): void {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const partial = results.filter((r) => r.status === 'PARTIAL').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const error = results.filter((r) => r.status === 'ERROR').length;

  console.log(`\n${'='.repeat(100)}`);
  console.log(`SUMMARY: ${pass} PASS | ${partial} PARTIAL | ${fail} FAIL | ${error} ERROR | ${results.length} total`);
  console.log('='.repeat(100));

  const nonPass = results.filter((r) => r.status !== 'PASS');
  if (nonPass.length === 0) {
    console.log('All test cases passed!');
    return;
  }

  console.log('\nNon-passing cases:\n');
  for (const r of nonPass) {
    console.log(`  [${r.status}] ${r.id}: ${r.description}`);
    console.log(`    HTS: ${r.htsNumber}  Country: ${r.countryOfOrigin}  Value: $${r.declaredValue}`);
    if (r.ai && r.hts) {
      console.log(`    BaseDuty:  AI=${r.ai.baseDuty.toFixed(2)}  HTS=${r.hts.baseDuty.toFixed(2)}  diff=${(r.baseDiff ?? 0).toFixed(2)}`);
      console.log(`    TotalDuty: AI=${r.ai.totalDuty.toFixed(2)}  HTS=${r.hts.totalDuty.toFixed(2)}  diff=${(r.totalDiff ?? 0).toFixed(2)}`);
      const typeDiffs = Object.entries(r.perTypeDiffs).filter(([, v]) => v.diff > TOLERANCE);
      if (typeDiffs.length > 0) {
        console.log('    Per-type diffs:');
        for (const [type, { ai: a, hts: h, diff: d }] of typeDiffs) {
          console.log(`      ${type}: AI=${a.toFixed(2)}  HTS=${h.toFixed(2)}  diff=${d.toFixed(2)}`);
        }
      }
      if (r.ai.formulas['base']) console.log(`    AI base formula:  ${r.ai.formulas['base']}`);
      if (r.hts.formulas['base']) console.log(`    HTS base formula: ${r.hts.formulas['base']}`);
    }
    for (const note of r.notes) console.log(`    NOTE: ${note}`);
    console.log('');
  }

  // Root cause summary
  const cats: Record<string, number> = {};
  for (const r of nonPass) {
    if (r.status === 'ERROR') { cats['ERROR'] = (cats['ERROR'] ?? 0) + 1; continue; }
    if ((r.baseDiff ?? 0) > TOLERANCE) { cats['CAT-1 (base formula)'] = (cats['CAT-1 (base formula)'] ?? 0) + 1; }
    const additionalDiff = Object.values(r.perTypeDiffs).some((v) => v.diff > TOLERANCE);
    if (additionalDiff) { cats['CAT-2 (additional tariff)'] = (cats['CAT-2 (additional tariff)'] ?? 0) + 1; }
    if (r.hts?.mpf !== null) { cats['CAT-3 (MPF/HMF - by design)'] = (cats['CAT-3 (MPF/HMF - by design)'] ?? 0) + 1; }
  }
  console.log('Root cause summary:');
  for (const [cat, count] of Object.entries(cats)) {
    console.log(`  ${cat}: ${count}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const testCasesPath = resolve(process.cwd(), 'scripts', 'compare-test-cases.json');
  const testCases: TestCase[] = (await import(testCasesPath)).default ?? require(testCasesPath);

  console.log(`Loaded ${testCases.length} test cases`);
  console.log(`AI-service:  ${AI_BASE_URL}/rates`);
  console.log(`HTS-service: ${HTS_PUBLIC_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  // Try to get HTS API key from DB; if DB not available, try direct endpoint
  let pool: Pool | null = null;
  let apiKey: string;
  try {
    pool = new Pool({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      database: process.env.DB_DATABASE ?? 'hts',
    });
    apiKey = await ensureHtsApiKey(pool);
    console.log(`HTS API key provisioned: ${apiKey.slice(0, 20)}...`);
  } catch (err) {
    console.warn(`Could not provision HTS API key from DB (${String(err)}). Falling back to direct endpoint.`);
    // Swap to the public direct endpoint (no auth required)
    (globalThis as Record<string, unknown>)['HTS_PUBLIC_URL_OVERRIDE'] = HTS_CALC_URL;
    apiKey = '';
    pool = null;
  }

  const results: CaseResult[] = new Array(testCases.length);
  let cursor = 0;

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= testCases.length) break;
      const tc = testCases[idx];
      process.stdout.write(`[${idx + 1}/${testCases.length}] ${tc.id} ${tc.description}... `);

      const [ai, hts] = await Promise.all([
        callAiService(tc),
        callHtsService(tc, apiKey),
      ]);
      const result = compareResults(tc, ai, hts);
      results[idx] = result;
      console.log(result.status);
    }
  });

  await Promise.all(workers);

  if (pool) await pool.end();

  printTable(results);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(OUTPUT_DIR, { recursive: true });

  const csvPath = join(OUTPUT_DIR, `ai-vs-hts-${ts}.csv`);
  const jsonPath = join(OUTPUT_DIR, `ai-vs-hts-${ts}.json`);

  await writeFile(csvPath, buildCsv(results), 'utf-8');
  await writeFile(jsonPath, JSON.stringify(results, null, 2) + '\n', 'utf-8');

  console.log(`\nCSV report: ${csvPath}`);
  console.log(`JSON report: ${jsonPath}`);

  const hasFailures = results.some((r) => r.status === 'FAIL' || r.status === 'ERROR');
  process.exit(hasFailures ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
