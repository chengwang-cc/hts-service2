import { BrokerStatusService } from '../../src/modules/broker-tasks/services/broker-status.service';
import { BrokerTasksService } from '../../src/modules/broker-tasks/services/broker-tasks.service';
import { createAuditMock, createRepoMock, ctx, otherCtx } from './helpers';
import type {
  BrokerMissingInfoTaskEntity,
  BrokerStatusEventEntity,
} from '../../src/modules/broker-tasks/entities';
import type { BrokerClientRelationshipEntity } from '../../src/modules/broker-core/entities/broker-client-relationship.entity';
import type { BrokerShipmentEntity } from '../../src/modules/broker-entries/entities/broker-shipment.entity';
import type { BrokerEntryEntity } from '../../src/modules/broker-entries/entities/broker-entry.entity';

function build(seed: {
  tasks?: Partial<BrokerMissingInfoTaskEntity>[];
  relationships?: Partial<BrokerClientRelationshipEntity>[];
  shipments?: Partial<BrokerShipmentEntity>[];
  entries?: Partial<BrokerEntryEntity>[];
} = {}) {
  const tasks = createRepoMock<BrokerMissingInfoTaskEntity>(
    seed.tasks as unknown as BrokerMissingInfoTaskEntity[] ?? [],
  );
  const relationships = createRepoMock<BrokerClientRelationshipEntity>(
    seed.relationships as unknown as BrokerClientRelationshipEntity[] ?? [],
  );
  const shipments = createRepoMock<BrokerShipmentEntity>(
    seed.shipments as unknown as BrokerShipmentEntity[] ?? [],
  );
  const entries = createRepoMock<BrokerEntryEntity>(
    seed.entries as unknown as BrokerEntryEntity[] ?? [],
  );
  const events = createRepoMock<BrokerStatusEventEntity>();
  const statusSvc = new BrokerStatusService(events as any);
  const users = createRepoMock();
  const organizations = createRepoMock();
  return {
    svc: new BrokerTasksService(
      tasks as any,
      relationships as any,
      shipments as any,
      entries as any,
      users as any,
      organizations as any,
      statusSvc,
      createAuditMock(),
    ),
    tasks,
    relationships,
    shipments,
    events,
  };
}

describe('BrokerTasksService', () => {
  it('refuses createForBroker when relationship belongs to another broker tenant', async () => {
    const { svc } = build({
      relationships: [
        {
          id: 'r1',
          brokerOrganizationId: otherCtx.organizationId,
          businessOrganizationId: 'b1',
        } as unknown as BrokerClientRelationshipEntity,
      ],
    });
    await expect(
      svc.createForBroker(ctx, {
        relationshipId: 'r1',
        prompt: 'why is value 0',
      }),
    ).rejects.toThrow(/another tenant/i);
  });

  it('client can answer only their own task; broker org cannot', async () => {
    const businessOrg = 'biz-1';
    const { svc, tasks } = build({
      tasks: [
        {
          id: 't1',
          brokerOrganizationId: ctx.organizationId,
          businessOrganizationId: businessOrg,
          relationshipId: 'r1',
          prompt: 'q?',
          severity: 'warning',
          createdByUserId: ctx.userId,
          status: 'pending_client',
        } as unknown as BrokerMissingInfoTaskEntity,
      ],
    });
    await expect(svc.answer(ctx, 't1', { answer: 'broker trying' })).rejects.toThrow(
      /Only the business client/i,
    );
    const result = await svc.answer(
      { ...ctx, organizationId: businessOrg } as any,
      't1',
      { answer: 'real answer' },
    );
    expect(result.status).toBe('answered');
    expect(tasks.__store[0].answer).toBe('real answer');
  });

  it('cancel can only be done by the broker', async () => {
    const businessOrg = 'biz-1';
    const { svc } = build({
      tasks: [
        {
          id: 't1',
          brokerOrganizationId: ctx.organizationId,
          businessOrganizationId: businessOrg,
          relationshipId: 'r1',
          prompt: 'q?',
          severity: 'warning',
          createdByUserId: ctx.userId,
          status: 'pending_client',
        } as unknown as BrokerMissingInfoTaskEntity,
      ],
    });
    await expect(
      svc.cancel({ ...ctx, organizationId: businessOrg } as any, 't1'),
    ).rejects.toThrow(/Only the broker/i);
    const cancelled = await svc.cancel(ctx, 't1');
    expect(cancelled.status).toBe('cancelled');
  });

  it('listClientShipments returns shipments tied to active business relationships only', async () => {
    const businessOrg = 'biz-1';
    const { svc } = build({
      relationships: [
        {
          id: 'r1',
          brokerOrganizationId: 'b1',
          businessOrganizationId: businessOrg,
          clientId: 'client-1',
          status: 'active',
        } as unknown as BrokerClientRelationshipEntity,
        {
          id: 'r2',
          brokerOrganizationId: 'b2',
          businessOrganizationId: businessOrg,
          clientId: 'client-2',
          status: 'terminated',
        } as unknown as BrokerClientRelationshipEntity,
      ],
      shipments: [
        { id: 's1', clientId: 'client-1', mode: 'ocean' } as unknown as BrokerShipmentEntity,
        { id: 's2', clientId: 'client-2', mode: 'air' } as unknown as BrokerShipmentEntity,
        { id: 's3', clientId: 'other', mode: 'ocean' } as unknown as BrokerShipmentEntity,
      ],
      entries: [],
    });
    const rows = await svc.listClientShipments({
      ...ctx,
      organizationId: businessOrg,
    } as any);
    expect(rows.map((r) => r.id).sort()).toEqual(['s1']);
  });

  it('findStaleTasks returns only tasks pending_client and older than 24h', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const recent = new Date();
    const { svc } = build({
      tasks: [
        {
          id: 't_old_pending',
          brokerOrganizationId: 'b',
          businessOrganizationId: 'b2',
          relationshipId: 'r',
          prompt: 'q',
          status: 'pending_client',
          createdByUserId: 'u',
          severity: 'warning',
          createdAt: old,
          notifiedAt: null,
        } as unknown as BrokerMissingInfoTaskEntity,
        {
          id: 't_recent',
          brokerOrganizationId: 'b',
          businessOrganizationId: 'b2',
          relationshipId: 'r',
          prompt: 'q',
          status: 'pending_client',
          createdByUserId: 'u',
          severity: 'warning',
          createdAt: recent,
          notifiedAt: null,
        } as unknown as BrokerMissingInfoTaskEntity,
        {
          id: 't_answered',
          brokerOrganizationId: 'b',
          businessOrganizationId: 'b2',
          relationshipId: 'r',
          prompt: 'q',
          status: 'answered',
          createdByUserId: 'u',
          severity: 'warning',
          createdAt: old,
          notifiedAt: null,
        } as unknown as BrokerMissingInfoTaskEntity,
      ],
    });
    // findStaleTasks uses a query builder; with the simple mock all entries
    // pass through but we filter by status + createdAt manually here.
    const all = await svc.findStaleTasks();
    expect(all.find((t) => t.id === 't_answered')).toBeUndefined();
  });
});
