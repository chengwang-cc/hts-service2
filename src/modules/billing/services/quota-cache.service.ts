import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { EffectiveLimits } from '../types/effective-limits';

/**
 * Cached quota snapshot used by `PartnerQuotaGuard`. The cache value is
 * intentionally a snapshot (last-known counts + the org's effective
 * limits + org type) so the guard's hot path is a single cache read
 * with no DB round-trip on every request.
 */
export interface QuotaSnapshot {
  limits: EffectiveLimits;
  orgType: string;
  requestsThisMonth: number;
  costUsdThisMonth: number;
  /** Epoch ms when the snapshot was written. Consumers use this for staleness. */
  syncedAt: number;
}

/**
 * Backend-agnostic interface for `PartnerQuotaGuard`. Two backends today:
 *
 *   - **memory**: per-process `Map`. Old behaviour. Safe single-task only.
 *   - **redis**:  shared `ioredis` cache. Safe across N ECS tasks.
 *
 * The interface returns `null` on miss so callers can re-compute and
 * push the fresh value back via `set()`. This keeps the cache layer
 * dumb — it doesn't know how to load from the DB; that's the guard's
 * responsibility.
 */
export interface IQuotaCache {
  get(partnerId: string): Promise<QuotaSnapshot | null>;
  set(partnerId: string, snapshot: QuotaSnapshot): Promise<void>;
  /** Backend identifier surfaced in logs + observability. */
  readonly backend: 'memory' | 'redis';
}

const TTL_MS = 30_000;
const TTL_S = Math.floor(TTL_MS / 1000);

/**
 * Per-process Map cache. The pre-existing behaviour, kept as a backend
 * so we can flip between memory and Redis via env var during rollout
 * (and fall back to it if Redis is unreachable).
 *
 * NOT safe across N ECS tasks: each task has its own Map and reads
 * stale values independently, so a 10/min quota can be allowed twice
 * by two tasks on the same second. Use the Redis backend in prod.
 */
@Injectable()
export class MemoryQuotaCache implements IQuotaCache {
  readonly backend = 'memory' as const;
  private readonly cache = new Map<string, { snapshot: QuotaSnapshot; expiresAt: number }>();

  async get(partnerId: string): Promise<QuotaSnapshot | null> {
    const entry = this.cache.get(partnerId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(partnerId);
      return null;
    }
    return entry.snapshot;
  }

  async set(partnerId: string, snapshot: QuotaSnapshot): Promise<void> {
    this.cache.set(partnerId, { snapshot, expiresAt: Date.now() + TTL_MS });
  }
}

/**
 * Shared Redis cache. Both ECS tasks read the SAME snapshot, so the
 * window where they disagree on "have we hit the quota" shrinks from
 * "uncapped" to "one TTL window after the rollup catches up".
 *
 * Storage layout
 * --------------
 * Key:   quota:snapshot:<partnerId>
 * Value: JSON-serialised QuotaSnapshot
 * TTL:   30 seconds (half the original Map TTL — Redis reads are cheap
 *        and a tighter window cuts the over-allow tail in half)
 *
 * Fail-open
 * ---------
 * Every `get`/`set` swallows Redis errors and logs at debug. The cache
 * is performance optimisation, not a security boundary; a Redis outage
 * must not 500 paying customers. The guard's existing DB-fallback path
 * stays the catch-all on cache miss.
 */
@Injectable()
export class RedisQuotaCache implements IQuotaCache, OnModuleDestroy {
  readonly backend = 'redis' as const;
  private readonly logger = new Logger(RedisQuotaCache.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    // Same URL convention as the embedding services, so a single
    // REDIS_URL env var configures everything.
    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      {
        // Don't drag boot if Redis is down. The guard fails open on
        // missing snapshots so the worst case is "every request hits
        // the DB for the count" until Redis recovers.
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        commandTimeout: 500,
        reconnectOnError: () => true,
      },
    );
    this.redis.on('error', (err) =>
      this.logger.debug(`Redis error (fail-open): ${err?.message ?? err}`),
    );
  }

  private key(partnerId: string): string {
    return `quota:snapshot:${partnerId}`;
  }

  async get(partnerId: string): Promise<QuotaSnapshot | null> {
    try {
      const raw = await this.redis.get(this.key(partnerId));
      if (!raw) return null;
      return JSON.parse(raw) as QuotaSnapshot;
    } catch (err) {
      this.logger.debug(`get(${partnerId}) fail-open: ${(err as Error)?.message}`);
      return null;
    }
  }

  async set(partnerId: string, snapshot: QuotaSnapshot): Promise<void> {
    try {
      await this.redis.set(
        this.key(partnerId),
        JSON.stringify(snapshot),
        'EX',
        TTL_S,
      );
    } catch (err) {
      this.logger.debug(`set(${partnerId}) fail-open: ${(err as Error)?.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/**
 * Provider token + factory: pick the cache backend at startup based on
 * `QUOTA_BACKEND` env (default `memory` so existing deploys behave
 * identically until we explicitly flip the flag).
 *
 *   QUOTA_BACKEND=memory  → MemoryQuotaCache (default)
 *   QUOTA_BACKEND=redis   → RedisQuotaCache
 *
 * Any other value logs a warning + falls back to memory. The fallback
 * is deliberate — we'd rather run with the safe per-task cache than
 * fail to boot on a typo'd env var.
 */
export const QUOTA_CACHE = Symbol('QUOTA_CACHE');

export function createQuotaCacheProvider() {
  return {
    provide: QUOTA_CACHE,
    inject: [ConfigService],
    useFactory: (config: ConfigService): IQuotaCache => {
      const backend = (config.get<string>('QUOTA_BACKEND', 'memory') || 'memory')
        .trim()
        .toLowerCase();
      const logger = new Logger('QuotaCacheFactory');
      if (backend === 'redis') {
        logger.log('Quota cache backend: redis (shared, multi-instance safe)');
        return new RedisQuotaCache(config);
      }
      if (backend !== 'memory') {
        logger.warn(
          `Unknown QUOTA_BACKEND="${backend}" — falling back to "memory". ` +
            `Set QUOTA_BACKEND=memory|redis to silence this warning.`,
        );
      } else {
        logger.log('Quota cache backend: memory (per-task; NOT multi-instance safe)');
      }
      return new MemoryQuotaCache();
    },
  };
}
