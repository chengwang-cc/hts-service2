import { ConflictException } from '@nestjs/common';
import { DisputeService } from './dispute.service';
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
  let _seq = rows.length;
  return {
    _rows: rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      ) ?? null,
    ),
    find: jest.fn(async ({ where, order: _o, take = 50 }: any) =>
      rows
        .filter((r) =>
          Object.entries(where ?? {}).every(([k, v]) => r[k] === v),
        )
        .slice(0, take),
    ),
    create: jest.fn((d: any) => ({
      id: `dispute-${++_seq}`,
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
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => rows),
    })),
  };
};

const buildService = (params: {
  purchaseRows?: any[];
  disputeRows?: any[];
  stripeSubmit?: any;
  stripeSubmitThrows?: Error;
} = {}) => {
  const disputesRepo = makeRepo(params.disputeRows ?? []);
  const purchasesRepo = makeRepo(params.purchaseRows ?? []);
  const stripe = {
    submitDisputeEvidence: params.stripeSubmitThrows
      ? jest.fn(async () => {
          throw params.stripeSubmitThrows;
        })
      : jest.fn(async () =>
          params.stripeSubmit ?? {
            id: 'dp_test_1',
            status: 'under_review',
            evidence: { customer_communication: 'sent' },
          },
        ),
    getDispute: jest.fn(),
  };
  const ledger = {
    append: jest.fn(async (entry: any) => ({
      id: `ledger-${Math.random()}`,
      ...entry,
      balanceAfter: 0,
    })),
  };
  const autoTopup = {
    disable: jest.fn(async () => undefined),
  };
  const svc = new DisputeService(
    disputesRepo as any,
    purchasesRepo as any,
    stripe as any,
    ledger as any,
    autoTopup as any,
  );
  return { svc, disputesRepo, purchasesRepo, stripe, ledger, autoTopup };
};

const baseStripeDispute = (over: Partial<any> = {}) => ({
  id: 'dp_test_1',
  charge: 'ch_test_1',
  payment_intent: 'pi_test_xyz',
  amount: 6000,
  currency: 'usd',
  reason: 'fraudulent',
  status: 'needs_response',
  is_charge_refundable: false,
  evidence: {},
  evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
  ...over,
});

describe('DisputeService.onDisputeEvent', () => {
  it('charge.dispute.created → INSERT row + freeze auto-topup', async () => {
    const { svc, disputesRepo, autoTopup } = buildService({
      purchaseRows: [
        {
          id: 'p1',
          organizationId: ORG,
          stripePaymentIntentId: 'pi_test_xyz',
          credits: 100,
        },
      ],
    });

    await svc.onDisputeEvent({
      id: 'evt_1',
      type: 'charge.dispute.created',
      data: { object: baseStripeDispute() },
    } as any);

    expect(disputesRepo._rows).toHaveLength(1);
    expect(disputesRepo._rows[0]).toMatchObject({
      organizationId: ORG,
      stripeDisputeId: 'dp_test_1',
      stripeChargeId: 'ch_test_1',
      stripePaymentIntentId: 'pi_test_xyz',
      amountMinorUnits: '6000',
      currency: 'USD',
      reason: 'fraudulent',
      stripeStatus: 'needs_response',
      internalState: 'OPEN',
      submissionCount: 0,
    });
    expect(autoTopup.disable).toHaveBeenCalledWith(ORG);
  });

  it('charge.dispute.created → dropped silently if charge maps to no org', async () => {
    const { svc, disputesRepo, autoTopup } = buildService({
      purchaseRows: [], // no matching purchase
    });

    await svc.onDisputeEvent({
      id: 'evt_1',
      type: 'charge.dispute.created',
      data: { object: baseStripeDispute() },
    } as any);

    expect(disputesRepo._rows).toHaveLength(0);
    expect(autoTopup.disable).not.toHaveBeenCalled();
  });

  it('charge.dispute.created → idempotent replay leaves a single row', async () => {
    const { svc, disputesRepo } = buildService({
      purchaseRows: [
        {
          id: 'p1',
          organizationId: ORG,
          stripePaymentIntentId: 'pi_test_xyz',
          credits: 100,
        },
      ],
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          stripeChargeId: 'ch_test_1',
          internalState: 'OPEN',
        },
      ],
    });
    await svc.onDisputeEvent({
      id: 'evt_replay',
      type: 'charge.dispute.created',
      data: { object: baseStripeDispute() },
    } as any);
    expect(disputesRepo._rows).toHaveLength(1);
  });

  it('charge.dispute.funds_withdrawn → CHARGEBACK ledger row + funds_withdrawn_at stamped', async () => {
    const purchase = {
      id: 'p1',
      organizationId: ORG,
      stripePaymentIntentId: 'pi_test_xyz',
      credits: 100,
    };
    const { svc, disputesRepo, ledger } = buildService({
      purchaseRows: [purchase],
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          stripeChargeId: 'ch_test_1',
          stripePaymentIntentId: 'pi_test_xyz',
          amountMinorUnits: '6000',
          currency: 'USD',
          internalState: 'OPEN',
          fundsWithdrawnAt: null,
          submissionCount: 0,
        },
      ],
    });

    await svc.onDisputeEvent({
      id: 'evt_2',
      type: 'charge.dispute.funds_withdrawn',
      data: { object: baseStripeDispute() },
    } as any);

    expect(ledger.append).toHaveBeenCalledTimes(1);
    const call = ledger.append.mock.calls[0][0];
    expect(call.kind).toBe('CHARGEBACK');
    expect(call.deltaCredits).toBe(-100);
    expect(call.idempotencyKey).toBe('dispute-chargeback:dispute-1');

    expect(disputesRepo._rows[0].fundsWithdrawnAt).toBeInstanceOf(Date);
    expect(disputesRepo._rows[0].chargebackLedgerEntryId).toBeTruthy();
  });

  it('charge.dispute.funds_withdrawn → idempotent (no double-debit if replayed)', async () => {
    const purchase = {
      id: 'p1',
      organizationId: ORG,
      stripePaymentIntentId: 'pi_test_xyz',
      credits: 100,
    };
    const alreadyDebited = new Date('2026-06-17T16:00:00Z');
    const { svc, ledger } = buildService({
      purchaseRows: [purchase],
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          stripeChargeId: 'ch_test_1',
          stripePaymentIntentId: 'pi_test_xyz',
          amountMinorUnits: '6000',
          currency: 'USD',
          internalState: 'OPEN',
          fundsWithdrawnAt: alreadyDebited,
          chargebackLedgerEntryId: 'ledger-prior',
        },
      ],
    });

    await svc.onDisputeEvent({
      id: 'evt_replay',
      type: 'charge.dispute.funds_withdrawn',
      data: { object: baseStripeDispute() },
    } as any);

    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('charge.dispute.updated → mirrors stripe_status + evidence_due_by', async () => {
    const newDueBy = Math.floor(Date.now() / 1000) + 5 * 24 * 3600;
    const { svc, disputesRepo } = buildService({
      purchaseRows: [
        {
          id: 'p1',
          organizationId: ORG,
          stripePaymentIntentId: 'pi_test_xyz',
          credits: 100,
        },
      ],
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          stripeChargeId: 'ch_test_1',
          stripePaymentIntentId: 'pi_test_xyz',
          stripeStatus: 'needs_response',
          internalState: 'OPEN',
          evidence: {},
          submissionCount: 0,
        },
      ],
    });

    await svc.onDisputeEvent({
      id: 'evt_3',
      type: 'charge.dispute.updated',
      data: {
        object: baseStripeDispute({
          status: 'under_review',
          evidence_details: { due_by: newDueBy },
          evidence: { customer_communication: 'we have logs' },
        }),
      },
    } as any);

    const row = disputesRepo._rows[0];
    expect(row.stripeStatus).toBe('under_review');
    expect(row.evidenceDueBy?.getTime()).toBe(newDueBy * 1000);
    expect(row.evidence).toEqual({ customer_communication: 'we have logs' });
  });

  it('charge.dispute.closed (won) → REVERSAL row + internal_state=WON', async () => {
    const purchase = {
      id: 'p1',
      organizationId: ORG,
      stripePaymentIntentId: 'pi_test_xyz',
      credits: 100,
    };
    const { svc, disputesRepo, ledger } = buildService({
      purchaseRows: [purchase],
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          stripeChargeId: 'ch_test_1',
          stripePaymentIntentId: 'pi_test_xyz',
          amountMinorUnits: '6000',
          currency: 'USD',
          stripeStatus: 'under_review',
          internalState: 'EVIDENCE_SUBMITTED',
          chargebackLedgerEntryId: 'ledger-chargeback',
          reversalLedgerEntryId: null,
          submissionCount: 1,
        },
      ],
    });

    await svc.onDisputeEvent({
      id: 'evt_4',
      type: 'charge.dispute.closed',
      data: { object: baseStripeDispute({ status: 'won' }) },
    } as any);

    expect(ledger.append).toHaveBeenCalledTimes(1);
    const call = ledger.append.mock.calls[0][0];
    expect(call.kind).toBe('REVERSAL');
    expect(call.deltaCredits).toBe(100);
    expect(call.referenceId).toBe('ledger-chargeback');
    expect(call.idempotencyKey).toBe('dispute-reversal:dispute-1');

    expect(disputesRepo._rows[0].internalState).toBe('WON');
    expect(disputesRepo._rows[0].reversalLedgerEntryId).toBeTruthy();
  });

  it('charge.dispute.closed (lost) → no reversal, internal_state=LOST', async () => {
    const { svc, disputesRepo, ledger } = buildService({
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          stripeChargeId: 'ch_test_1',
          stripePaymentIntentId: 'pi_test_xyz',
          amountMinorUnits: '6000',
          currency: 'USD',
          stripeStatus: 'under_review',
          internalState: 'EVIDENCE_SUBMITTED',
          chargebackLedgerEntryId: 'ledger-chargeback',
          reversalLedgerEntryId: null,
          submissionCount: 1,
        },
      ],
    });

    await svc.onDisputeEvent({
      id: 'evt_5',
      type: 'charge.dispute.closed',
      data: { object: baseStripeDispute({ status: 'lost' }) },
    } as any);

    expect(ledger.append).not.toHaveBeenCalled();
    expect(disputesRepo._rows[0].internalState).toBe('LOST');
  });

  it('charge.dispute.closed (won) → REVERSAL idempotent on replay', async () => {
    const { svc, ledger } = buildService({
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          stripeChargeId: 'ch_test_1',
          stripePaymentIntentId: 'pi_test_xyz',
          amountMinorUnits: '6000',
          currency: 'USD',
          stripeStatus: 'won',
          internalState: 'WON',
          chargebackLedgerEntryId: 'ledger-chargeback',
          reversalLedgerEntryId: 'ledger-reversal',
          submissionCount: 1,
        },
      ],
    });

    await svc.onDisputeEvent({
      id: 'evt_replay',
      type: 'charge.dispute.closed',
      data: { object: baseStripeDispute({ status: 'won' }) },
    } as any);

    expect(ledger.append).not.toHaveBeenCalled();
  });
});

describe('DisputeService.submitEvidence', () => {
  it('rejects when missing idempotency key', async () => {
    const { svc } = buildService({
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          internalState: 'OPEN',
          submissionCount: 0,
        },
      ],
    });
    await expect(
      svc.submitEvidence('dispute-1', { customer_communication: 'x' }, ADMIN, ''),
    ).rejects.toThrow();
  });

  it('rejects double submission via submission_count guard', async () => {
    const { svc, stripe } = buildService({
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          internalState: 'EVIDENCE_SUBMITTED',
          submissionCount: 1,
        },
      ],
    });
    await expect(
      svc.submitEvidence(
        'dispute-1',
        { customer_communication: 'x' },
        ADMIN,
        'idem-1',
      ),
    ).rejects.toThrow(ConflictException);
    expect(stripe.submitDisputeEvidence).not.toHaveBeenCalled();
  });

  it('rejects submission on closed dispute', async () => {
    const { svc, stripe } = buildService({
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          internalState: 'WON',
          submissionCount: 1,
        },
      ],
    });
    await expect(
      svc.submitEvidence(
        'dispute-1',
        { customer_communication: 'x' },
        ADMIN,
        'idem-1',
      ),
    ).rejects.toThrow(ConflictException);
    expect(stripe.submitDisputeEvidence).not.toHaveBeenCalled();
  });

  it('happy path → calls Stripe with submit=true, bumps count, flips state', async () => {
    const { svc, disputesRepo, stripe } = buildService({
      disputeRows: [
        {
          id: 'dispute-1',
          organizationId: ORG,
          stripeDisputeId: 'dp_test_1',
          internalState: 'OPEN',
          submissionCount: 0,
          stripeStatus: 'needs_response',
        },
      ],
    });

    const result = await svc.submitEvidence(
      'dispute-1',
      { customer_communication: 'we sent the goods on 2026-06-01' },
      ADMIN,
      'idem-evidence-1',
    );

    expect(stripe.submitDisputeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: 'dp_test_1',
        submit: true,
        idempotencyKey: 'idem-evidence-1',
      }),
    );
    expect(result.internalState).toBe('EVIDENCE_SUBMITTED');
    expect(result.submissionCount).toBe(1);
    expect(disputesRepo._rows[0].submissionIdempotencyKey).toBe(
      'idem-evidence-1',
    );
    expect(disputesRepo._rows[0].stripeStatus).toBe('under_review');
  });
});
