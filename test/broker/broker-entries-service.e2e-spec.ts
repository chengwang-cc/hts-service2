import { BrokerEntriesService } from '../../src/modules/broker-entries/services/broker-entries.service';
import { createAuditMock, createRepoMock, ctx, otherCtx } from './helpers';
import type {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../../src/modules/broker-entries/entities';

function build(seed: {
  entries?: Partial<BrokerEntryEntity>[];
  lines?: Partial<BrokerEntryLineEntity>[];
} = {}) {
  const entries = createRepoMock<BrokerEntryEntity>(
    seed.entries as unknown as BrokerEntryEntity[] ?? [],
  );
  const lines = createRepoMock<BrokerEntryLineEntity>(
    seed.lines as unknown as BrokerEntryLineEntity[] ?? [],
  );
  return {
    svc: new BrokerEntriesService(entries as any, lines as any, createAuditMock()),
    entries,
    lines,
  };
}

describe('BrokerEntriesService — approval gate + tenant isolation', () => {
  it('cannot mark an entry approved if it has a blocker', async () => {
    const { svc } = build({
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'c1',
          status: 'in_review',
          riskLevel: 'medium',
          blockers: [{ code: 'X', message: 'missing', severity: 'blocker' }],
        } as unknown as BrokerEntryEntity,
      ],
    });
    await expect(
      svc.update(ctx, 'e1', { status: 'approved' }),
    ).rejects.toThrow(/unresolved blockers/i);
  });

  it('approval timestamp + approver are recorded when status -> approved', async () => {
    const { svc, entries } = build({
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'c1',
          status: 'in_review',
          riskLevel: 'medium',
          blockers: [{ code: 'W', message: 'w', severity: 'warning' }],
        } as unknown as BrokerEntryEntity,
      ],
    });
    await svc.update(ctx, 'e1', { status: 'approved' });
    expect(entries.__store[0].status).toBe('approved');
    expect(entries.__store[0].approvedAt).toBeInstanceOf(Date);
    expect(entries.__store[0].approvedByUserId).toBe(ctx.userId);
  });

  it('refuses cross-tenant access', async () => {
    const { svc } = build({
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'c1',
          status: 'draft',
          riskLevel: 'low',
        } as unknown as BrokerEntryEntity,
      ],
    });
    await expect(svc.update(otherCtx, 'e1', { status: 'in_review' })).rejects.toThrow(
      /another tenant/i,
    );
  });

  it('upsertLine recomputes line totalValue from qty*unit', async () => {
    const { svc, lines } = build({
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          clientId: 'c1',
          status: 'draft',
          riskLevel: 'low',
          blockers: [],
        } as unknown as BrokerEntryEntity,
      ],
    });
    const line = await svc.upsertLine(ctx, 'e1', null, {
      lineNumber: 1,
      quantity: 3,
      unitValue: 12.5,
    });
    expect(line.totalValue).toBe('37.5');
    expect(lines.__store).toHaveLength(1);
  });

  it('draftFromHandoff persists entry + lines and is callable cross-module', async () => {
    const { svc, entries, lines } = build({});
    const draft = await svc.draftFromHandoff({
      brokerOrganizationId: ctx.organizationId,
      clientId: 'c1',
      lines: [
        { lineNumber: 1, description: 'tee', quantity: 1, unitValue: 5 },
      ],
    });
    expect(draft.id).toBeTruthy();
    expect(entries.__store).toHaveLength(1);
    expect(lines.__store).toHaveLength(1);
  });
});
