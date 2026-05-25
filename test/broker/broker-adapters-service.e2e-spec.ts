import { BrokerAdaptersService } from '../../src/modules/broker-adapters/services/broker-adapters.service';
import { GenericCsvAdapter } from '../../src/modules/broker-adapters/adapters/generic-csv.adapter';
import { JsonWebhookAdapter } from '../../src/modules/broker-adapters/adapters/json-webhook.adapter';
import { ProviderProfileAdapter } from '../../src/modules/broker-adapters/adapters/provider-profile.adapter';
import { createAuditMock, createRepoMock, ctx, otherCtx } from './helpers';
import type {
  BrokerAdapterEntity,
  BrokerExportJobEntity,
  BrokerStatusMessageEntity,
} from '../../src/modules/broker-adapters/entities';
import type { BrokerEntryEntity } from '../../src/modules/broker-entries/entities/broker-entry.entity';
import type { BrokerEntryLineEntity } from '../../src/modules/broker-entries/entities/broker-entry-line.entity';
import { EncryptedSecretService } from '../../src/modules/security/encrypted-secret.service';

process.env.JWT_SECRET = 'test-secret';

function build(seed: {
  adapters?: Partial<BrokerAdapterEntity>[];
  entries?: Partial<BrokerEntryEntity>[];
  lines?: Partial<BrokerEntryLineEntity>[];
} = {}) {
  const adapters = createRepoMock<BrokerAdapterEntity>(
    seed.adapters as unknown as BrokerAdapterEntity[] ?? [],
  );
  const jobs = createRepoMock<BrokerExportJobEntity>();
  const status = createRepoMock<BrokerStatusMessageEntity>();
  const entries = createRepoMock<BrokerEntryEntity>(
    seed.entries as unknown as BrokerEntryEntity[] ?? [],
  );
  const lines = createRepoMock<BrokerEntryLineEntity>(
    seed.lines as unknown as BrokerEntryLineEntity[] ?? [],
  );
  const secrets = new EncryptedSecretService();
  const statusService = { record: jest.fn() } as any;
  const csv = new GenericCsvAdapter();
  // Minimal adapter stub factory — vendor adapters are exercised via the
  // generic provider profile in unit tests; integration tests against real
  // vendor sandboxes live elsewhere.
  const stubAdapter = (key: string) =>
    ({
      key,
      build: (ctx: any) => csv.build(ctx),
      deliver: async () => ({ delivered: true }),
      requiredFields: () => csv.requiredFields(),
    } as any);
  const svc = new BrokerAdaptersService(
    adapters as any,
    jobs as any,
    status as any,
    entries as any,
    lines as any,
    secrets,
    statusService,
    createAuditMock(),
    csv,
    new JsonWebhookAdapter(),
    new ProviderProfileAdapter(),
    stubAdapter('sftp_csv'),
    stubAdapter('magaya_acelynk'),
    stubAdapter('descartes'),
    stubAdapter('cargowise'),
  );
  return { svc, adapters, jobs, status, entries, lines, statusService };
}

describe('BrokerAdaptersService', () => {
  it('refuses to create catair_edi adapter', async () => {
    const { svc } = build();
    await expect(
      svc.createAdapter(ctx, {
        adapterType: 'catair_edi',
        label: 'CBP EDI',
      }),
    ).rejects.toThrow(/not yet supported|feasibility/i);
  });

  it('CATAIR feasibility report explicitly marks catair_edi unsupported', () => {
    const { svc } = build();
    const report = svc.catairFeasibilityReport();
    expect(report.currentCapability.catairEdi).toBe(false);
    expect(report.prerequisites.length).toBeGreaterThan(0);
  });

  it('cannot export an entry that is still in draft', async () => {
    const { svc } = build({
      adapters: [
        {
          id: 'a1',
          organizationId: ctx.organizationId,
          adapterType: 'generic_csv',
          label: 'CSV',
          status: 'active',
          publicConfig: null,
          encryptedConfig: null,
          fieldMappingProfile: null,
        } as unknown as BrokerAdapterEntity,
      ],
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          status: 'draft',
          blockers: [],
        } as unknown as BrokerEntryEntity,
      ],
    });
    await expect(
      svc.createExportJob(ctx, { entryId: 'e1', adapterId: 'a1' }),
    ).rejects.toThrow(/must be approved/i);
  });

  it('blocks export when entry has unresolved blockers even if approved', async () => {
    const { svc } = build({
      adapters: [
        {
          id: 'a1',
          organizationId: ctx.organizationId,
          adapterType: 'generic_csv',
          label: 'CSV',
          status: 'active',
        } as unknown as BrokerAdapterEntity,
      ],
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          status: 'approved',
          blockers: [{ code: 'X', message: 'y', severity: 'blocker' }],
        } as unknown as BrokerEntryEntity,
      ],
    });
    await expect(
      svc.createExportJob(ctx, { entryId: 'e1', adapterId: 'a1' }),
    ).rejects.toThrow(/unresolved blockers/i);
  });

  it('successfully exports CSV for approved entry and flips entry to exported', async () => {
    const { svc, entries, jobs } = build({
      adapters: [
        {
          id: 'a1',
          organizationId: ctx.organizationId,
          adapterType: 'generic_csv',
          label: 'CSV',
          status: 'active',
        } as unknown as BrokerAdapterEntity,
      ],
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          status: 'approved',
          blockers: [],
          entryNumber: 'E1',
          approvedAt: new Date(),
          approvedByUserId: ctx.userId,
        } as unknown as BrokerEntryEntity,
      ],
      lines: [
        {
          id: 'l1',
          entryId: 'e1',
          lineNumber: 1,
          htsNumber: '6109.10',
          countryOfOrigin: 'VN',
          totalValue: '100',
          currency: 'USD',
        } as unknown as BrokerEntryLineEntity,
      ],
    });
    const job = await svc.createExportJob(ctx, { entryId: 'e1', adapterId: 'a1' });
    expect(job.status).toBe('delivered');
    expect(jobs.__store).toHaveLength(1);
    expect(entries.__store[0].status).toBe('exported');
  });

  it('cross-tenant export attempt is rejected', async () => {
    const { svc } = build({
      adapters: [
        {
          id: 'a1',
          organizationId: ctx.organizationId,
          adapterType: 'generic_csv',
          label: 'CSV',
          status: 'active',
        } as unknown as BrokerAdapterEntity,
      ],
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          status: 'approved',
          blockers: [],
        } as unknown as BrokerEntryEntity,
      ],
    });
    await expect(
      svc.createExportJob(otherCtx, { entryId: 'e1', adapterId: 'a1' }),
    ).rejects.toThrow(/another tenant/i);
  });

  it('status import sets entry to rejected when normalizedStatus=rejected', async () => {
    const { svc, entries, statusService } = build({
      entries: [
        {
          id: 'e1',
          brokerOrganizationId: ctx.organizationId,
          status: 'exported',
        } as unknown as BrokerEntryEntity,
      ],
    });
    await svc.importStatusMessage(ctx, {
      entryId: 'e1',
      source: 'magaya',
      messageType: 'response',
      normalizedStatus: 'rejected',
      rawMessage: { foo: 'bar' },
    });
    expect(entries.__store[0].status).toBe('rejected');
    expect(statusService.record).toHaveBeenCalled();
  });

  it('encrypted secrets round-trip through createAdapter (hasSecrets=true)', async () => {
    const { svc } = build();
    const adapter = await svc.createAdapter(ctx, {
      adapterType: 'json_webhook',
      label: 'webhook',
      publicConfig: { url: 'https://x' },
      secrets: { bearerToken: 'TOP_SECRET' },
    });
    expect(adapter.hasSecrets).toBe(true);
  });
});
