/**
 * Tariff source freshness types.
 *
 * Calculator-v2 accuracy is gated on knowing — for every active source pack
 * (USITC HTS revision, CBP CSMS bulletin set, USTR Section 301 list,
 * Federal Register notice, internal knowledge card) — three things:
 *
 *   1. when we last refreshed it (`lastObservedAt`)
 *   2. when it last actually changed upstream (`upstreamLastChangedAt`)
 *   3. how stale that makes the calculator outputs that depend on it
 *
 * These types are intentionally storage-agnostic so we can hydrate them
 * from TypeORM, an in-memory fixture, or a real ingestion pipeline.
 * Persistence lands in a follow-up; the contract is what calculators and
 * the admin coverage dashboard depend on.
 */

export type SourceKind =
  | 'usitc_hts'
  | 'cbp_csms'
  | 'ustr_section_301'
  | 'federal_register'
  | 'knowledge_card'
  | 'broker_golden_set'
  | 'provider_quote';

export type FreshnessStatus =
  | 'fresh'
  | 'aging'
  | 'stale'
  | 'expired'
  | 'unknown';

export interface SourceFreshnessRecord {
  /** Stable id for the source pack (e.g. "usitc_hts:2026-rev-8"). */
  sourceId: string;
  /** Source kind for routing / SLA selection. */
  kind: SourceKind;
  /** Human label for dashboards. */
  label: string;
  /** ISO date of last refresh observation (we checked the source). */
  lastObservedAt: string | null;
  /** ISO date the upstream content last changed (per release notes / API). */
  upstreamLastChangedAt: string | null;
  /** Number of active formula components that depend on this source. */
  dependentComponentCount: number;
  /** Optional URL for jump-to-source. */
  sourceUrl?: string;
}

export interface FreshnessThresholds {
  /** Days after which a source goes from `fresh` to `aging`. */
  freshDays: number;
  /** Days after which a source goes from `aging` to `stale`. */
  stalenessDays: number;
  /** Days after which a source becomes `expired` (calculator should block). */
  expiryDays: number;
}

/**
 * Default SLA per source kind. USITC publishes revisions roughly every 4-6
 * weeks; CBP CSMS bulletins land continuously; broker golden sets refresh
 * monthly. These defaults can be overridden via service config.
 */
export const DEFAULT_THRESHOLDS: Readonly<Record<SourceKind, FreshnessThresholds>> = {
  usitc_hts: { freshDays: 14, stalenessDays: 60, expiryDays: 120 },
  cbp_csms: { freshDays: 3, stalenessDays: 14, expiryDays: 30 },
  ustr_section_301: { freshDays: 7, stalenessDays: 30, expiryDays: 60 },
  federal_register: { freshDays: 3, stalenessDays: 14, expiryDays: 30 },
  knowledge_card: { freshDays: 30, stalenessDays: 90, expiryDays: 180 },
  broker_golden_set: { freshDays: 30, stalenessDays: 90, expiryDays: 180 },
  provider_quote: { freshDays: 30, stalenessDays: 90, expiryDays: 180 },
};

export interface FreshnessReport {
  sourceId: string;
  kind: SourceKind;
  label: string;
  status: FreshnessStatus;
  ageDays: number | null;
  dependentComponentCount: number;
  thresholds: FreshnessThresholds;
  /** True when status is stale|expired and components depend on it. */
  needsRefresh: boolean;
  /** True when the source can block calculator rollout. */
  blocksRollout: boolean;
}
