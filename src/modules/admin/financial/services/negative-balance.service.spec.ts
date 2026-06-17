import { ConflictException, NotFoundException } from '@nestjs/common';
import { NegativeBalanceService } from './negative-balance.service';
import type { ActorContext } from '../../../billing/types/actor-context';

const ORG = '11111111-1111-1111-1111-111111111111';
const ADMIN: ActorContext = {
  kind: 'ADMIN',
  userId: 'admin-1',
  ip: '127.0.0.1',
  userAgent: 'jest',
  requestId: 'req-1',
};

const makeRepo = (initial: any[] = []) => {
  const rows: any[] = initial.map((r) => ({ ...r }));
  let seq = rows.length;
  return {
    _rows: rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      ) ?? null,
    ),
    create: jest.fn((d: any) => ({ id: `row-${++seq}`, ...d })),
    save: jest.fn(async (e: any) => {
      const i = rows.findIndex((r) => r.id === e.id);
      if (i >= 0) rows[i] = { ...rows[i], ...e };
      else rows.push(e);
      return e;
    }),
  };
};

const buildService = (opts: {
  balance?: number;
  autoTopup?: any;
  org?: any;
  stripeStatus?: string;
  stripeThrows?: Error;
} = {}) => {
  const balances = makeRepo(
    opts.balance !== undefined
      ? [{ organizationId: ORG, balance: opts.balance }]
      : [],
  );
  const autoTopups = makeRepo(opts.autoTopup ? [opts.autoTopup] : []);
  const orgs = makeRepo(
    opts.org ? [opts.org] : [{ id: ORG, name: 'Test Org' }],
  );
  const ledger = {
    append: jest.fn(async (entry: any, _actor: any) => ({
      id: `ledger-${Math.random()}`,
      ...entry,
      balanceAfter: (opts.balance ?? 0) + entry.deltaCredits,
    })),
  };
  const stripe = {
    createPaymentIntent: opts.stripeThrows
      ? jest.fn(async () => {
          throw opts.stripeThrows;
        })
      : jest.fn(async () => ({
          id: 'pi_test_arrears_1',
          status: opts.stripeStatus ?? 'succeeded',
          client_secret: 'cs_test',
        })),
  };
  const subscriptions = {} as any;
  const svc = new NegativeBalanceService(
    autoTopups as any,
    balances as any,
    orgs as any,
    ledger as any,
    stripe as any,
    subscriptions,
  );
  return { svc, balances, autoTopups, orgs, ledger, stripe };
};

describe('NegativeBalanceService.preview', () => {
  it('reports zero deficit when balance is non-negative', async () => {
    const { svc } = buildService({ balance: 50 });
    const out = await svc.preview(ORG);
    expect(out.currentBalance).toBe(50);
    expect(out.deficitCredits).toBe(0);
    expect(out.chargeUsdCents).toBe(0);
    expect(out.canSettle).toBe(false);
    expect(out.reasonCannotSettle).toMatch(/non-negative/i);
  });

  it('computes deficit + USD charge at the default rate', async () => {
    const { svc } = buildService({
      balance: -10,
      autoTopup: {
        organizationId: ORG,
        stripeCustomerId: 'cus_test_1',
        stripePaymentMethodId: 'pm_test_1',
        suspendedReason: 'negative_balance',
      },
    });
    const out = await svc.preview(ORG);
    expect(out.currentBalance).toBe(-10);
    expect(out.deficitCredits).toBe(10);
    expect(out.chargeUsdCents).toBe(400); // 10 * 40¢
    expect(out.chargeUsd).toBe(4.0);
    expect(out.canSettle).toBe(true);
    expect(out.suspendedReason).toBe('negative_balance');
  });

  it('refuses when no Stripe customer is on file', async () => {
    const { svc } = buildService({
      balance: -5,
      autoTopup: { organizationId: ORG, stripePaymentMethodId: 'pm_x' },
    });
    const out = await svc.preview(ORG);
    expect(out.canSettle).toBe(false);
    expect(out.reasonCannotSettle).toMatch(/no Stripe customer/i);
  });

  it('refuses when no saved payment method is on file', async () => {
    const { svc } = buildService({
      balance: -5,
      autoTopup: { organizationId: ORG, stripeCustomerId: 'cus_x' },
    });
    const out = await svc.preview(ORG);
    expect(out.canSettle).toBe(false);
    expect(out.reasonCannotSettle).toMatch(/no saved payment method/i);
  });
});

describe('NegativeBalanceService.settleArrears', () => {
  const okAutoTopup = {
    organizationId: ORG,
    stripeCustomerId: 'cus_test_1',
    stripePaymentMethodId: 'pm_test_1',
    suspendedReason: 'negative_balance',
  };

  it('rejects without Idempotency-Key', async () => {
    const { svc } = buildService({ balance: -10, autoTopup: okAutoTopup });
    await expect(svc.settleArrears(ORG, ADMIN, '')).rejects.toThrow();
  });

  it('404s when the org does not exist', async () => {
    const { svc } = buildService({
      balance: -10,
      autoTopup: okAutoTopup,
      org: null,
    });
    // org repo has only the default org (id=ORG); use a different id.
    await expect(
      svc.settleArrears('99999999-9999-9999-9999-999999999999', ADMIN, 'idem-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('409s when balance is non-negative', async () => {
    const { svc, stripe, ledger } = buildService({
      balance: 5,
      autoTopup: okAutoTopup,
    });
    await expect(svc.settleArrears(ORG, ADMIN, 'idem-1')).rejects.toThrow(
      ConflictException,
    );
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('409s when no payment method is on file', async () => {
    const { svc, stripe } = buildService({
      balance: -10,
      autoTopup: { organizationId: ORG, stripeCustomerId: 'cus_x' },
    });
    await expect(svc.settleArrears(ORG, ADMIN, 'idem-1')).rejects.toThrow(
      ConflictException,
    );
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('happy path: Stripe succeeds → MANUAL_TOPUP posted + suspension cleared', async () => {
    const { svc, stripe, ledger, autoTopups } = buildService({
      balance: -10,
      autoTopup: okAutoTopup,
    });
    const out = await svc.settleArrears(ORG, ADMIN, 'idem-1');

    expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test_1',
        paymentMethodId: 'pm_test_1',
        offSession: true,
        amountUsd: 4.0,
      }),
    );
    expect(ledger.append).toHaveBeenCalledTimes(1);
    const ledgerCall = ledger.append.mock.calls[0][0];
    expect(ledgerCall).toMatchObject({
      kind: 'MANUAL_TOPUP',
      reasonCode: 'MANUAL_REFUND_RECOVERY',
      deltaCredits: 10,
      amountMinorUnits: 400,
      idempotencyKey: `arrears-settle:${ORG}:idem-1`,
    });
    expect(out.balanceBefore).toBe(-10);
    expect(out.balanceAfter).toBe(0);
    expect(out.creditsTopped).toBe(10);
    expect(out.chargeUsdCents).toBe(400);
    expect(out.stripeStatus).toBe('succeeded');
    expect(out.suspensionCleared).toBe(true);
    expect(autoTopups._rows[0].suspendedReason).toBeNull();
  });

  it('Stripe returns requires_action → no ledger row + suspension stays', async () => {
    const { svc, ledger, autoTopups } = buildService({
      balance: -10,
      autoTopup: okAutoTopup,
      stripeStatus: 'requires_action',
    });
    await expect(svc.settleArrears(ORG, ADMIN, 'idem-1')).rejects.toThrow(
      ConflictException,
    );
    expect(ledger.append).not.toHaveBeenCalled();
    expect(autoTopups._rows[0].suspendedReason).toBe('negative_balance');
  });

  it('Stripe API throws → error propagates, no ledger row', async () => {
    const { svc, ledger } = buildService({
      balance: -10,
      autoTopup: okAutoTopup,
      stripeThrows: new Error('Stripe is having a moment'),
    });
    await expect(svc.settleArrears(ORG, ADMIN, 'idem-1')).rejects.toThrow(
      /Stripe is having/,
    );
    expect(ledger.append).not.toHaveBeenCalled();
  });
});

describe('NegativeBalanceService.unsuspendAutoTopup', () => {
  it('404s when no auto-topup row exists for the org', async () => {
    const { svc } = buildService({});
    await expect(svc.unsuspendAutoTopup(ORG)).rejects.toThrow(NotFoundException);
  });

  it('no-op when suspension is already cleared', async () => {
    const { svc, autoTopups } = buildService({
      autoTopup: {
        organizationId: ORG,
        stripeCustomerId: 'cus_x',
        suspendedReason: null,
      },
    });
    const out = await svc.unsuspendAutoTopup(ORG);
    expect(out.cleared).toBe(false);
    expect(autoTopups._rows[0].suspendedReason).toBeNull();
  });

  it('clears suspension and returns cleared=true', async () => {
    const { svc, autoTopups } = buildService({
      autoTopup: {
        organizationId: ORG,
        stripeCustomerId: 'cus_x',
        suspendedReason: 'negative_balance',
      },
    });
    const out = await svc.unsuspendAutoTopup(ORG);
    expect(out.cleared).toBe(true);
    expect(autoTopups._rows[0].suspendedReason).toBeNull();
  });
});
