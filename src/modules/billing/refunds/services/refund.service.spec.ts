import { BadRequestException } from '@nestjs/common';
import { RefundService } from './refund.service';
import type { ActorContext } from '../../types/actor-context';

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
  return {
    _rows: rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      ) ?? null,
    ),
    find: jest.fn(async ({ where, order: _order, take = 20 }: any) =>
      rows
        .filter((r) => r.organizationId === where.organizationId)
        .slice(0, take),
    ),
    create: jest.fn((d: any) => ({
      id: `refund-${rows.length + 1}`,
      createdAt: new Date('2026-06-17T17:00:00Z'),
      updatedAt: new Date('2026-06-17T17:00:00Z'),
      ...d,
    })),
    save: jest.fn(async (e: any) => {
      const i = rows.findIndex((r) => r.id === e.id);
      if (i >= 0) rows[i] = { ...rows[i], ...e };
      else rows.push(e);
      return e;
    }),
  };
};

const buildService = (params: {
  purchaseRow?: any;
  stripeCreate?: any;
  stripeThrows?: Error;
  refundRows?: any[];
} = {}) => {
  const refundsRepo = makeRepo(params.refundRows ?? []);
  const purchasesRepo = makeRepo(params.purchaseRow ? [params.purchaseRow] : []);
  const stripe = {
    createRefund: params.stripeThrows
      ? jest.fn(async () => {
          throw params.stripeThrows;
        })
      : jest.fn(async () =>
          params.stripeCreate ?? {
            id: 're_test_1',
            status: 'pending',
            balance_transaction: 'txn_btxn_1',
            charge: 'ch_test_1',
          },
        ),
  };
  const ledger = {
    append: jest.fn(async (entry: any, _actor: any) => ({
      id: `ledger-${Math.random()}`,
      ...entry,
      balanceAfter: 0,
    })),
  };
  const svc = new RefundService(refundsRepo as any, purchasesRepo as any, stripe as any, ledger as any);
  return { svc, refundsRepo, purchasesRepo, stripe, ledger };
};

const baseInput = (over: Partial<any> = {}) => ({
  organizationId: ORG,
  paymentIntentId: 'pi_test_xyz',
  reason: 'requested_by_customer' as const,
  idempotencyKey: 'idem-1',
  ...over,
});

describe('RefundService.createRefund', () => {
  it('rejects when Idempotency-Key is missing', async () => {
    const { svc } = buildService();
    await expect(
      svc.createRefund(baseInput({ idempotencyKey: undefined }), ADMIN),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects negative amount', async () => {
    const { svc } = buildService();
    await expect(
      svc.createRefund(baseInput({ amountMinorUnits: -100 }), ADMIN),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when amount not specified AND no tracked purchase', async () => {
    const { svc } = buildService(); // no purchaseRow
    await expect(svc.createRefund(baseInput(), ADMIN)).rejects.toThrow(
      /amountMinorUnits is required/,
    );
  });

  it('rejects when purchase belongs to a different org', async () => {
    const { svc } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: 'different-org',
        stripePaymentIntentId: 'pi_test_xyz',
        amount: 20,
        credits: 50,
        currency: 'USD',
      },
    });
    await expect(svc.createRefund(baseInput(), ADMIN)).rejects.toThrow(
      /belongs to a different organization/,
    );
  });

  it('full refund of a credit purchase: returns all credits', async () => {
    const { svc, refundsRepo, stripe } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: ORG,
        stripePaymentIntentId: 'pi_test_xyz',
        amount: 20, // $20
        credits: 50,
        currency: 'USD',
      },
    });
    const result = await svc.createRefund(baseInput(), ADMIN);
    expect(result.amountMinorUnits).toBe(2000);
    expect(result.creditsReturned).toBe(50);
    expect(result.stripeRefundId).toBe('re_test_1');
    expect(stripe.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: 'pi_test_xyz',
        amountMinorUnits: 2000,
        reason: 'requested_by_customer',
        idempotencyKey: 'idem-1',
      }),
    );
    const row = refundsRepo._rows[0];
    expect(row.creditsReturned).toBe(50);
    expect(row.stripeBalanceTransactionId).toBe('txn_btxn_1');
  });

  it('partial refund of a credit purchase: proportional credits', async () => {
    const { svc } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: ORG,
        stripePaymentIntentId: 'pi_test_xyz',
        amount: 20, // $20 = 2000 minor
        credits: 50,
        currency: 'USD',
      },
    });
    const result = await svc.createRefund(
      baseInput({ amountMinorUnits: 800 }), // 40% of 2000
      ADMIN,
    );
    expect(result.amountMinorUnits).toBe(800);
    expect(result.creditsReturned).toBe(20); // 40% of 50
  });

  it('idempotent replay returns existing row without calling Stripe', async () => {
    const { svc, stripe } = buildService({
      refundRows: [
        {
          id: 'existing',
          organizationId: ORG,
          originalPaymentIntentId: 'pi_test_xyz',
          stripeRefundId: 're_existing',
          amountMinorUnits: '2000',
          currency: 'USD',
          reason: 'requested_by_customer',
          status: 'succeeded',
          creditsReturned: 50,
          failureReason: null,
          createdAt: new Date('2026-06-17T16:30:00Z'),
          idempotencyKey: 'idem-1',
        },
      ],
    });
    const result = await svc.createRefund(baseInput(), ADMIN);
    expect(result.id).toBe('existing');
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });

  it('marks row as failed if Stripe call throws', async () => {
    const { svc, refundsRepo } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: ORG,
        stripePaymentIntentId: 'pi_test_xyz',
        amount: 20,
        credits: 50,
        currency: 'USD',
      },
      stripeThrows: new Error('Stripe down'),
    });
    await expect(svc.createRefund(baseInput(), ADMIN)).rejects.toThrow('Stripe down');
    expect(refundsRepo._rows[0].status).toBe('failed');
    expect(refundsRepo._rows[0].failureReason).toBe('Stripe down');
  });

  it('posts ledger debit when Stripe synchronously succeeds', async () => {
    const { svc, ledger } = buildService({
      purchaseRow: {
        id: 'p1',
        organizationId: ORG,
        stripePaymentIntentId: 'pi_test_xyz',
        amount: 20,
        credits: 50,
        currency: 'USD',
      },
      stripeCreate: { id: 're_test_1', status: 'succeeded', balance_transaction: 'txn_btxn_1', charge: 'ch_1' },
    });
    await svc.createRefund(baseInput(), ADMIN);
    expect(ledger.append).toHaveBeenCalled();
    const entry = ledger.append.mock.calls[0][0];
    expect(entry.kind).toBe('REFUND');
    expect(entry.deltaCredits).toBe(-50);
    expect(entry.stripeBalanceTransactionId).toBe('txn_btxn_1');
  });
});

describe('RefundService.onRefundEvent', () => {
  const makeEvent = (refund: any, type = 'refund.updated'): any => ({
    type,
    id: 'evt_1',
    data: { object: refund },
  });

  it('no-ops if the internal row does not exist', async () => {
    const { svc, ledger } = buildService();
    await svc.onRefundEvent(makeEvent({ id: 're_unknown', status: 'succeeded' }));
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('pending → succeeded posts the ledger REFUND entry', async () => {
    const { svc, refundsRepo, ledger } = buildService({
      refundRows: [
        {
          id: 'r1',
          organizationId: ORG,
          stripeRefundId: 're_1',
          originalPaymentIntentId: 'pi_1',
          originalChargeId: 'ch_1',
          amountMinorUnits: '2000',
          currency: 'USD',
          reason: 'requested_by_customer',
          status: 'pending',
          creditsReturned: 50,
          actorUserId: 'admin-1',
          internalNote: null,
          stripeBalanceTransactionId: 'txn_btxn_1',
        },
      ],
    });
    await svc.onRefundEvent(makeEvent({ id: 're_1', status: 'succeeded', balance_transaction: 'txn_btxn_1' }));
    expect(refundsRepo._rows[0].status).toBe('succeeded');
    expect(ledger.append).toHaveBeenCalledTimes(1);
    const entry = ledger.append.mock.calls[0][0];
    expect(entry.kind).toBe('REFUND');
    expect(entry.deltaCredits).toBe(-50);
    expect(entry.idempotencyKey).toBe('refund:r1');
  });

  it('pending → failed flips status (no ledger entry)', async () => {
    const { svc, refundsRepo, ledger } = buildService({
      refundRows: [
        {
          id: 'r1',
          organizationId: ORG,
          stripeRefundId: 're_1',
          originalPaymentIntentId: 'pi_1',
          amountMinorUnits: '2000',
          currency: 'USD',
          reason: 'duplicate',
          status: 'pending',
          creditsReturned: 50,
          actorUserId: 'admin-1',
        },
      ],
    });
    await svc.onRefundEvent(
      makeEvent({ id: 're_1', status: 'failed', failure_reason: 'declined' }),
    );
    expect(refundsRepo._rows[0].status).toBe('failed');
    expect(refundsRepo._rows[0].failureReason).toBe('declined');
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('succeeded → failed race posts a REVERSAL entry', async () => {
    const { svc, refundsRepo, ledger } = buildService({
      refundRows: [
        {
          id: 'r1',
          organizationId: ORG,
          stripeRefundId: 're_1',
          originalPaymentIntentId: 'pi_1',
          amountMinorUnits: '2000',
          currency: 'USD',
          reason: 'requested_by_customer',
          status: 'succeeded', // already debited
          creditsReturned: 50,
          ledgerEntryId: 'ledger-old',
          actorUserId: 'admin-1',
        },
      ],
    });
    await svc.onRefundEvent(makeEvent({ id: 're_1', status: 'failed', failure_reason: 'race' }));
    expect(refundsRepo._rows[0].status).toBe('failed');
    expect(ledger.append).toHaveBeenCalledTimes(1);
    const entry = ledger.append.mock.calls[0][0];
    expect(entry.kind).toBe('REVERSAL');
    expect(entry.deltaCredits).toBe(50); // POSITIVE — undo the original -50
  });

  it('idempotent for repeated succeeded webhooks (only one ledger entry)', async () => {
    const { svc, ledger } = buildService({
      refundRows: [
        {
          id: 'r1',
          organizationId: ORG,
          stripeRefundId: 're_1',
          originalPaymentIntentId: 'pi_1',
          amountMinorUnits: '2000',
          currency: 'USD',
          reason: 'requested_by_customer',
          status: 'succeeded', // already at terminal state
          creditsReturned: 50,
          ledgerEntryId: 'ledger-prior',
          actorUserId: 'admin-1',
        },
      ],
    });
    await svc.onRefundEvent(makeEvent({ id: 're_1', status: 'succeeded', balance_transaction: 'txn_btxn_1' }));
    // No new ledger entry — the row was already succeeded.
    expect(ledger.append).not.toHaveBeenCalled();
  });
});
