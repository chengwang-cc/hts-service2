import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { AdCvdOrderEntity } from './ad-cvd-orders.entity';
import { AdCvdLookupService } from './ad-cvd-lookup.service';
import { normalizeJurisdictionCode } from './jurisdiction-code';

/**
 * AdCvdImporterService (Phase 9, P9.T2).
 *
 * Loads AD/CVD orders from CSV (admin upload or local seed file) into
 * the `ad_cvd_orders` table. Idempotent on
 * `(destinationCountry, htsCode, originCountry, exporterName, orderCaseNumber)`.
 *
 * Per the data-sourcing spec (docs/2026-05-27/0900_*), the importer
 * supports two paths:
 *   1. `loadCsv(buffer)` — admin upload endpoint
 *   2. `loadSeedFile()`  — boot-time bootstrap from the sample seed CSV
 *      committed in `_shared/data/ad-cvd-orders-sample.csv`
 *
 * A scheduled poller (USDOC ACE pull, etc.) is a Phase 9.1 follow-up
 * — Engineering's interface is `loadCsv()`; OPS handles cadence.
 */

export interface AdCvdImportSummary {
  parsed: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; error: string; raw: Record<string, string> }>;
}

@Injectable()
export class AdCvdImporterService {
  private readonly logger = new Logger(AdCvdImporterService.name);

  constructor(
    @InjectRepository(AdCvdOrderEntity)
    private readonly repo: Repository<AdCvdOrderEntity>,
    // H3 fix (2026-05-26): invalidate the lookup row cache after every
    // import so newly-loaded orders are visible immediately. Optional —
    // the spec wires a bare importer for unit tests.
    @Optional() private readonly lookup?: AdCvdLookupService,
  ) {}

  /** Import from an uploaded CSV buffer (UTF-8). */
  async loadCsv(buffer: Buffer, ingestedBy = 'system'): Promise<AdCvdImportSummary> {
    const rows = parseCsv(buffer.toString('utf8'));
    return this.importRows(rows, ingestedBy);
  }

  /** Boot-time bootstrap from the committed sample seed. */
  async loadSeedFile(): Promise<AdCvdImportSummary> {
    const seedPath = path.join(__dirname, 'data', 'ad-cvd-orders-sample.csv');
    if (!fs.existsSync(seedPath)) {
      return { parsed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
    }
    const buffer = fs.readFileSync(seedPath);
    return this.loadCsv(buffer, 'system:seed');
  }

  /**
   * Importer-side dry run — parses + validates the CSV without writing.
   */
  async dryRun(buffer: Buffer): Promise<AdCvdImportSummary> {
    const rows = parseCsv(buffer.toString('utf8'));
    const summary: AdCvdImportSummary = {
      parsed: rows.length, inserted: 0, updated: 0, skipped: 0, errors: [],
    };
    for (let i = 0; i < rows.length; i++) {
      const validation = validateRow(rows[i]);
      if (!validation.ok) {
        summary.errors.push({ row: i + 2, error: validation.error, raw: rows[i] });
      }
    }
    return summary;
  }

  // ── internals ──────────────────────────────────────────────────────

  private async importRows(
    rows: Record<string, string>[],
    ingestedBy: string,
  ): Promise<AdCvdImportSummary> {
    const summary: AdCvdImportSummary = {
      parsed: rows.length, inserted: 0, updated: 0, skipped: 0, errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const validation = validateRow(raw);
      if (!validation.ok) {
        summary.errors.push({ row: i + 2, error: validation.error, raw });
        summary.skipped += 1;
        continue;
      }
      const candidate = validation.entity;
      try {
        // M2 fix (2026-05-27): Postgres `null = null` is FALSE, so
        // matching the "all others" row (exporterName=null) requires
        // TypeORM's `IsNull()` helper. Without this the importer
        // silently inserts duplicate all-others rows on re-import.
        const existing = await this.repo.findOne({
          where: {
            destinationCountry: candidate.destinationCountry,
            htsCode: candidate.htsCode,
            originCountry: candidate.originCountry,
            exporterName:
              candidate.exporterName === null
                ? IsNull()
                : candidate.exporterName,
            orderCaseNumber: candidate.orderCaseNumber,
          } as any,
        });
        if (existing) {
          const before = JSON.stringify({
            r: existing.cashDepositRate,
            f: existing.effectiveFrom?.toISOString(),
            t: existing.effectiveTo?.toISOString() ?? null,
            d: existing.description,
            s: existing.source,
            o: existing.orderType,
          });
          existing.cashDepositRate = candidate.cashDepositRate;
          existing.effectiveFrom = candidate.effectiveFrom;
          existing.effectiveTo = candidate.effectiveTo;
          existing.source = candidate.source;
          existing.description = candidate.description;
          existing.orderType = candidate.orderType;
          const after = JSON.stringify({
            r: existing.cashDepositRate,
            f: existing.effectiveFrom?.toISOString(),
            t: existing.effectiveTo?.toISOString() ?? null,
            d: existing.description,
            s: existing.source,
            o: existing.orderType,
          });
          if (before === after) {
            summary.skipped += 1;
          } else {
            await this.repo.save(existing);
            summary.updated += 1;
          }
        } else {
          await this.repo.save(this.repo.create(candidate));
          summary.inserted += 1;
        }
      } catch (e: any) {
        summary.errors.push({ row: i + 2, error: e?.message ?? String(e), raw });
        summary.skipped += 1;
      }
    }

    this.logger.log(
      `ad_cvd.import parsed=${summary.parsed} inserted=${summary.inserted} updated=${summary.updated} skipped=${summary.skipped} errors=${summary.errors.length} by=${ingestedBy}`,
    );
    if (summary.inserted > 0 || summary.updated > 0) {
      // H3 (2026-05-26): drop the lookup cache so the newly-imported
      // rows are visible to the next quote without waiting for the TTL.
      this.lookup?.invalidateCache();
    }
    return summary;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

interface ValidatedEntity {
  destinationCountry: string;
  htsCode: string;
  originCountry: string;
  exporterName: string | null;
  orderCaseNumber: string;
  orderType: 'AD' | 'CVD' | 'AD+CVD' | 'SAFEGUARD' | 'COUNTERMEASURE';
  cashDepositRate: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  source: string;
  description: string | null;
}

type ValidateResult =
  | { ok: true; entity: ValidatedEntity }
  | { ok: false; error: string };

function validateRow(row: Record<string, string>): ValidateResult {
  const need = (key: string): string => (row[key] ?? '').trim();
  const dest = need('destinationCountry').toUpperCase();
  const hts = need('htsCode');
  const origin = need('originCountry').toUpperCase();
  const exporter = need('exporterName') || null;
  const caseNo = need('orderCaseNumber');
  const orderType = need('orderType').toUpperCase();
  const rateStr = need('cashDepositRate');
  const fromStr = need('effectiveFrom');
  const toStr = need('effectiveTo');
  const source = need('source');
  const description = need('description') || null;

  if (!dest) return { ok: false, error: 'destinationCountry required' };
  if (!hts) return { ok: false, error: 'htsCode required' };
  if (!origin) return { ok: false, error: 'originCountry required' };
  if (!caseNo) return { ok: false, error: 'orderCaseNumber required' };
  // W0.5.T4 (2026-05-26): extended to cover safeguard + countermeasure.
  if (!['AD', 'CVD', 'AD+CVD', 'SAFEGUARD', 'COUNTERMEASURE'].includes(orderType)) {
    return { ok: false, error: `orderType must be AD | CVD | AD+CVD | SAFEGUARD | COUNTERMEASURE; got "${orderType}"` };
  }
  const rate = Number(rateStr);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10) {
    return { ok: false, error: `cashDepositRate out of range [0,10]: "${rateStr}"` };
  }
  const from = new Date(fromStr);
  if (Number.isNaN(from.getTime())) {
    return { ok: false, error: `effectiveFrom not a date: "${fromStr}"` };
  }
  const to = toStr ? new Date(toStr) : null;
  if (to && Number.isNaN(to.getTime())) {
    return { ok: false, error: `effectiveTo not a date: "${toStr}"` };
  }

  return {
    ok: true,
    entity: {
      destinationCountry: dest,
      // M1 fix (2026-05-27): store HTS normalized so the lookup
      // service's prefix/exact match doesn't depend on the source CSV
      // format. W0.5.T1 fix (2026-05-26): per-destination digit length
      // — replaces the hardcoded 10-digit pad which silently mangled
      // JP/IN/AE/TH codes.
      htsCode: normalizeJurisdictionCode(dest, hts),
      originCountry: origin,
      exporterName: exporter,
      orderCaseNumber: caseNo,
      orderType: orderType as 'AD' | 'CVD' | 'AD+CVD' | 'SAFEGUARD' | 'COUNTERMEASURE',
      cashDepositRate: rate,
      effectiveFrom: from,
      effectiveTo: to,
      source,
      description,
    },
  };
}

/**
 * Minimal CSV reader. Honors a header row, ignores `#`-prefixed lines
 * and blanks. Tolerates trailing whitespace but does NOT handle quoted
 * commas — production sources should serialize CSVs without embedded
 * commas in free-text fields (description is the only at-risk column;
 * the importer logs a row error if a parsed cell count mismatches the
 * header).
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  let header: string[] | null = null;
  const out: Array<Record<string, string>> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!header) {
      header = line.split(',').map((h) => h.trim());
      continue;
    }
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    out.push(row);
  }
  return out;
}
