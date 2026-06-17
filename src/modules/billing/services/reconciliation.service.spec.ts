import { ReconciliationService } from './reconciliation.service';

/**
 * ReconciliationService unit tests.
 *
 * Strategy
 * --------
 * Treat StripeService + repos as plain in-memory stubs. Drive the
 * service with hand-crafted btxn/ledger inputs and assert which
 * mismatch rows get written.
 *
 * The window logic is exercised by passing a stable `now` and
 * verifying the as_of_date that lands. Run() at 2026-06-17 02:00 UTC
 * should reconcile 2026-06-16.
 */

const makeRepo = (initial: any[] = []) => {
  const rows: any[] = initial.map((r) => ({ ...r }));
  let seq = rows.length;
  return {
    _rows: rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) =>
        Object.entries(where ?? {}).every(([k, v]) => {
          if (v && typeof v === 'object' && 'value' in (v as any)) {
            // crude IsNull / In stand-in: tests don't exercise this path
            return false;
          }
          return r[k] === v;
        }),
      ) ?? null,
    ),
    find: jest.fn(async ({ where, take = 1000 }: any) => {
      // We support a narrow subset of where keys here. Tests use this
      // for the ORPHAN_HTS scan; the service passes:
      //   { kind: In([...]), createdAt: Between(s, u), stripeBalanceTransactionId: IsNull() }
      // We just return any row in the initial list that has no
      // stripeBalanceTransactionId — which is what the orphan path
      // wants — and let the test set up the data accordingly.
      return rows
        .filter((r) => !r.stripeBalanceTransactionId)
        .slice(0, take);
    }),
    create: jest.fn((d: any) => ({
      id: `row-${++seq}`,
      createdAt: new Date('2026-06-17T02:00:00Z'),
      ...d,
    })),
    save: jest.fn(async (e: any) => {
      if (Array.isArray(e)) return e;
      const i = rows.findIndex((r) => r.id === e.id);
      if (i >= 0) rows[i] = { ...rows[i], ...e };
      else rows.push(e);
      return e;
    }),
    delete: jest.fn(async ({ runId: r }: any) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].runId === r) rows.splice(i, 1);
      }
      return { affected: 0 };
    }),
  };
};

const buildService = (params: {
  stripeBtxns?: Array<{
    id: string;
    type?: string;
    amount: number;
    currency?: string;
    created?: number;
  }>;
  ledgerRows?: any[];
  runs?: any[];
} = {}) => {
  const runsRepo = makeRepo(params.runs ?? []);
  const mismatchesRepo = makeRepo([]);
  const ledgerRepo = makeRepo(params.ledgerRows ?? []);

  const stripeBtxns = params.stripeBtxns ?? [];
  const stripe = {
    listBalanceTransactions: jest.fn(async () => ({
      data: stripeBtxns.map((b) => ({
        id: b.id,
        type: b.type ?? 'charge',
        amount: b.amount,
        currency: b.currency ?? 'usd',
        created: b.created ?? Math.floor(Date.UTC(2026, 5, 16, 10) / 1000),
      })),
      hasMore: false,
      lastId: null,
    })),
  };

  const svc = new ReconciliationService(
    runsRepo as any,
    mismatchesRepo as any,
    ledgerRepo as any,
    stripe as any,
  );
  return { svc, runsRepo, mismatchesRepo, ledgerRepo, stripe };
};

const RUN_NOW = new Date('2026-06-17T02:00:00.000Z');
const EXPECTED_AS_OF_DATE = '2026-06-16';

describe('ReconciliationService.run', () => {
  it('happy path: 0 stripe + 0 ledger → status=OK, no mismatches', async () => {
    const { svc, mismatchesRepo, runsRepo } = buildService({
      stripeBtxns: [],
      ledgerRows: [],
    });
    const run = await svc.run(RUN_NOW);
    expect(run.status).toBe('OK');
    expect(run.eventsChecked).toBe(0);
    expect(run.mismatches).toBe(0);
    expect(run.asOfDate).toBe(EXPECTED_AS_OF_DATE);
    expect(mismatchesRepo._rows).toHaveLength(0);
    expect(runsRepo._rows[0].status).toBe('OK');
  });

  it('every stripe txn matched → status=OK, 0 mismatches', async () => {
    const { svc, mismatchesRepo } = buildService({
      stripeBtxns: [
        { id: 'txn_1', amount: 2000 },
        { id: 'txn_2', amount: 5000 },
      ],
      ledgerRows: [
        {
          id: 'ledger-1',
          stripeBalanceTransactionId: 'txn_1',
          amountMinorUnits: '2000',
          kind: 'PURCHASE',
          createdAt: new Date('2026-06-16T11:00:00Z'),
        },
        {
          id: 'ledger-2',
          stripeBalanceTransactionId: 'txn_2',
          amountMinorUnits: '5000',
          kind: 'PURCHASE',
          createdAt: new Date('2026-06-16T12:00:00Z'),
        },
      ],
    });
    const run = await svc.run(RUN_NOW);
    expect(run.status).toBe('OK');
    expect(run.eventsChecked).toBe(2);
    expect(run.mismatches).toBe(0);
    expect(mismatchesRepo._rows).toHaveLength(0);
  });

  it('orphan Stripe txn → ORPHAN_STRIPE mismatch row', async () => {
    const { svc, mismatchesRepo } = buildService({
      stripeBtxns: [{ id: 'txn_orphan', amount: 7500, type: 'charge' }],
      ledgerRows: [],
    });
    const run = await svc.run(RUN_NOW);
    expect(run.status).toBe('DRIFT_DETECTED');
    expect(run.mismatches).toBe(1);
    expect(mismatchesRepo._rows[0]).toMatchObject({
      kind: 'ORPHAN_STRIPE',
      stripeBalanceTransactionId: 'txn_orphan',
      htsLedgerId: null,
    });
    expect(mismatchesRepo._rows[0].details).toMatchObject({
      stripeAmountMinorUnits: 7500,
      stripeType: 'charge',
    });
  });

  it('orphan HTS row → ORPHAN_HTS mismatch row', async () => {
    const { svc, mismatchesRepo } = buildService({
      stripeBtxns: [],
      ledgerRows: [
        {
          id: 'ledger-orphan',
          stripeBalanceTransactionId: null, // missing the join key
          amountMinorUnits: '3000',
          kind: 'PURCHASE',
          organizationId: 'org-1',
          deltaCredits: 100,
          createdAt: new Date('2026-06-16T13:00:00Z'),
        },
      ],
    });
    const run = await svc.run(RUN_NOW);
    expect(run.status).toBe('DRIFT_DETECTED');
    expect(mismatchesRepo._rows).toHaveLength(1);
    expect(mismatchesRepo._rows[0]).toMatchObject({
      kind: 'ORPHAN_HTS',
      htsLedgerId: 'ledger-orphan',
      stripeBalanceTransactionId: null,
    });
    expect(mismatchesRepo._rows[0].details).toMatchObject({
      ledgerKind: 'PURCHASE',
      amountMinorUnits: 3000,
    });
  });

  it('amount mismatch within 1-cent tolerance → no mismatch flagged', async () => {
    const { svc, mismatchesRepo } = buildService({
      stripeBtxns: [{ id: 'txn_drift', amount: 2001 }],
      ledgerRows: [
        {
          id: 'ledger-drift',
          stripeBalanceTransactionId: 'txn_drift',
          amountMinorUnits: '2000',
          kind: 'PURCHASE',
          createdAt: new Date('2026-06-16T14:00:00Z'),
        },
      ],
    });
    const run = await svc.run(RUN_NOW);
    expect(run.status).toBe('OK');
    expect(mismatchesRepo._rows).toHaveLength(0);
  });

  it('amount mismatch above tolerance → AMOUNT_MISMATCH row + drift sum', async () => {
    const { svc, mismatchesRepo } = buildService({
      stripeBtxns: [{ id: 'txn_drift', amount: 2050 }],
      ledgerRows: [
        {
          id: 'ledger-drift',
          stripeBalanceTransactionId: 'txn_drift',
          amountMinorUnits: '2000',
          kind: 'PURCHASE',
          createdAt: new Date('2026-06-16T14:00:00Z'),
        },
      ],
    });
    const run = await svc.run(RUN_NOW);
    expect(run.status).toBe('DRIFT_DETECTED');
    expect(mismatchesRepo._rows).toHaveLength(1);
    expect(mismatchesRepo._rows[0]).toMatchObject({
      kind: 'AMOUNT_MISMATCH',
      stripeBalanceTransactionId: 'txn_drift',
      htsLedgerId: 'ledger-drift',
    });
    expect(mismatchesRepo._rows[0].details).toMatchObject({
      expectedMinorUnits: 2050,
      actualMinorUnits: 2000,
      deltaMinorUnits: 50,
    });
    expect(Number(run.driftAmountMinorUnits)).toBe(50);
  });

  it('absolute-value comparison: stripe -2000 (refund) vs ledger +2000 (REFUND debit) → no mismatch', async () => {
    // Stripe signs refund btxns negative on the platform account; our
    // ledger stores |amount| on the corresponding row. The service
    // compares absolute values so they should reconcile.
    const { svc, mismatchesRepo } = buildService({
      stripeBtxns: [{ id: 'txn_refund', amount: -2000, type: 'refund' }],
      ledgerRows: [
        {
          id: 'ledger-refund',
          stripeBalanceTransactionId: 'txn_refund',
          amountMinorUnits: '2000',
          kind: 'REFUND',
          createdAt: new Date('2026-06-16T15:00:00Z'),
        },
      ],
    });
    const run = await svc.run(RUN_NOW);
    expect(run.status).toBe('OK');
    expect(mismatchesRepo._rows).toHaveLength(0);
  });

  it('re-run for same as_of_date UPSERTs the run row and resets mismatches', async () => {
    // First run lands with one ORPHAN_STRIPE mismatch.
    const { svc, runsRepo, mismatchesRepo } = buildService({
      stripeBtxns: [{ id: 'txn_orphan', amount: 7500 }],
      ledgerRows: [],
    });
    const first = await svc.run(RUN_NOW);
    expect(runsRepo._rows).toHaveLength(1);
    expect(mismatchesRepo._rows).toHaveLength(1);

    // Second invocation should reuse the same row id + wipe mismatches.
    // We simulate "Stripe now has 0 events" — drift detected last time
    // was a false positive.
    (svc as any).stripe.listBalanceTransactions = jest.fn(async () => ({
      data: [],
      hasMore: false,
      lastId: null,
    }));
    const second = await svc.run(RUN_NOW);
    expect(second.id).toBe(first.id);
    expect(runsRepo._rows).toHaveLength(1);
    expect(second.status).toBe('OK');
    expect(mismatchesRepo._rows).toHaveLength(0);
  });

  it('Stripe throws → run flips to FAILED with error_message', async () => {
    const { svc, runsRepo } = buildService({
      stripeBtxns: [],
      ledgerRows: [],
    });
    (svc as any).stripe.listBalanceTransactions = jest.fn(async () => {
      throw new Error('Stripe is having a moment');
    });
    await expect(svc.run(RUN_NOW)).rejects.toThrow('Stripe is having a moment');
    expect(runsRepo._rows).toHaveLength(1);
    expect(runsRepo._rows[0].status).toBe('FAILED');
    expect(runsRepo._rows[0].errorMessage).toContain('Stripe is having');
  });
});

describe('ReconciliationService.resolveMismatch', () => {
  it('marks the mismatch resolved with note + user id', async () => {
    const { svc, mismatchesRepo } = buildService();
    mismatchesRepo._rows.push({
      id: 'mm-1',
      runId: 'run-1',
      kind: 'ORPHAN_STRIPE',
      stripeBalanceTransactionId: 'txn_x',
      htsLedgerId: null,
      details: {},
      resolvedAt: null,
      createdAt: new Date(),
    });

    const row = await svc.resolveMismatch('mm-1', 'admin-1', 'investigated, true positive');
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(row.resolvedByUserId).toBe('admin-1');
    expect(row.resolutionNote).toBe('investigated, true positive');
  });

  it('idempotent on already-resolved row', async () => {
    const { svc, mismatchesRepo } = buildService();
    const prior = new Date('2026-06-17T00:00:00Z');
    mismatchesRepo._rows.push({
      id: 'mm-2',
      runId: 'run-1',
      kind: 'ORPHAN_STRIPE',
      details: {},
      resolvedAt: prior,
      resolvedByUserId: 'admin-prior',
      resolutionNote: 'prior note',
      createdAt: new Date(),
    });
    const row = await svc.resolveMismatch('mm-2', 'admin-new', 'new note');
    expect(row.resolvedAt).toBe(prior);
    expect(row.resolutionNote).toBe('prior note');
  });
});
