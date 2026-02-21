import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import { Pool } from 'pg';
import { FormulaGenerationService } from '@hts/core';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

type HistoryRow = {
  id: string;
  hts8: string;
  brief_description: string;
  quantity1_code: string | null;
  quantity2_code: string | null;
  mfn_text_rate: string | null;
  mfn_ad_val_rate: string | null;
  mfn_specific_rate: string | null;
  mfn_other_rate: string | null;
  begin_effect_date: string;
  end_effective_date: string;
};

type ApiResultRow = {
  rowId: string;
  hts8: string;
  apiHtsNumber: string | null;
  apiRateSource: string | null;
  apiFormulaUsed: string | null;
  status: string;
  httpStatus: number | null;
  apiMessage: string | null;
  expected2025BaseDuty: number | null;
  api2026BaseDuty: number | null;
  delta: number | null;
  absDelta: number | null;
  pctDelta: number | null;
  quantity1Code: string | null;
  quantity2Code: string | null;
  mfnTextRate: string | null;
  beginEffectDate: string;
  endEffectiveDate: string;
};

type ApiEnvelope = {
  success?: boolean;
  data?: {
    baseDuty?: number;
    formulaUsed?: string;
    rateSource?: string;
    confidence?: number;
  };
  message?: string | string[];
  error?: string;
};

type IntentionalUnresolvedReason =
  | 'CH98_99_NO_RATE_TEXT'
  | 'CH98_99_LEGAL_REFERENCE_RATE';

const API_BASE_URL = process.env.DISCREPANCY_API_BASE_URL || 'http://localhost:3100';
const API_PATH = '/api/v1/calculator/calculate';
const COUNTRY = process.env.DISCREPANCY_COUNTRY || 'CN';
const DECLARED_VALUE = Number(process.env.DISCREPANCY_DECLARED_VALUE || '100');
const QUANTITY = Number(process.env.DISCREPANCY_QUANTITY || '1');
const WEIGHT_KG = Number(process.env.DISCREPANCY_WEIGHT_KG || '1');
const ENTRY_DATE = process.env.DISCREPANCY_ENTRY_DATE || '2025-12-31';
const CONCURRENCY = Math.max(1, Number(process.env.DISCREPANCY_CONCURRENCY || '12'));
const OUTPUT_DIR = process.env.DISCREPANCY_OUTPUT_DIR || join(process.cwd(), 'docs', 'reports');
const formulaGenerationService = new FormulaGenerationService({
  response: async () => {
    throw new Error('AI formula generation is disabled in discrepancy harness');
  },
} as any);

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  // USITC tariff data uses 9999.999999 sentinel values for "not applicable".
  if (parsed >= 9999) return null;
  return parsed;
}

function isWeightUnit(unitCode: string | null): boolean {
  if (!unitCode) return false;
  const code = unitCode.trim().toUpperCase();
  return (
    code === 'KG' ||
    code === 'G' ||
    code === 'GM' ||
    code === 'CGM' ||
    code === 'CKG' ||
    code === 'T'
  );
}

function getUnitBase(unitCode: string | null): number {
  return isWeightUnit(unitCode) ? WEIGHT_KG : QUANTITY;
}

function evaluateFormula(formula: string, quantity1Code: string | null): number | null {
  if (!/^[\d\s+\-*/().a-z_]+$/i.test(formula)) {
    return null;
  }

  try {
    const fn = new Function('value', 'weight', 'quantity', `return (${formula});`);
    const value = Number(
      fn(
        DECLARED_VALUE,
        WEIGHT_KG,
        getUnitBase(quantity1Code),
      ),
    );
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function computeExpected2025BaseDuty(row: HistoryRow): number | null {
  const adValRateRaw = toNumber(row.mfn_ad_val_rate);
  const specificRateRaw = toNumber(row.mfn_specific_rate);
  const otherRateRaw = toNumber(row.mfn_other_rate);
  const adValRate = adValRateRaw ?? 0;
  const specificRate = specificRateRaw ?? 0;
  const otherRate = otherRateRaw ?? 0;

  // mfn_ad_val_rate is already normalized (e.g., 10% is stored as 0.10).
  const adValComponent = DECLARED_VALUE * adValRate;
  const specificComponent = getUnitBase(row.quantity1_code) * specificRate;
  const otherComponent = getUnitBase(row.quantity2_code || row.quantity1_code) * otherRate;

  let raw = adValComponent + specificComponent + otherComponent;
  const hasStructuredComponents =
    adValRateRaw !== null || specificRateRaw !== null || otherRateRaw !== null;

  // Fallback: some historical rows have valid mfn_text_rate but numeric component columns are null/sentinel.
  if (!hasStructuredComponents && row.mfn_text_rate && row.mfn_text_rate.trim()) {
    const parsed = formulaGenerationService.generateFormulaByPattern(
      row.mfn_text_rate,
      row.quantity1_code || undefined,
    );
    if (parsed) {
      const evaluated = evaluateFormula(parsed.formula, row.quantity1_code);
      if (evaluated !== null) {
        raw = evaluated;
      } else {
        return null;
      }
    } else {
      return null;
    }
  } else if (!hasStructuredComponents) {
    return null;
  }

  return Math.round(raw * 100) / 100;
}

function buildCsv(rows: ApiResultRow[]): string {
  const header = [
    'row_id',
    'hts8',
    'api_hts_number',
    'api_rate_source',
    'api_formula_used',
    'status',
    'http_status',
    'api_message',
    'expected_2025_base_duty',
    'api_2026_base_duty',
    'delta',
    'abs_delta',
    'pct_delta',
    'quantity1_code',
    'quantity2_code',
    'mfn_text_rate',
    'begin_effect_date',
    'end_effective_date',
  ];

  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (text.includes('"') || text.includes(',') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.rowId,
        row.hts8,
        row.apiHtsNumber,
        row.apiRateSource,
        row.apiFormulaUsed,
        row.status,
        row.httpStatus,
        row.apiMessage,
        row.expected2025BaseDuty,
        row.api2026BaseDuty,
        row.delta,
        row.absDelta,
        row.pctDelta,
        row.quantity1Code,
        row.quantity2Code,
        row.mfnTextRate,
        row.beginEffectDate,
        row.endEffectiveDate,
      ]
        .map(escape)
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}

async function ensureApiKey(pool: Pool): Promise<string> {
  const organizationQuery = await pool.query<{ id: string }>(
    'SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1',
  );
  if (!organizationQuery.rows.length) {
    throw new Error('No organization found; run auth seed first');
  }

  const organizationId = organizationQuery.rows[0].id;
  const plainTextKey =
    process.env.DISCREPANCY_API_KEY || `hts_test_discrepancy_${randomUUID().replace(/-/g, '')}`;
  const keyHash = createHash('sha256').update(plainTextKey).digest('hex');
  const keyPrefix = plainTextKey.slice(0, 20);

  await pool.query(
    `
    INSERT INTO api_keys (
      key_hash, key_prefix, name, description, organization_id, environment,
      permissions, rate_limit_per_minute, rate_limit_per_day, is_active,
      expires_at, last_used_at, ip_whitelist, allowed_origins, metadata, created_by
    )
    VALUES (
      $1, $2, 'Tariff 2025 vs 2026 Harness', 'Bulk discrepancy validation harness', $3, 'test',
      $4::jsonb, 200000, 5000000, true,
      NULL, NULL, NULL, NULL, $5::jsonb, NULL
    )
    ON CONFLICT (key_hash) DO UPDATE
      SET is_active = true,
          permissions = EXCLUDED.permissions,
          rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
          rate_limit_per_day = EXCLUDED.rate_limit_per_day,
          metadata = EXCLUDED.metadata,
          updated_at = now()
    `,
    [
      keyHash,
      keyPrefix,
      organizationId,
      JSON.stringify(['hts:calculate']),
      JSON.stringify({
        source: 'tariff-history-2025-api-discrepancy',
        updatedAt: new Date().toISOString(),
      }),
    ],
  );

  return plainTextKey;
}

async function loadRows(pool: Pool): Promise<HistoryRow[]> {
  const result = await pool.query<HistoryRow>(
    `
    SELECT
      id,
      hts8,
      brief_description,
      quantity1_code,
      quantity2_code,
      mfn_text_rate,
      mfn_ad_val_rate::text,
      mfn_specific_rate::text,
      mfn_other_rate::text,
      begin_effect_date::text,
      end_effective_date::text
    FROM hts_tariff_history_2025
    ORDER BY hts8, begin_effect_date, end_effective_date, id
    `,
  );
  return result.rows;
}

async function load2026CodeMap(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query<{ hts8: string; hts_number: string }>(
    `
    SELECT DISTINCT ON (hts8) hts8, hts_number
    FROM (
      SELECT
        LEFT(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g'), 8) AS hts8,
        hts_number,
        CASE WHEN COALESCE(NULLIF(BTRIM(rate_formula), ''), '') <> '' THEN 0 ELSE 1 END AS formula_rank,
        CASE WHEN COALESCE(NULLIF(BTRIM(general_rate), ''), '') <> '' THEN 0 ELSE 1 END AS rate_text_rank,
        CASE
          WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 10 THEN 0
          WHEN LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) = 8 THEN 1
          ELSE 2
        END AS specificity_rank,
        LENGTH(REGEXP_REPLACE(hts_number, '[^0-9]', '', 'g')) AS code_len
      FROM hts
      WHERE is_active = true
    ) ranked
    WHERE hts8 IS NOT NULL
      AND LENGTH(hts8) = 8
    ORDER BY hts8, formula_rank, rate_text_rank, specificity_rank, code_len DESC, hts_number
    `,
  );

  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.hts8, row.hts_number);
  }
  return map;
}

async function loadHistoryBridgeMap(pool: Pool): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const result = await pool.query<{ hts8: string; mapped_2026_hts_number: string | null }>(
      `
      SELECT hts8, mapped_2026_hts_number
      FROM hts_tariff_history_2025_code_bridge
      WHERE source_year = 2025
        AND bridge_status = 'MAPPED'
        AND mapped_2026_hts_number IS NOT NULL
      `,
    );

    for (const row of result.rows) {
      if (!map.has(row.hts8) && row.mapped_2026_hts_number) {
        map.set(row.hts8, row.mapped_2026_hts_number);
      }
    }
  } catch {
    // Bridge table may not exist yet; keep compatibility.
  }
  return map;
}

async function loadIntentionalUnresolvedMap(
  pool: Pool,
): Promise<Map<string, IntentionalUnresolvedReason>> {
  const result = await pool.query<{
    hts_number: string;
    unresolved_reason: IntentionalUnresolvedReason;
  }>(
    `
    WITH base AS (
      SELECT
        hts_number,
        chapter,
        COALESCE(
          NULLIF(BTRIM(general_rate), ''),
          NULLIF(BTRIM(general), ''),
          NULLIF(BTRIM(metadata->'stagedNormalized'->>'generalRate'), '')
        ) AS resolved_rate_text
      FROM hts
      WHERE is_active = true
        AND chapter IN ('98', '99')
    )
    SELECT
      base.hts_number,
      CASE
        WHEN base.resolved_rate_text IS NULL THEN 'CH98_99_NO_RATE_TEXT'
        ELSE 'CH98_99_LEGAL_REFERENCE_RATE'
      END AS unresolved_reason
    FROM base
    WHERE NOT EXISTS (
      SELECT 1
      FROM hts_formula_updates f
      WHERE f.active = true
        AND f.formula_type = 'GENERAL'
        AND (f.country_code = 'ALL' OR f.country_code = $1)
        AND f.hts_number = base.hts_number
    )
      AND (
        base.resolved_rate_text IS NULL
        OR base.resolved_rate_text ~* '(see|note|applicable subheading|provided in such subheading|rate applicable|duty equal|under bond|in lieu|drawback|except as provided|no change|rate of duty applicable)'
      )
    `,
    [COUNTRY.toUpperCase()],
  );

  const map = new Map<string, IntentionalUnresolvedReason>();
  for (const row of result.rows) {
    map.set(row.hts_number, row.unresolved_reason);
  }
  return map;
}

function isLegacyChapter99Placeholder(row: HistoryRow): boolean {
  return row.hts8.startsWith('99') && (!row.mfn_text_rate || row.mfn_text_rate.trim() === '');
}

async function callCalculator(
  apiKey: string,
  htsNumber: string,
  entryDate: string,
): Promise<{ ok: boolean; status: number; body: ApiEnvelope | null }> {
  const response = await fetch(`${API_BASE_URL}${API_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      htsNumber,
      countryOfOrigin: COUNTRY,
      declaredValue: DECLARED_VALUE,
      quantity: QUANTITY,
      quantityUnit: 'NO',
      weightKg: WEIGHT_KG,
      entryDate,
      tradeAgreementCertificate: false,
      additionalInputs: {
        importType: 'commercial',
      },
    }),
  });

  const text = await response.text();
  let body: ApiEnvelope | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as ApiEnvelope;
    } catch {
      body = {
        message: text.slice(0, 400),
      };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function extractApiMessage(body: ApiEnvelope | null): string | null {
  if (!body) return null;
  if (Array.isArray(body.message)) return body.message.join('; ');
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  return null;
}

function parseDateOnly(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function toDateOnlyText(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveEntryDateForRow(row: HistoryRow): string {
  const defaultDate = parseDateOnly(ENTRY_DATE);
  const beginDate = parseDateOnly(row.begin_effect_date);
  const endDate = parseDateOnly(row.end_effective_date);

  if (!defaultDate || !beginDate || !endDate) {
    return ENTRY_DATE;
  }

  if (defaultDate < beginDate) {
    return toDateOnlyText(beginDate);
  }

  if (defaultDate > endDate) {
    return toDateOnlyText(endDate);
  }

  return toDateOnlyText(defaultDate);
}

async function run(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'hts',
  });

  const startedAt = Date.now();
  try {
    const apiKey = await ensureApiKey(pool);
    const historyRows = await loadRows(pool);
    const codeMap = await load2026CodeMap(pool);
    const bridgeMap = await loadHistoryBridgeMap(pool);
    const intentionalUnresolvedMap = await loadIntentionalUnresolvedMap(pool);
    for (const [hts8, mappedHts] of bridgeMap) {
      if (!codeMap.has(hts8)) {
        codeMap.set(hts8, mappedHts);
      }
    }

    const results: ApiResultRow[] = new Array(historyRows.length);
    let cursor = 0;
    let processed = 0;

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= historyRows.length) break;

        const row = historyRows[index];
        const apiHtsNumber = codeMap.get(row.hts8) || null;
        const expected = computeExpected2025BaseDuty(row);

        if (!apiHtsNumber) {
          const isLegacy99 = isLegacyChapter99Placeholder(row);
          results[index] = {
            rowId: row.id,
            hts8: row.hts8,
            apiHtsNumber: null,
            status: isLegacy99 ? 'legacy_ch99_placeholder' : 'no_2026_match',
            httpStatus: null,
            apiMessage: isLegacy99
              ? 'Legacy Chapter 99 placeholder with no direct 2026 active equivalent'
              : 'No active 2026 HTS match for this HTS8',
            apiRateSource: null,
            apiFormulaUsed: null,
            expected2025BaseDuty: expected,
            api2026BaseDuty: null,
            delta: null,
            absDelta: null,
            pctDelta: null,
            quantity1Code: row.quantity1_code,
            quantity2Code: row.quantity2_code,
            mfnTextRate: row.mfn_text_rate,
            beginEffectDate: row.begin_effect_date,
            endEffectiveDate: row.end_effective_date,
          };
          processed++;
          continue;
        }

        const unresolvedReason = intentionalUnresolvedMap.get(apiHtsNumber);
        if (unresolvedReason) {
          results[index] = {
            rowId: row.id,
            hts8: row.hts8,
            apiHtsNumber,
            status: 'intentional_unresolved',
            httpStatus: null,
            apiMessage:
              unresolvedReason === 'CH98_99_NO_RATE_TEXT'
                ? 'Intentional unresolved: Chapter 98/99 heading has no computable standalone rate text'
                : 'Intentional unresolved: Chapter 98/99 heading references legal/applicable-subheading context',
            apiRateSource: null,
            apiFormulaUsed: null,
            expected2025BaseDuty: expected,
            api2026BaseDuty: null,
            delta: null,
            absDelta: null,
            pctDelta: null,
            quantity1Code: row.quantity1_code,
            quantity2Code: row.quantity2_code,
            mfnTextRate: row.mfn_text_rate,
            beginEffectDate: row.begin_effect_date,
            endEffectiveDate: row.end_effective_date,
          };
          processed++;
          continue;
        }

        try {
          const rowEntryDate = resolveEntryDateForRow(row);
          const api = await callCalculator(apiKey, apiHtsNumber, rowEntryDate);
          const message = extractApiMessage(api.body);

          if (!api.ok || !api.body?.success || typeof api.body?.data?.baseDuty !== 'number') {
            results[index] = {
              rowId: row.id,
              hts8: row.hts8,
              apiHtsNumber,
              status: `api_error_${api.status}`,
              httpStatus: api.status,
              apiMessage: message,
              apiRateSource: null,
              apiFormulaUsed: null,
              expected2025BaseDuty: expected,
              api2026BaseDuty: null,
              delta: null,
              absDelta: null,
              pctDelta: null,
              quantity1Code: row.quantity1_code,
              quantity2Code: row.quantity2_code,
              mfnTextRate: row.mfn_text_rate,
              beginEffectDate: row.begin_effect_date,
              endEffectiveDate: row.end_effective_date,
            };
          } else {
            const actual = Math.round(Number(api.body.data.baseDuty) * 100) / 100;
            let delta: number | null = null;
            let absDelta: number | null = null;
            let pctDelta: number | null = null;
            let status = 'match';

            if (expected === null) {
              status = 'expected_unresolved';
            } else {
              delta = Math.round((actual - expected) * 100) / 100;
              absDelta = Math.round(Math.abs(delta) * 100) / 100;
              pctDelta =
                expected === 0
                  ? actual === 0
                    ? 0
                    : null
                  : Math.round(((delta / expected) * 100) * 100) / 100;

              if (absDelta > 0.01 && absDelta <= 0.1) status = 'near_match';
              if (absDelta > 0.1) status = 'mismatch';
            }

            results[index] = {
              rowId: row.id,
              hts8: row.hts8,
              apiHtsNumber,
              status,
              httpStatus: api.status,
              apiMessage: message,
              apiRateSource: api.body.data.rateSource || null,
              apiFormulaUsed: api.body.data.formulaUsed || null,
              expected2025BaseDuty: expected,
              api2026BaseDuty: actual,
              delta,
              absDelta,
              pctDelta,
              quantity1Code: row.quantity1_code,
              quantity2Code: row.quantity2_code,
              mfnTextRate: row.mfn_text_rate,
              beginEffectDate: row.begin_effect_date,
              endEffectiveDate: row.end_effective_date,
            };
          }
        } catch (error) {
          results[index] = {
            rowId: row.id,
            hts8: row.hts8,
            apiHtsNumber,
            status: 'request_error',
            httpStatus: null,
            apiMessage: (error as Error).message,
            apiRateSource: null,
            apiFormulaUsed: null,
            expected2025BaseDuty: expected,
            api2026BaseDuty: null,
            delta: null,
            absDelta: null,
            pctDelta: null,
            quantity1Code: row.quantity1_code,
            quantity2Code: row.quantity2_code,
            mfnTextRate: row.mfn_text_rate,
            beginEffectDate: row.begin_effect_date,
            endEffectiveDate: row.end_effective_date,
          };
        }

        processed++;
        if (processed % 500 === 0) {
          const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.log(`Processed ${processed}/${historyRows.length} rows (${elapsedSec}s)`);
        }
      }
    });

    await Promise.all(workers);

    const completed = results.filter(Boolean);
    const byStatus = completed.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    const successful = completed.filter(
      (row) => row.status === 'match' || row.status === 'near_match' || row.status === 'mismatch',
    );
    const mismatches = successful
      .filter((row) => row.status === 'mismatch')
      .sort((a, b) => (b.absDelta ?? 0) - (a.absDelta ?? 0));
    const mismatchByRateSource = mismatches.reduce<Record<string, number>>((acc, row) => {
      const key = row.apiRateSource || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const noteBasedTextRows = completed.filter((row) =>
      /see|note|provision|additional\s+u\.s\./i.test(row.mfnTextRate || ''),
    ).length;

    const topMismatches = mismatches.slice(0, 50).map((row) => ({
      hts8: row.hts8,
      apiHtsNumber: row.apiHtsNumber,
      apiRateSource: row.apiRateSource,
      apiFormulaUsed: row.apiFormulaUsed,
      expected2025BaseDuty: row.expected2025BaseDuty,
      api2026BaseDuty: row.api2026BaseDuty,
      absDelta: row.absDelta,
      pctDelta: row.pctDelta,
      mfnTextRate: row.mfnTextRate,
      beginEffectDate: row.beginEffectDate,
      endEffectiveDate: row.endEffectiveDate,
    }));

    const summary = {
      generatedAt: new Date().toISOString(),
      apiBaseUrl: API_BASE_URL,
      testInput: {
        countryOfOrigin: COUNTRY,
        declaredValue: DECLARED_VALUE,
        quantity: QUANTITY,
        weightKg: WEIGHT_KG,
        entryDate: ENTRY_DATE,
      },
      totals: {
        historyRows: completed.length,
        successfulApiCalculations: successful.length,
      },
      countsByStatus: byStatus,
      mismatchStats: {
        mismatchCount: mismatches.length,
        mismatchesOver1Dollar: mismatches.filter((row) => (row.absDelta ?? 0) > 1).length,
        mismatchesOver5Dollars: mismatches.filter((row) => (row.absDelta ?? 0) > 5).length,
        mismatchByRateSource,
      },
      noteBasedTextRows,
      topMismatches,
    };

    await mkdir(OUTPUT_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const csvPath = join(OUTPUT_DIR, `tariff-history-2025-vs-api-2026-${ts}.csv`);
    const jsonPath = join(OUTPUT_DIR, `tariff-history-2025-vs-api-2026-${ts}.summary.json`);

    await writeFile(csvPath, buildCsv(completed), 'utf-8');
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\nCompleted ${completed.length} rows in ${elapsedSec}s`);
    console.log(`CSV report: ${csvPath}`);
    console.log(`Summary: ${jsonPath}`);
    console.log(`Counts by status: ${JSON.stringify(byStatus)}`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
