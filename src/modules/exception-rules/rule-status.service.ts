import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { RuleStatusEntity } from './entities/rule-status.entity';

/**
 * RuleStatusService (Phase 1, P1.T5).
 *
 * Decides at runtime whether a given rule is active for a given
 * evaluation date. Absence of a status row → enabled (rules ship
 * enabled). Presence → respect `enabled` plus `effectiveFrom`/`To`.
 *
 * Caching: a small in-memory map per process, invalidated on any
 * `set()`. The dataset is tiny (≤ ~100 rows) and read-heavy; the cache
 * keeps the per-quote overhead at a single map lookup.
 *
 * The repository injection is intentionally optional. Unit tests for the
 * runner can construct the service with `undefined` to get the
 * always-enabled default behavior without touching TypeORM.
 */
export interface RuleStatusSummary {
  ruleId: string;
  enabled: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  reason: string | null;
}

@Injectable()
export class RuleStatusService {
  private readonly logger = new Logger(RuleStatusService.name);

  /**
   * D6 fix (2026-05-27): TTL-bounded cache (default 60s) so admin
   * toggles propagate across replicas without an explicit invalidation
   * channel. Local `set()` still invalidates immediately so the
   * originating pod sees the change instantly; other pods see it on
   * the next TTL expiry. Tunable via `RULE_STATUS_CACHE_TTL_MS`.
   *
   * Setting the TTL to 0 disables caching entirely (per-call DB fetch).
   */
  private cache: Map<string, RuleStatusEntity> | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs: number;

  constructor(
    @InjectRepository(RuleStatusEntity)
    private readonly repo?: Repository<RuleStatusEntity>,
  ) {
    const raw = Number(process.env.RULE_STATUS_CACHE_TTL_MS);
    this.cacheTtlMs = Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
  }

  /**
   * True when the rule should fire at `asOf`. Defaults to true when no
   * row exists.
   */
  async isEnabled(ruleId: string, asOf: Date = new Date()): Promise<boolean> {
    const row = await this.getRow(ruleId);
    if (!row) return true;
    if (!row.enabled) return false;
    if (row.effectiveFrom && asOf < row.effectiveFrom) return false;
    if (row.effectiveTo && asOf >= row.effectiveTo) return false;
    return true;
  }

  /**
   * Returns the effective-at-`asOf` state for every passed rule id. Used
   * by the calculator to attach the full status map to the audit
   * snapshot (so historical replay sees the exact toggle picture).
   */
  async bulkStatus(
    ruleIds: string[],
    asOf: Date = new Date(),
  ): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const id of ruleIds) {
      out[id] = await this.isEnabled(id, asOf);
    }
    return out;
  }

  /**
   * Upsert a row for `ruleId`. Pass `enabled=false` to disable, `null`
   * dates to clear effective windows.
   */
  async set(args: {
    ruleId: string;
    enabled: boolean;
    effectiveFrom?: Date | null;
    effectiveTo?: Date | null;
    reason?: string | null;
    changedBy: string;
  }): Promise<RuleStatusEntity> {
    if (!this.repo) {
      throw new Error('RuleStatusService: repository unavailable');
    }
    const existing = await this.repo.findOne({ where: { ruleId: args.ruleId } });
    const row = existing ?? this.repo.create({ ruleId: args.ruleId } as RuleStatusEntity);
    row.enabled = args.enabled;
    row.effectiveFrom = args.effectiveFrom ?? null;
    row.effectiveTo = args.effectiveTo ?? null;
    row.reason = args.reason ?? null;
    row.changedBy = args.changedBy;
    const saved = await this.repo.save(row);
    this.invalidateCache();
    this.logger.log(
      `rule_status set ruleId=${args.ruleId} enabled=${args.enabled} by=${args.changedBy}`,
    );
    return saved;
  }

  /** Snapshot of every row (admin endpoint). */
  async list(): Promise<RuleStatusSummary[]> {
    const cache = await this.hydrate();
    return Array.from(cache.values()).map((r) => ({
      ruleId: r.ruleId,
      enabled: r.enabled,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      reason: r.reason,
    }));
  }

  /** Test seam — drops the cache so the next read re-hydrates. */
  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }

  private async getRow(ruleId: string): Promise<RuleStatusEntity | undefined> {
    const cache = await this.hydrate();
    return cache.get(ruleId);
  }

  private async hydrate(): Promise<Map<string, RuleStatusEntity>> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiresAt) return this.cache;
    const map = new Map<string, RuleStatusEntity>();
    if (this.repo) {
      try {
        const rows = await this.repo.find();
        for (const r of rows) map.set(r.ruleId, r);
      } catch (e: any) {
        // DB transient: don't poison subsequent reads with a partial cache.
        this.logger.warn(`rule_status hydrate failed: ${e?.message ?? e}`);
        return map;
      }
    }
    if (this.cacheTtlMs > 0) {
      this.cache = map;
      this.cacheExpiresAt = now + this.cacheTtlMs;
    } else {
      this.cache = null;
      this.cacheExpiresAt = 0;
    }
    return map;
  }
}
