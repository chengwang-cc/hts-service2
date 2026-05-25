import { BrokerClientsService } from '../../src/modules/broker-core/services/broker-clients.service';
import { EncryptedSecretService } from '../../src/modules/security/encrypted-secret.service';
import { createAuditMock, createRepoMock, ctx, otherCtx } from './helpers';
import type { BrokerClientEntity, BrokerPowerOfAttorneyEntity } from '../../src/modules/broker-core/entities';

process.env.JWT_SECRET = 'test-secret';

describe('BrokerClientsService — tenant isolation', () => {
  function build(seed: Partial<BrokerClientEntity>[] = []) {
    const clients = createRepoMock<BrokerClientEntity>(
      seed as unknown as BrokerClientEntity[],
    );
    const poas = createRepoMock<BrokerPowerOfAttorneyEntity>();
    const svc = new BrokerClientsService(
      clients as any,
      poas as any,
      new EncryptedSecretService(),
      createAuditMock(),
    );
    return { svc, clients, poas };
  }

  it('list returns only the calling tenant\'s clients', async () => {
    const { svc } = build([
      { id: 'c1', brokerOrganizationId: ctx.organizationId, name: 'Mine', status: 'active' },
      { id: 'c2', brokerOrganizationId: otherCtx.organizationId, name: 'Theirs', status: 'active' },
    ]);
    const r = await svc.list(ctx, {});
    expect(r.rows.map((c) => c.id)).toEqual(['c1']);
  });

  it('get refuses cross-tenant lookup', async () => {
    const { svc } = build([
      { id: 'c1', brokerOrganizationId: otherCtx.organizationId, name: 'Theirs', status: 'active' },
    ]);
    await expect(svc.get(ctx, 'c1')).rejects.toThrow(/another tenant/i);
  });

  it('create stores importer id encrypted and exposes only last 4', async () => {
    const { svc, clients } = build([]);
    const created = await svc.create(ctx, {
      name: 'Acme',
      importerId: 'IRS123456789',
    });
    expect(created.importerIdLast4).toBe('6789');
    expect(created.hasImporterId).toBe(true);
    expect(clients.__store[0].encryptedImporterId).toBeTruthy();
    // Encrypted blob shouldn't store raw importer id
    expect(JSON.stringify(clients.__store[0].encryptedImporterId)).not.toContain(
      'IRS123456789',
    );
  });

  it('upsertPoa stamps verifier when status moves to verified', async () => {
    const { svc } = build([
      { id: 'c1', brokerOrganizationId: ctx.organizationId, name: 'Mine', status: 'active' },
    ]);
    const out = await svc.upsertPoa(ctx, 'c1', { status: 'verified' });
    expect(out.status).toBe('verified');
    expect(out.verifiedByUserId).toBe(ctx.userId);
    expect(out.verifiedAt).toBeInstanceOf(Date);
  });

  it('refuses authenticated context with no userId', async () => {
    const { svc } = build([]);
    await expect(
      svc.list({ userId: '', organizationId: '', ipAddress: null, userAgent: null } as any, {}),
    ).rejects.toThrow(/Authenticated/);
  });
});
