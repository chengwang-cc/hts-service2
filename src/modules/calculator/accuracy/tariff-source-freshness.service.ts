import { Injectable } from '@nestjs/common';
import {
  DEFAULT_THRESHOLDS,
  FreshnessReport,
  FreshnessStatus,
  FreshnessThresholds,
  SourceFreshnessRecord,
  SourceKind,
} from './tariff-source-freshness.types';

/**
 * TariffSourceFreshnessService
 *
 * Pure-logic service that scores a set of `SourceFreshnessRecord`s against
 * configurable per-kind SLA thresholds and returns a `FreshnessReport[]`.
 *
 * Storage and ingestion are deliberately out of scope here so the same
 * scoring can be unit tested, dashboard-rendered, and re-used by the
 * scheduled refresh job. A follow-up wires this to a `tariff_source_freshness`
 * table and a real upstream poller.
 */
@Injectable()
export class TariffSourceFreshnessService {
  private overrides: Partial<Record<SourceKind, FreshnessThresholds>> = {};

  /**
   * Override per-kind thresholds at boot if SOURCE_FRESHNESS_OVERRIDES env
   * var is set. Format: `usitc_hts:14/60/120,cbp_csms:3/14/30`.
   */
  configureFromEnv(envValue: string | undefined): void {
    this.overrides = {};
    if (!envValue) return;
    for (const part of envValue.split(',')) {
      const [kind, spec] = part.split(':');
      if (!kind || !spec) continue;
      const [fresh, stale, expiry] = spec.split('/').map(Number);
      if (!Number.isFinite(fresh) || !Number.isFinite(stale) || !Number.isFinite(expiry)) {
        continue;
      }
      this.overrides[kind.trim() as SourceKind] = {
        freshDays: fresh,
        stalenessDays: stale,
        expiryDays: expiry,
      };
    }
  }

  thresholdsFor(kind: SourceKind): FreshnessThresholds {
    return this.overrides[kind] ?? DEFAULT_THRESHOLDS[kind];
  }

  /**
   * Score one record. `now` is injectable for deterministic tests.
   */
  scoreRecord(
    record: SourceFreshnessRecord,
    now: Date = new Date(),
  ): FreshnessReport {
    const reference =
      record.upstreamLastChangedAt ?? record.lastObservedAt ?? null;
    const ageDays = this.ageInDays(reference, now);
    const thresholds = this.thresholdsFor(record.kind);
    const status = this.classify(ageDays, thresholds);

    const needsRefresh =
      record.dependentComponentCount > 0 &&
      (status === 'stale' || status === 'expired' || status === 'unknown');
    const blocksRollout =
      status === 'expired' && record.dependentComponentCount > 0;

    return {
      sourceId: record.sourceId,
      kind: record.kind,
      label: record.label,
      status,
      ageDays,
      dependentComponentCount: record.dependentComponentCount,
      thresholds,
      needsRefresh,
      blocksRollout,
    };
  }

  scoreBatch(
    records: SourceFreshnessRecord[],
    now: Date = new Date(),
  ): FreshnessReport[] {
    return records.map((r) => this.scoreRecord(r, now));
  }

  /**
   * Roll up a batch into a single dashboard-ready summary. Counts by status
   * + the subset of reports that block rollout.
   */
  summarize(reports: FreshnessReport[]): {
    total: number;
    countsByStatus: Record<FreshnessStatus, number>;
    needsRefresh: FreshnessReport[];
    blocksRollout: FreshnessReport[];
  } {
    const countsByStatus: Record<FreshnessStatus, number> = {
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
      unknown: 0,
    };
    const needsRefresh: FreshnessReport[] = [];
    const blocksRollout: FreshnessReport[] = [];
    for (const r of reports) {
      countsByStatus[r.status]++;
      if (r.needsRefresh) needsRefresh.push(r);
      if (r.blocksRollout) blocksRollout.push(r);
    }
    return {
      total: reports.length,
      countsByStatus,
      needsRefresh,
      blocksRollout,
    };
  }

  private classify(
    ageDays: number | null,
    thresholds: FreshnessThresholds,
  ): FreshnessStatus {
    if (ageDays === null) return 'unknown';
    if (ageDays <= thresholds.freshDays) return 'fresh';
    if (ageDays <= thresholds.stalenessDays) return 'aging';
    if (ageDays <= thresholds.expiryDays) return 'stale';
    return 'expired';
  }

  private ageInDays(iso: string | null, now: Date): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const diffMs = now.getTime() - t;
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }
}
