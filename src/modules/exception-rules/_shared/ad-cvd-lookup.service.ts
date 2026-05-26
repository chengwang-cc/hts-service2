import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AdCvdOrderEntity } from './ad-cvd-orders.entity';
import { JurisdictionCodeNormalizer, hs6Prefix } from './jurisdiction-code';

/**
 * AdCvdLookupService (Phase 6, P6.T5 — stub).
 *
 * Provides the lookup surface that per-jurisdiction AD/CVD rules
 * (`us.ad-cvd`, `ca.ad-cvd`, `gb.ad-cvd`, `eu.ad-cvd`, …) call to
 * decide whether an order applies. Phase 9 will replace the empty
 * `ad_cvd_orders` table with real data; this service is the integration
 * boundary.
 *
 * Matching policy:
 *   1. Exact HTS match first
 *   2. 6-digit HS prefix match second
 *   3. Per-exporter rate beats "all others" rate
 *   4. Most specific match wins
 *
 * The repository is optional so unit tests can hand-build the service
 * without TypeORM.
 */
export interface AdCvdMatch {
  caseNumber: string;
  orderType: string;
  rate: number;
  source: string;
  description?: string;
  exporterName?: string | null;
}

@Injectable()
export class AdCvdLookupService {
  private readonly logger = new Logger(AdCvdLookupService.name);

  /**
   * H3 fix (2026-05-26): in-process row cache keyed by
   * `${dest}|${origin}`. A 10-line CN→US quote used to hit the DB
   * 10 times for the exact same `(destinationCountry, originCountry)`
   * filter; now we fetch once and reuse across lines.
   *
   * The cache TTL defaults to 60s (long enough to cover a typical
   * multi-line quote, short enough that admin-edited orders show up
   * promptly). Override via `AD_CVD_LOOKUP_CACHE_TTL_MS`.
   *
   * Concurrency: the cache stores resolved row arrays, not promises.
   * Concurrent first-misses race the DB; the loser overwrites with
   * the same data. That's cheaper than building a per-key promise
   * dedupe map and the race window is single-digit milliseconds.
   */
  private readonly cacheTtlMs = Number(
    process.env.AD_CVD_LOOKUP_CACHE_TTL_MS ?? 60_000,
  );
  private readonly rowCache = new Map<
    string,
    { rows: AdCvdOrderEntity[]; expiresAt: number }
  >();

  constructor(
    @InjectRepository(AdCvdOrderEntity)
    private readonly repo?: Repository<AdCvdOrderEntity>,
    @Optional() private readonly codeNormalizer?: JurisdictionCodeNormalizer,
  ) {}

  /**
   * Drop the row cache. Called by the admin importer after a CSV load
   * so newly-imported orders are visible without waiting for the TTL.
   */
  invalidateCache(): void {
    this.rowCache.clear();
  }

  /**
   * Look up the most-specific applicable AD/CVD match for
   * (destination, hts, origin, exporter, asOf). Returns null when no
   * match exists (the stub case for Phase 6).
   */
  async lookup(args: {
    destinationCountry: string;
    htsCode: string;
    originCountry: string;
    exporterName?: string | null;
    asOf?: Date;
  }): Promise<AdCvdMatch | null> {
    if (!this.repo) return null;
    const dest = args.destinationCountry.toUpperCase();
    const origin = args.originCountry.toUpperCase();
    const asOf = args.asOf ?? new Date();
    // W0.5.T1 (2026-05-26): per-country digit normalization. JP=9, IN=8,
    // AE=12, TH=11, BR/PH/ID/SG=8, others=10. Pre-W0.5.T1 used a
    // hardcoded 10-digit pad which silently mangled non-10 countries.
    const htsNorm = this.normalizeForDestination(dest, args.htsCode);
    const hts6 = hs6Prefix(args.htsCode);

    const cacheKey = `${dest}|${origin}`;
    let rows: AdCvdOrderEntity[];
    const cached = this.rowCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      rows = cached.rows;
    } else {
      try {
        rows = await this.repo.find({
          where: { destinationCountry: dest, originCountry: origin },
        });
      } catch (e: any) {
        this.logger.warn(`ad_cvd lookup failed: ${e?.message ?? e}`);
        return null;
      }
      this.rowCache.set(cacheKey, {
        rows,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    // H1 fix (2026-05-26): `effectiveTo` is inclusive — an order with
    // effectiveTo = 2026-05-26 must still apply on the last day. The
    // prior strict `<` made the order expire one day early on the
    // boundary, which is wrong for USDOC ACE date conventions where
    // the publication-day rate stays active through end-of-day.
    const active = rows.filter(
      (r) => asOf >= r.effectiveFrom && (!r.effectiveTo || asOf <= r.effectiveTo),
    );
    if (active.length === 0) return null;

    // M1 fix (2026-05-27): normalize both sides of the HTS comparison —
    // entity rows may have been imported with dots (legacy CSVs); query
    // also normalizes. Exact 10-digit match first, then 6-digit prefix.
    const exactCode = active.filter(
      (r) => this.normalizeForDestination(dest, r.htsCode) === htsNorm,
    );
    const prefixCode = active.filter((r) =>
      hs6Prefix(r.htsCode).startsWith(hts6),
    );
    const candidates = exactCode.length > 0 ? exactCode : prefixCode;
    if (candidates.length === 0) return null;

    // M3 fix (2026-05-27): deterministic ordering. When two candidates
    // tie on specificity, prefer most recent effectiveFrom (the latest
    // administrative-review rate), then highest cashDepositRate (more
    // restrictive). This makes the lookup stable across replicas and
    // DB driver versions.
    candidates.sort((a, b) => {
      const ta = a.effectiveFrom.getTime();
      const tb = b.effectiveFrom.getTime();
      if (tb !== ta) return tb - ta;
      return Number(b.cashDepositRate) - Number(a.cashDepositRate);
    });

    // Per-exporter beats "all others" — case-insensitive + trim-tolerant.
    const queryExporter = args.exporterName?.trim().toLowerCase() ?? null;
    const perExporter = queryExporter
      ? candidates.find(
          (r) =>
            (r.exporterName ?? '').trim().toLowerCase() === queryExporter,
        )
      : undefined;
    // H2 fix (2026-05-26): the "all others" row can land in the DB
    // either as NULL (the importer's intent) or as an empty string
    // (CSV imports that don't NULL-encode the blank cell). Treat both
    // as the all-others fallback so the lookup doesn't bypass it and
    // pick the most-restrictive candidate by accident.
    const isAllOthersRow = (r: AdCvdOrderEntity) => {
      const name = r.exporterName;
      return name === null || (typeof name === 'string' && name.trim() === '');
    };
    const chosen =
      perExporter ??
      candidates.find(isAllOthersRow) ??
      candidates[0];

    return {
      caseNumber: chosen.orderCaseNumber,
      orderType: chosen.orderType,
      rate: Number(chosen.cashDepositRate),
      source: chosen.source,
      description: chosen.description ?? undefined,
      exporterName: chosen.exporterName,
    };
  }

  /**
   * Normalize an HTS code for the given destination using the injected
   * `JurisdictionCodeNormalizer`. Falls back to the historical 10-digit
   * pad when the normalizer isn't injected (e.g., in unit tests that
   * build the service by hand).
   */
  private normalizeForDestination(
    destination: string,
    raw: string,
  ): string {
    if (this.codeNormalizer) {
      return this.codeNormalizer.normalize(destination, raw);
    }
    return (raw || '').replace(/[\s.]/g, '').padEnd(10, '0').slice(0, 10);
  }
}
