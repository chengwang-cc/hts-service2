import { BadRequestException } from '@nestjs/common';
import { BrokerEntriesService } from '../../src/modules/broker-entries/services/broker-entries.service';
import type {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../../src/modules/broker-entries/entities';
import { createAuditMock, createRepoMock, ctx } from './helpers';

describe('R1-C-01 — validate-before-approve in BrokerEntriesService.update', () => {
  it('runs validateEntry before flipping to approved and refuses approval when blockers surface', async () => {
    const entry = {
      id: 'e-1',
      brokerOrganizationId: ctx.organizationId,
      clientId: 'client-1',
      status: 'in_review',
      blockers: [],
      entryType: 'consumption',
    } as unknown as BrokerEntryEntity;
    const entries = createRepoMock<BrokerEntryEntity>([entry]);
    const lines = createRepoMock<BrokerEntryLineEntity>();

    // The fake rules service injects fresh blockers when called.
    const validateEntry = jest.fn(async () => {
      const e = entries.__store[0];
      e.blockers = [
        { code: 'TEST', message: 'forced', severity: 'blocker' },
      ];
    });

    const svc = new BrokerEntriesService(
      entries as any,
      lines as any,
      createAuditMock(),
      { validateEntry } as any,
    );

    await expect(
      svc.update(ctx, 'e-1', { status: 'approved' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(validateEntry).toHaveBeenCalledWith(ctx, 'e-1');
    expect(entries.__store[0].status).toBe('in_review'); // unchanged
  });

  it('runs validateEntry and allows approval when no blockers surface', async () => {
    const entry = {
      id: 'e-2',
      brokerOrganizationId: ctx.organizationId,
      clientId: 'client-1',
      status: 'in_review',
      blockers: [],
      entryType: 'consumption',
    } as unknown as BrokerEntryEntity;
    const entries = createRepoMock<BrokerEntryEntity>([entry]);
    const lines = createRepoMock<BrokerEntryLineEntity>();
    const validateEntry = jest.fn(async () => {
      entries.__store[0].blockers = [];
    });
    const svc = new BrokerEntriesService(
      entries as any,
      lines as any,
      createAuditMock(),
      { validateEntry } as any,
    );

    const result = await svc.update(ctx, 'e-2', { status: 'approved' } as any);
    expect(validateEntry).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('approved');
    expect(result.approvedAt).toBeInstanceOf(Date);
  });

  it('skips validateEntry when the status transition is something other than approved', async () => {
    const entry = {
      id: 'e-3',
      brokerOrganizationId: ctx.organizationId,
      clientId: 'c',
      status: 'draft',
      blockers: [],
      entryType: 'consumption',
    } as unknown as BrokerEntryEntity;
    const entries = createRepoMock<BrokerEntryEntity>([entry]);
    const lines = createRepoMock<BrokerEntryLineEntity>();
    const validateEntry = jest.fn();
    const svc = new BrokerEntriesService(
      entries as any,
      lines as any,
      createAuditMock(),
      { validateEntry } as any,
    );
    await svc.update(ctx, 'e-3', { status: 'in_review' } as any);
    expect(validateEntry).not.toHaveBeenCalled();
  });
});
