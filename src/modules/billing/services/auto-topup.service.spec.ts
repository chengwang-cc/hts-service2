import { ConfigService } from '@nestjs/config';
import { AutoTopupService } from './auto-topup.service';
import { CreditPurchaseService } from './credit-purchase.service';

const ORG = '11111111-1111-1111-1111-111111111111';

const makeRepo = (initial: any[] = []) => {
  const rows: any[] = initial.map((r) => ({ ...r }));
  return {
    _rows: rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      ) ?? null,
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (entity: any) => {
      const i = rows.findIndex((r) => r.id === entity.id);
      if (i >= 0) rows[i] = { ...rows[i], ...entity };
      else rows.push({ id: `r-${rows.length + 1}`, ...entity });
      return entity;
    }),
  };
};

const stubRedis = (lockAcquired = true) => ({
  on: jest.fn(),
  set: jest.fn(async () => (lockAcquired ? 'OK' : null)),
  del: jest.fn(async () => 1),
});

const buildService = (params: {
  config?: any | null;
  balance?: any | null;
  lockAcquired?: boolean;
  createIntent?: jest.Mock;
  getOrCreateCustomer?: jest.Mock;
  redisThrows?: boolean;
}) => {
  const configs = makeRepo(params.config ? [params.config] : []);
  const balances = makeRepo(params.balance ? [params.balance] : []);
  const creditPurchaseRepo = makeRepo();
  const credits = {
    creditPurchaseRepo,
  } as any;
  const subs = {
    getOrCreateStripeCustomer:
      params.getOrCreateCustomer ?? jest.fn(async () => 'cus_test_abc'),
  };
  const stripe = {
    createPaymentIntent:
      params.createIntent ?? jest.fn(async () => ({ id: 'pi_test_xyz' })),
  };
  const config = new ConfigService({ REDIS_URL: 'redis://localhost:0' });
  const svc = new AutoTopupService(
    configs as any,
    balances as any,
    credits as any,
    subs as any,
    stripe as any,
    config,
  );
  // Replace the auto-created Redis client with a stub.
  const redis = stubRedis(params.lockAcquired ?? true);
  if (params.redisThrows) {
    redis.set = jest.fn(async () => {
      throw new Error('redis down');
    });
  }
  (svc as any).redis = redis;
  return { svc, configs, balances, creditPurchaseRepo, stripe, subs, redis };
};

describe('AutoTopupService.maybeTrigger', () => {
  it('no-op when no config exists', async () => {
    const { svc } = buildService({});
    expect(await svc.maybeTrigger(ORG)).toBe(false);
  });

  it('no-op when config is disabled', async () => {
    const { svc, stripe } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: false,
        triggerThreshold: 5,
        rechargeAmount: 50,
        stripePaymentMethodId: 'pm_test',
      },
      balance: { id: 'b1', organizationId: ORG, balance: 0 },
    });
    expect(await svc.maybeTrigger(ORG)).toBe(false);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('no-op when no payment method is saved', async () => {
    const { svc, stripe } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: true,
        triggerThreshold: 5,
        rechargeAmount: 50,
        stripePaymentMethodId: null,
      },
      balance: { id: 'b1', organizationId: ORG, balance: 0 },
    });
    expect(await svc.maybeTrigger(ORG)).toBe(false);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('no-op when balance is at/above threshold', async () => {
    const { svc, stripe } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: true,
        triggerThreshold: 5,
        rechargeAmount: 50,
        stripePaymentMethodId: 'pm_test',
      },
      balance: { id: 'b1', organizationId: ORG, balance: 5 },
    });
    expect(await svc.maybeTrigger(ORG)).toBe(false);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('fires when balance is below threshold and config is enabled', async () => {
    const createIntent = jest.fn(async () => ({ id: 'pi_test_xyz' }));
    const { svc, stripe, configs, creditPurchaseRepo } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: true,
        triggerThreshold: 5,
        rechargeAmount: 50,
        stripePaymentMethodId: 'pm_test',
        stripeCustomerId: 'cus_existing',
        totalAutoPurchases: 0,
        currentMonth: 1,
        currentYear: 2026,
        currentMonthSpent: 0,
      },
      balance: { id: 'b1', organizationId: ORG, balance: 2 },
      createIntent,
    });
    expect(await svc.maybeTrigger(ORG)).toBe(true);
    expect(stripe.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(stripe.createPaymentIntent.mock.calls[0][0]).toMatchObject({
      purpose: 'auto_topup',
      offSession: true,
      amountUsd: 20, // tier 50 → $20
    });

    // A pending purchase row was created so the webhook routes through
    // the same idempotent code path as a manual purchase.
    expect(creditPurchaseRepo.save).toHaveBeenCalled();
    const saved = creditPurchaseRepo._rows[0];
    expect(saved.stripePaymentIntentId).toBe('pi_test_xyz');
    expect(saved.status).toBe('pending');

    // Config bumped: totalAutoPurchases++, lastTriggeredAt set.
    expect(configs._rows[0].totalAutoPurchases).toBe(1);
    expect(configs._rows[0].lastTriggeredAt).toBeInstanceOf(Date);
  });

  it('single-flight: a contended lock prevents firing', async () => {
    const createIntent = jest.fn(async () => ({ id: 'pi_test_xyz' }));
    const { svc, stripe } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: true,
        triggerThreshold: 5,
        rechargeAmount: 50,
        stripePaymentMethodId: 'pm_test',
        stripeCustomerId: 'cus',
      },
      balance: { id: 'b1', organizationId: ORG, balance: 0 },
      createIntent,
      lockAcquired: false,
    });
    expect(await svc.maybeTrigger(ORG)).toBe(false);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('fails closed when Redis is unreachable (does not double-charge)', async () => {
    const createIntent = jest.fn(async () => ({ id: 'pi_test_xyz' }));
    const { svc, stripe } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: true,
        triggerThreshold: 5,
        rechargeAmount: 50,
        stripePaymentMethodId: 'pm_test',
        stripeCustomerId: 'cus',
      },
      balance: { id: 'b1', organizationId: ORG, balance: 0 },
      createIntent,
      redisThrows: true,
    });
    expect(await svc.maybeTrigger(ORG)).toBe(false);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('respects monthly spending cap', async () => {
    const createIntent = jest.fn(async () => ({ id: 'pi_test_xyz' }));
    const now = new Date();
    const { svc, stripe } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: true,
        triggerThreshold: 5,
        rechargeAmount: 50, // $20
        monthlySpendingCap: 30, // already spent $20 this month → next $20 would exceed
        stripePaymentMethodId: 'pm_test',
        stripeCustomerId: 'cus',
        currentMonth: now.getMonth() + 1,
        currentYear: now.getFullYear(),
        currentMonthSpent: 20,
      },
      balance: { id: 'b1', organizationId: ORG, balance: 0 },
      createIntent,
    });
    expect(await svc.maybeTrigger(ORG)).toBe(false);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('absorbs all errors (never throws) — returns false on internal failure', async () => {
    const { svc } = buildService({
      config: {
        id: 'c1',
        organizationId: ORG,
        enabled: true,
        triggerThreshold: 5,
        rechargeAmount: 50,
        stripePaymentMethodId: 'pm_test',
        stripeCustomerId: 'cus',
      },
      balance: { id: 'b1', organizationId: ORG, balance: 0 },
      createIntent: jest.fn(async () => {
        throw new Error('stripe down');
      }),
    });
    await expect(svc.maybeTrigger(ORG)).resolves.toBe(false);
  });
});
