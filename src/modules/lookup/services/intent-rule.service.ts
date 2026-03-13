import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LookupIntentRuleEntity } from '../entities/lookup-intent-rule.entity';
import {
  IntentRule,
  TokenPattern,
  InjectSpec,
  WhitelistSpec,
  ScoreAdjustment,
  patternMatches,
} from './intent-rules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

/** Reload the rule cache from DB every 5 minutes so all pods in a cluster
 *  pick up newly generated AI rules without a full restart. */
const PERIODIC_RELOAD_MS = 5 * 60 * 1000;

@Injectable()
export class IntentRuleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntentRuleService.name);
  private cache: IntentRule[] = [];
  private reloadTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(LookupIntentRuleEntity)
    private readonly repo: Repository<LookupIntentRuleEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.logger.log(`Loaded ${this.cache.length} intent rules from DB`);

    // Periodic reload so all cluster pods stay in sync with DB-generated rules
    this.reloadTimer = setInterval(() => {
      this.reload().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Periodic rule cache reload failed: ${msg}`);
      });
    }, PERIODIC_RELOAD_MS);
  }

  onModuleDestroy(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  /** Reload rules from DB into the in-memory cache. */
  async reload(): Promise<void> {
    const rows = await this.repo.find({
      where: { enabled: true },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
    this.cache = rows.map((r) => ({
      id: r.ruleId,
      description: r.description,
      pattern: r.pattern as unknown as TokenPattern,
      ...(r.lexicalFilter
        ? { lexicalFilter: r.lexicalFilter as unknown as IntentRule['lexicalFilter'] }
        : {}),
      ...(r.inject ? { inject: r.inject as unknown as InjectSpec[] } : {}),
      ...(r.whitelist ? { whitelist: r.whitelist as unknown as WhitelistSpec } : {}),
      ...(r.boosts ? { boosts: r.boosts as unknown as ScoreAdjustment[] } : {}),
      ...(r.penalties ? { penalties: r.penalties as unknown as ScoreAdjustment[] } : {}),
    }));
  }

  /** Return all rules whose pattern matches the given query token set. */
  matchRules(tokens: Set<string>, queryLower = ''): IntentRule[] {
    return this.cache.filter((rule) => patternMatches(rule.pattern, tokens, queryLower));
  }

  /** Return current cache size (for health checks / logging). */
  get ruleCount(): number {
    return this.cache.length;
  }

  /** Return a snapshot of all cached rules (for coverage analysis). */
  getAllRules(): IntentRule[] {
    return [...this.cache];
  }

  /**
   * Upsert a rule by ruleId and refresh the in-memory cache.
   * Pass `skipReload: true` when batch-upserting many rules to avoid
   * reloading on every single insert; call reload() manually afterwards.
   */
  async upsertRule(rule: IntentRule, priority = 0, skipReload = false): Promise<void> {
    await this.repo.upsert(
      {
        ruleId: rule.id,
        description: rule.description,
        pattern: rule.pattern as JsonValue,
        lexicalFilter: (rule.lexicalFilter ?? null) as JsonValue,
        inject: (rule.inject ?? null) as JsonValue,
        whitelist: (rule.whitelist ?? null) as JsonValue,
        boosts: (rule.boosts ?? null) as JsonValue,
        penalties: (rule.penalties ?? null) as JsonValue,
        enabled: true,
        priority,
      },
      ['ruleId'],
    );
    if (!skipReload) {
      await this.reload();
    }
  }

  /** Disable a rule by its ruleId and refresh the cache. */
  async disableRule(ruleId: string): Promise<void> {
    await this.repo.update({ ruleId }, { enabled: false });
    await this.reload();
  }
}
