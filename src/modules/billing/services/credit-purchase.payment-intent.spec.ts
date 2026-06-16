import { BadRequestException } from '@nestjs/common';
import { CreditPurchaseService } from './credit-purchase.service';

const ORG = '11111111-1111-1111-1111-111111111111';

const makeRepo = (initial: any[] = []) => {
  const rows: any[] = initial.map((r) => ({ ...r, id: r.id ?? `r-${Math.random()}` }));
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

const buildService = (params: {
  intentId?: string;
  intentClientSecret?: string | null;
  purchaseRow?: any;
}) => {
  const purchaseRepo = makeRepo(params.purchaseRow ? [params.purchaseRow] : []);
  const balanceRepo = makeRepo([]);
  const stripe = {
    createPaymentIntent: jest.fn(async () => ({
      id: params.intentId ?? 'pi_test',
      client_secret: params.intentClientSecret === undefined ? 'cs_secret' : params.intentClientSecret,
    })),
  };
  const subs = {
    getOrCreateStripeCustomer: jest.fn(async () => 'cus_test_abc'),
  };
  const svc = new CreditPurchaseService(
    purchaseRepo as any,
    balanceRepo as any,
    stripe as any,
    subs as any,
  );
  return { svc, purchaseRepo, balanceRepo, stripe, subs };
};

describe('CreditPurchaseService.createPaymentIntentForCredits', () => {
  it('happy path returns client_secret + customer id + tier price', async () => {
    const { svc, purchaseRepo, stripe } = buildService({});
    const result = await svc.createPaymentIntentForCredits({
      organizationId: ORG,
      email: 'admin@example.com',
      credits: 50,
    });
    expect(result).toMatchObject({
      paymentIntentClientSecret: 'cs_secret',
      paymentIntentId: 'pi_test',
      customerId: 'cus_test_abc',
      credits: 50,
      amountUsd: 20,
    });
    expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 20,
        purpose: 'credit_purchase',
        organizationId: ORG,
      }),
    );
    expect(purchaseRepo.save).toHaveBeenCalled();
    expect(purchaseRepo._rows[0]).toMatchObject({
      organizationId: ORG,
      credits: 50,
      amount: 20,
      status: 'pending',
      stripePaymentIntentId: 'pi_test',
    });
  });

  it('rejects an off-tier credit amount', async () => {
    const { svc } = buildService({});
    await expect(
      svc.createPaymentIntentForCredits({
        organizationId: ORG,
        email: 'a@b.c',
        credits: 7 as any,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when Stripe returns no client_secret', async () => {
    const { svc } = buildService({ intentClientSecret: null });
    await expect(
      svc.createPaymentIntentForCredits({
        organizationId: ORG,
        email: 'a@b.c',
        credits: 50,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CreditPurchaseService.creditFromPaymentIntent', () => {
  it('credits the balance and marks the purchase completed', async () => {
    const { svc, purchaseRepo, balanceRepo } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: ORG,
        credits: 50,
        amount: 20,
        currency: 'USD',
        status: 'pending',
        stripePaymentIntentId: 'pi_test',
      },
    });
    await svc.creditFromPaymentIntent({
      paymentIntentId: 'pi_test',
      organizationId: ORG,
      credits: 50,
    });
    expect(balanceRepo._rows[0]).toMatchObject({
      organizationId: ORG,
      balance: 50,
      lifetimePurchased: 50,
    });
    expect(purchaseRepo._rows[0].status).toBe('completed');
    expect(purchaseRepo._rows[0].completedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — replay returns void without re-crediting', async () => {
    const { svc, balanceRepo } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: ORG,
        credits: 50,
        amount: 20,
        currency: 'USD',
        status: 'completed',
        stripePaymentIntentId: 'pi_test',
      },
    });
    await svc.creditFromPaymentIntent({
      paymentIntentId: 'pi_test',
      organizationId: ORG,
      credits: 50,
    });
    // balanceRepo never modified (still empty).
    expect(balanceRepo._rows).toHaveLength(0);
  });

  it('ignores unknown payment intents (defensive — forged webhooks)', async () => {
    const { svc, balanceRepo } = buildService({});
    await svc.creditFromPaymentIntent({
      paymentIntentId: 'pi_forged',
      organizationId: ORG,
      credits: 9999,
    });
    expect(balanceRepo._rows).toHaveLength(0);
  });

  it('rejects when org_id on the row does not match the webhook (defense-in-depth)', async () => {
    const { svc, balanceRepo, purchaseRepo } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: ORG,
        credits: 50,
        amount: 20,
        currency: 'USD',
        status: 'pending',
        stripePaymentIntentId: 'pi_test',
      },
    });
    await svc.creditFromPaymentIntent({
      paymentIntentId: 'pi_test',
      organizationId: 'other-org',
      credits: 50,
    });
    // Balance untouched; purchase row stays pending.
    expect(balanceRepo._rows).toHaveLength(0);
    expect(purchaseRepo._rows[0].status).toBe('pending');
  });
});
