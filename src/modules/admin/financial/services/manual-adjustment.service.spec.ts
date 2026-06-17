import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ManualAdjustmentService } from './manual-adjustment.service';
import type { ActorContext } from '../../../billing/types/actor-context';

const ORG = '11111111-1111-1111-1111-111111111111';

const adminActor: ActorContext = {
  kind: 'ADMIN',
  userId: 'admin-user-1',
  ip: '10.0.0.5',
  userAgent: 'jest',
  requestId: 'req-test',
};

const ORIGINAL_ENV = { ...process.env };

const buildService = (params: {
  orgExists?: boolean;
  initialBalance?: number;
  appendReturns?: any;
} = {}) => {
  const orgs: any = {
    findOne: jest.fn(async ({ where }: any) =>
      params.orgExists === false ? null : { id: where.id, name: 'TestOrg' },
    ),
  };
  const balance = { value: params.initialBalance ?? 0 };
  const ledger: any = {
    getBalance: jest.fn(async () => balance.value),
    append: jest.fn(async (entry: any) => {
      // simulate balance materialization
      balance.value += entry.deltaCredits;
      return {
        id: 'ledger-1',
        organizationId: entry.organizationId,
        deltaCredits: entry.deltaCredits,
        balanceAfter: balance.value,
        kind: entry.kind,
        reasonCode: entry.reasonCode ?? null,
        internalNote: entry.internalNote ?? null,
        createdAt: new Date('2026-06-17T15:00:00Z'),
        ...(params.appendReturns ?? {}),
      };
    }),
  };
  const svc = new ManualAdjustmentService(orgs, ledger);
  return { svc, orgs, ledger, balance };
};

describe('ManualAdjustmentService.adjust', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('positive delta → MANUAL_TOPUP ledger entry + balance moves', async () => {
    const { svc, ledger } = buildService({ initialBalance: 100 });
    const result = await svc.adjust(
      { organizationId: ORG, delta: 50, reasonCode: 'GOODWILL' },
      adminActor,
    );
    expect(result.kind).toBe('MANUAL_TOPUP');
    expect(result.delta).toBe(50);
    expect(result.balanceBefore).toBe(100);
    expect(result.balanceAfter).toBe(150);
    expect(result.actor.kind).toBe('ADMIN');
    expect(result.actor.userId).toBe('admin-user-1');
    const appendArg = ledger.append.mock.calls[0][0];
    expect(appendArg.kind).toBe('MANUAL_TOPUP');
    expect(appendArg.reasonCode).toBe('GOODWILL');
  });

  it('negative delta → MANUAL_DEBIT ledger entry + balance debits', async () => {
    const { svc, ledger } = buildService({ initialBalance: 200 });
    const result = await svc.adjust(
      { organizationId: ORG, delta: -75, reasonCode: 'BILLING_ERROR_CORRECTION' },
      adminActor,
    );
    expect(result.kind).toBe('MANUAL_DEBIT');
    expect(result.balanceAfter).toBe(125);
    expect(ledger.append.mock.calls[0][0].kind).toBe('MANUAL_DEBIT');
  });

  it('rejects delta=0', async () => {
    const { svc } = buildService();
    await expect(
      svc.adjust({ organizationId: ORG, delta: 0, reasonCode: 'GOODWILL' }, adminActor),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when org does not exist', async () => {
    const { svc } = buildService({ orgExists: false });
    await expect(
      svc.adjust({ organizationId: ORG, delta: 10, reasonCode: 'GOODWILL' }, adminActor),
    ).rejects.toThrow(NotFoundException);
  });

  it('passes idempotency key through to ledger.append', async () => {
    const { svc, ledger } = buildService();
    await svc.adjust(
      {
        organizationId: ORG,
        delta: 25,
        reasonCode: 'PROMO',
        idempotencyKey: 'idem-key-1',
      },
      adminActor,
    );
    expect(ledger.append.mock.calls[0][0].idempotencyKey).toBe('idem-key-1');
  });

  it('captures actor on the ledger call', async () => {
    const { svc, ledger } = buildService();
    await svc.adjust(
      { organizationId: ORG, delta: 10, reasonCode: 'GOODWILL' },
      adminActor,
    );
    const actorArg = ledger.append.mock.calls[0][1];
    expect(actorArg.kind).toBe('ADMIN');
    expect(actorArg.userId).toBe('admin-user-1');
    expect(actorArg.ip).toBe('10.0.0.5');
    expect(actorArg.requestId).toBe('req-test');
  });

  it('flags over-threshold adjustments in metadata + logs', async () => {
    process.env.FINANCIAL_ADMIN_APPROVAL_THRESHOLD_CREDITS = '100';
    const { svc, ledger } = buildService();
    await svc.adjust(
      { organizationId: ORG, delta: 250, reasonCode: 'SUPPORT_RESOLUTION' },
      adminActor,
    );
    const appendArg = ledger.append.mock.calls[0][0];
    expect(appendArg.metadata.overApprovalThreshold).toBe(true);
  });

  it('does NOT flag under-threshold adjustments', async () => {
    process.env.FINANCIAL_ADMIN_APPROVAL_THRESHOLD_CREDITS = '500';
    const { svc, ledger } = buildService();
    await svc.adjust(
      { organizationId: ORG, delta: 50, reasonCode: 'GOODWILL' },
      adminActor,
    );
    expect(ledger.append.mock.calls[0][0].metadata.overApprovalThreshold).toBe(false);
  });

  it('passes the reason code through unchanged', async () => {
    const { svc, ledger } = buildService();
    await svc.adjust(
      { organizationId: ORG, delta: 1, reasonCode: 'MIGRATION' },
      adminActor,
    );
    expect(ledger.append.mock.calls[0][0].reasonCode).toBe('MIGRATION');
  });
});
