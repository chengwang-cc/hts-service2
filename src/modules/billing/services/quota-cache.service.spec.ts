import { ConfigService } from '@nestjs/config';
import {
  createQuotaCacheProvider,
  IQuotaCache,
  MemoryQuotaCache,
  QuotaSnapshot,
  QUOTA_CACHE,
} from './quota-cache.service';

const baseSnapshot = (overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot => ({
  limits: {
    perMinute: 60,
    perDay: 10_000,
    requestsPerMonth: 10_000,
    costUsdPerMonth: null,
    plan: 'STARTER',
    source: 'plan',
    syncedAt: new Date().toISOString(),
  },
  orgType: 'customer',
  requestsThisMonth: 0,
  costUsdThisMonth: 0,
  syncedAt: Date.now(),
  ...overrides,
});

describe('MemoryQuotaCache', () => {
  let cache: MemoryQuotaCache;

  beforeEach(() => {
    cache = new MemoryQuotaCache();
    jest.useRealTimers();
  });

  it('declares the "memory" backend identifier', () => {
    expect(cache.backend).toBe('memory');
  });

  it('returns null on a miss', async () => {
    expect(await cache.get('org-1')).toBeNull();
  });

  it('round-trips a snapshot for the same partnerId', async () => {
    const snap = baseSnapshot({ requestsThisMonth: 42 });
    await cache.set('org-1', snap);
    const read = await cache.get('org-1');
    expect(read?.requestsThisMonth).toBe(42);
  });

  it('isolates entries by partnerId', async () => {
    await cache.set('org-A', baseSnapshot({ requestsThisMonth: 1 }));
    await cache.set('org-B', baseSnapshot({ requestsThisMonth: 999 }));
    expect((await cache.get('org-A'))?.requestsThisMonth).toBe(1);
    expect((await cache.get('org-B'))?.requestsThisMonth).toBe(999);
  });

  it('expires entries after the TTL (30 s)', async () => {
    jest.useFakeTimers();
    await cache.set('org-1', baseSnapshot({ requestsThisMonth: 5 }));
    expect(await cache.get('org-1')).not.toBeNull();
    jest.advanceTimersByTime(30_001);
    expect(await cache.get('org-1')).toBeNull();
  });

  it('the MEMORY backend does NOT share state — this is the bug Redis fixes', async () => {
    // Two MemoryQuotaCache instances stand in for "two ECS tasks" in
    // the existing single-task deploy model. Each tracks its own
    // snapshot; they never see each other's writes. The Redis backend's
    // contract is the opposite — see the redis spec below.
    const taskA = new MemoryQuotaCache();
    const taskB = new MemoryQuotaCache();
    await taskA.set('org-1', baseSnapshot({ requestsThisMonth: 9_999 }));
    expect(await taskA.get('org-1')).not.toBeNull();
    expect(await taskB.get('org-1')).toBeNull(); // <-- the race window
  });
});

/**
 * RedisQuotaCache integration sketch — kept as a unit-level test with a
 * mocked ioredis surface so it runs in CI without a Redis server. The
 * tighter integration spec (a real ioredis-mock) lives under
 * tests/integration; this guards the public contract.
 */
describe('RedisQuotaCache (mocked)', () => {
  let store: Map<string, { value: string; expiresAt: number }>;
  let cache: IQuotaCache;

  beforeEach(() => {
    store = new Map();
    // Build a tiny ioredis-shaped mock that supports get/set with EX
    // — enough for the cache's public API. The actual class wires this
    // in its constructor; we substitute the redis client by hand to
    // exercise the same get/set code paths without a network call.
    const mockRedis = {
      get: jest.fn(async (key: string) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
          store.delete(key);
          return null;
        }
        return entry.value;
      }),
      set: jest.fn(async (key: string, value: string, _ex: string, ttlS: number) => {
        store.set(key, { value, expiresAt: Date.now() + ttlS * 1000 });
        return 'OK';
      }),
      on: jest.fn(),
      quit: jest.fn(async () => 'OK'),
    };

    // Use the dynamic factory so we exercise the same provider wiring
    // that runs in production.
    const provider = createQuotaCacheProvider();
    const config = new ConfigService({ QUOTA_BACKEND: 'redis' });
    const built = provider.useFactory(config) as IQuotaCache;
    // Replace the internal redis instance with the mock for assertions.
    (built as any).redis = mockRedis;
    cache = built;
  });

  it('declares the "redis" backend identifier', () => {
    expect(cache.backend).toBe('redis');
  });

  it('returns null when no snapshot is stored', async () => {
    expect(await cache.get('org-1')).toBeNull();
  });

  it('round-trips a snapshot via the mocked store', async () => {
    const snap = baseSnapshot({ requestsThisMonth: 7 });
    await cache.set('org-1', snap);
    const read = await cache.get('org-1');
    expect(read?.requestsThisMonth).toBe(7);
  });

  it('the REDIS backend DOES share state — two "tasks" see the same snapshot', async () => {
    // The provider returns a singleton per factory call, so to simulate
    // two ECS tasks we point two cache instances at the SAME mock store
    // (which is what a real Redis would be). This proves the contract
    // that fixes the multi-instance bug.
    const taskA = (createQuotaCacheProvider().useFactory(
      new ConfigService({ QUOTA_BACKEND: 'redis' }),
    ) as any) as IQuotaCache;
    const taskB = (createQuotaCacheProvider().useFactory(
      new ConfigService({ QUOTA_BACKEND: 'redis' }),
    ) as any) as IQuotaCache;
    const sharedMock = (cache as any).redis;
    (taskA as any).redis = sharedMock;
    (taskB as any).redis = sharedMock;

    await taskA.set('org-1', baseSnapshot({ requestsThisMonth: 9_999 }));
    const readByB = await taskB.get('org-1');
    expect(readByB?.requestsThisMonth).toBe(9_999);
  });

  it('fails open (returns null, does not throw) when the mock get errors', async () => {
    (cache as any).redis.get = jest.fn(async () => {
      throw new Error('connection reset');
    });
    expect(await cache.get('org-1')).toBeNull();
  });

  it('fails open (does not throw) when the mock set errors', async () => {
    (cache as any).redis.set = jest.fn(async () => {
      throw new Error('connection reset');
    });
    await expect(cache.set('org-1', baseSnapshot())).resolves.toBeUndefined();
  });
});

describe('createQuotaCacheProvider — env-driven backend selection', () => {
  const buildWith = (envValue: string | undefined) => {
    const provider = createQuotaCacheProvider();
    const config = new ConfigService({ QUOTA_BACKEND: envValue });
    return provider.useFactory(config);
  };

  it('defaults to memory when QUOTA_BACKEND is unset', () => {
    expect(buildWith(undefined).backend).toBe('memory');
  });

  it('chooses memory for QUOTA_BACKEND=memory', () => {
    expect(buildWith('memory').backend).toBe('memory');
  });

  it('chooses redis for QUOTA_BACKEND=redis', () => {
    expect(buildWith('redis').backend).toBe('redis');
  });

  it('is case- and whitespace-tolerant for typos', () => {
    expect(buildWith(' Redis ').backend).toBe('redis');
    expect(buildWith('MEMORY').backend).toBe('memory');
  });

  it('falls back to memory on an unknown value (does not throw on a typo)', () => {
    expect(buildWith('rediss').backend).toBe('memory');
    expect(buildWith('reddis').backend).toBe('memory');
  });
});
