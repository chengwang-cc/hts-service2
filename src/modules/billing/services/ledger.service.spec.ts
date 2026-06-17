import { LedgerService } from './ledger.service';
import type { ActorContext } from '../types/actor-context';

const ORG = '11111111-1111-1111-1111-111111111111';

const adminActor: ActorContext = {
  kind: 'ADMIN',
  userId: 'admin-user-id',
  ip: '127.0.0.1',
  userAgent: 'test',
  requestId: 'req-1',
};

const systemActor: ActorContext = { kind: 'SYSTEM' };

/**
 * Two pieces of state to mock:
 *   1. A repository for `credit_ledger` that simulates the unique
 *      idempotency_key constraint + lets us inspect what was written.
 *   2. A repository for `credit_balances` that round-trips a numeric
 *      balance.
 *
 * Plus a DataSource whose `transaction` callback just receives a stub
 * `tx` that re-exposes the same repositories so the code-under-test
 * can call `tx.getRepository(...)` and `tx.query(...)` as if the
 * transaction were real.
 */
const makeStubs = (initialBalance = 0) => {
  const ledgerRows: any[] = [];
  const balance = { value: initialBalance };

  const ledgerRepo: any = {
    findOne: jest.fn(async ({ where }: any) =>
      ledgerRows.find(
        (r) => where.idempotencyKey && r.idempotencyKey === where.idempotencyKey,
      ) ?? null,
    ),
    find: jest.fn(async ({ where, take = 50 }: any) =>
      ledgerRows
        .filter((r) => r.organizationId === where.organizationId)
        .slice(0, take),
    ),
    create: jest.fn((data: any) => ({ id: `l-${ledgerRows.length + 1}`, ...data })),
    save: jest.fn(async (entity: any) => {
      ledgerRows.push(entity);
      return entity;
    }),
    _rows: ledgerRows,
  };

  const balanceRepo: any = {
    findOne: jest.fn(async ({ where: _where }: any) => ({ balance: balance.value })),
  };

  const ds: any = {
    transaction: jest.fn(async (fn: any) => {
      const tx = {
        getRepository: jest.fn(() => ledgerRepo),
        query: jest.fn(async (sql: string, params: any[] = []) => {
          if (/SELECT balance FROM credit_balances/i.test(sql)) {
            return [{ balance: balance.value }];
          }
          if (/INSERT INTO credit_balances/i.test(sql)) {
            balance.value = params[1];
            return [];
          }
          return [];
        }),
      };
      return fn(tx);
    }),
    query: jest.fn(async (sql: string, _params: any[] = []) => {
      if (/SUM\(delta_credits\)/i.test(sql)) {
        const sum = ledgerRows.reduce((s, r) => s + r.deltaCredits, 0);
        return [{ sum: String(sum) }];
      }
      return [];
    }),
  };

  return { ledgerRepo, balanceRepo, ds, balance, ledgerRows };
};

describe('LedgerService.append', () => {
  it('writes a row + materializes balance + returns balance_after', async () => {
    const stubs = makeStubs(100);
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    const row = await svc.append(
      { organizationId: ORG, deltaCredits: 50, kind: 'MANUAL_TOPUP', reasonCode: 'GOODWILL' },
      adminActor,
    );
    expect(row.balanceAfter).toBe(150);
    expect(stubs.balance.value).toBe(150);
    expect(stubs.ledgerRows).toHaveLength(1);
    expect(stubs.ledgerRows[0]).toMatchObject({
      organizationId: ORG,
      deltaCredits: 50,
      kind: 'MANUAL_TOPUP',
      reasonCode: 'GOODWILL',
      actorKind: 'ADMIN',
      actorUserId: 'admin-user-id',
    });
  });

  it('signed delta supports debits', async () => {
    const stubs = makeStubs(200);
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    const row = await svc.append(
      { organizationId: ORG, deltaCredits: -25, kind: 'USAGE_DEBIT' },
      systemActor,
    );
    expect(row.balanceAfter).toBe(175);
    expect(stubs.balance.value).toBe(175);
  });

  it('balance can go negative (refund > current balance)', async () => {
    const stubs = makeStubs(10);
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    const row = await svc.append(
      { organizationId: ORG, deltaCredits: -50, kind: 'REFUND' },
      { kind: 'WEBHOOK' },
    );
    expect(row.balanceAfter).toBe(-40);
    expect(stubs.balance.value).toBe(-40);
  });

  it('idempotent on idempotencyKey — replay returns existing row without re-applying delta', async () => {
    const stubs = makeStubs(0);
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    const first = await svc.append(
      { organizationId: ORG, deltaCredits: 100, kind: 'MANUAL_TOPUP', reasonCode: 'GOODWILL', idempotencyKey: 'k-1' },
      adminActor,
    );
    expect(stubs.balance.value).toBe(100);
    const second = await svc.append(
      { organizationId: ORG, deltaCredits: 999, kind: 'MANUAL_TOPUP', reasonCode: 'GOODWILL', idempotencyKey: 'k-1' },
      adminActor,
    );
    expect(second.id).toBe(first.id);
    expect(stubs.balance.value).toBe(100); // NOT 1099
    expect(stubs.ledgerRows).toHaveLength(1);
  });

  it('captures actor IP + user agent + request id on the row', async () => {
    const stubs = makeStubs();
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    await svc.append(
      { organizationId: ORG, deltaCredits: 1, kind: 'MANUAL_TOPUP', reasonCode: 'PROMO' },
      adminActor,
    );
    const row = stubs.ledgerRows[0];
    expect(row.actorIp).toBe('127.0.0.1');
    expect(row.actorUserAgent).toBe('test');
    expect(row.requestId).toBe('req-1');
  });

  it('rounds amount_minor_units into amount_functional_minor_units', async () => {
    const stubs = makeStubs();
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    await svc.append(
      {
        organizationId: ORG,
        deltaCredits: 50,
        kind: 'PURCHASE',
        amountMinorUnits: 2000, // $20.00
        currency: 'USD',
        taxTreatment: 'TAXED_AT_PURCHASE',
      },
      { kind: 'WEBHOOK' },
    );
    const row = stubs.ledgerRows[0];
    expect(row.amountMinorUnits).toBe('2000');
    expect(row.amountFunctionalMinorUnits).toBe('2000');
    expect(row.currency).toBe('USD');
    expect(row.taxTreatment).toBe('TAXED_AT_PURCHASE');
  });

  it('defaults tax treatment to NON_TAXABLE_PROMO', async () => {
    const stubs = makeStubs();
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    await svc.append(
      { organizationId: ORG, deltaCredits: 1, kind: 'MANUAL_TOPUP', reasonCode: 'PROMO' },
      adminActor,
    );
    expect(stubs.ledgerRows[0].taxTreatment).toBe('NON_TAXABLE_PROMO');
  });
});

describe('LedgerService.shadowAppend', () => {
  it('returns void on success', async () => {
    const stubs = makeStubs();
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    await expect(
      svc.shadowAppend({ organizationId: ORG, deltaCredits: 1, kind: 'USAGE_DEBIT' }, systemActor),
    ).resolves.toBeUndefined();
    expect(stubs.ledgerRows).toHaveLength(1);
  });

  it('swallows errors (does not throw, does not abort caller)', async () => {
    const stubs = makeStubs();
    // Force the transaction to blow up
    stubs.ds.transaction = jest.fn(async () => {
      throw new Error('simulated DB failure');
    });
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    await expect(
      svc.shadowAppend({ organizationId: ORG, deltaCredits: 1, kind: 'USAGE_DEBIT' }, systemActor),
    ).resolves.toBeUndefined();
    expect(stubs.ledgerRows).toHaveLength(0);
  });
});

describe('LedgerService.sumForOrganization', () => {
  it('returns 0 for an org with no rows', async () => {
    const stubs = makeStubs();
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    expect(await svc.sumForOrganization(ORG)).toBe(0);
  });

  it('reflects the sum of all deltas (positive + negative)', async () => {
    const stubs = makeStubs(0);
    const svc = new LedgerService(stubs.ds, stubs.ledgerRepo, stubs.balanceRepo);
    await svc.append({ organizationId: ORG, deltaCredits: 100, kind: 'PURCHASE' }, { kind: 'WEBHOOK' });
    await svc.append({ organizationId: ORG, deltaCredits: -30, kind: 'USAGE_DEBIT' }, systemActor);
    await svc.append({ organizationId: ORG, deltaCredits: 20, kind: 'MANUAL_TOPUP', reasonCode: 'GOODWILL' }, adminActor);
    expect(await svc.sumForOrganization(ORG)).toBe(90);
  });
});
