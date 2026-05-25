import { randomBytes } from 'crypto';
import { EncryptedSecretService } from '../../src/modules/security/encrypted-secret.service';
import { SecretRotationService } from '../../src/modules/security/secret-rotation.service';
import type { BrokerAdapterEntity } from '../../src/modules/broker-adapters/entities/broker-adapter.entity';
import type { BrokerClientEntity } from '../../src/modules/broker-core/entities/broker-client.entity';
import { createRepoMock } from './helpers';

describe('Secret rotation (R0-B-04)', () => {
  let oldKey: string;
  let newKey: string;
  let originalActive: string | undefined;
  let originalOld: string | undefined;

  beforeAll(() => {
    originalActive = process.env.SECRET_ENCRYPTION_KEY;
    originalOld = process.env.SECRET_ENCRYPTION_KEY_OLD;
    oldKey = randomBytes(32).toString('base64');
    newKey = randomBytes(32).toString('base64');
  });
  afterAll(() => {
    if (originalActive === undefined) {
      delete process.env.SECRET_ENCRYPTION_KEY;
    } else {
      process.env.SECRET_ENCRYPTION_KEY = originalActive;
    }
    if (originalOld === undefined) {
      delete process.env.SECRET_ENCRYPTION_KEY_OLD;
    } else {
      process.env.SECRET_ENCRYPTION_KEY_OLD = originalOld;
    }
  });

  it('re-encrypts adapter + client secrets under the new active key', async () => {
    // Step 1 — encrypt with old key (simulating data at rest).
    process.env.SECRET_ENCRYPTION_KEY = oldKey;
    const oldSvc = new EncryptedSecretService();
    const oldAdapterSecret = oldSvc.encrypt(
      JSON.stringify({ webhookSecret: 'rotate-me' }),
    );
    const oldClientSecret = oldSvc.encrypt('IMPORTER-12345');

    // Step 2 — promote new key to active, retain old key in _OLD slot.
    process.env.SECRET_ENCRYPTION_KEY = newKey;
    process.env.SECRET_ENCRYPTION_KEY_OLD = oldKey;
    const newSvc = new EncryptedSecretService();

    const adapters = createRepoMock<BrokerAdapterEntity>([
      {
        id: 'adp-1',
        encryptedConfig: oldAdapterSecret,
      } as unknown as BrokerAdapterEntity,
    ]);
    const clients = createRepoMock<BrokerClientEntity>([
      {
        id: 'client-1',
        encryptedImporterId: oldClientSecret,
      } as unknown as BrokerClientEntity,
    ]);
    // SecretRotationService uses TypeORM Not(IsNull()) — the in-memory mock
    // can't evaluate that operator, so we narrow `find` to return every
    // row regardless of the where clause. The rotation logic itself still
    // re-encrypts and re-saves through the mock.
    adapters.find = jest.fn(async () => [...adapters.__store]) as any;
    clients.find = jest.fn(async () => [...clients.__store]) as any;

    const rotation = new SecretRotationService(
      adapters as any,
      clients as any,
      newSvc,
    );
    const reports = await rotation.rotateAll({ batchSize: 50 });
    expect(reports).toHaveLength(2);
    expect(reports[0].scope).toBe('broker_adapters.encrypted_config');
    expect(reports[0].rotated).toBe(1);
    expect(reports[0].errors).toBe(0);
    expect(reports[1].scope).toBe('broker_clients.encrypted_importer_id');
    expect(reports[1].rotated).toBe(1);
    expect(reports[1].errors).toBe(0);

    // Verify the new ciphertext decrypts under the active key.
    const rotatedAdapter = adapters.__store[0];
    const rotatedClient = clients.__store[0];
    expect(JSON.parse(newSvc.decrypt(rotatedAdapter.encryptedConfig!))).toEqual({
      webhookSecret: 'rotate-me',
    });
    expect(newSvc.decrypt(rotatedClient.encryptedImporterId!)).toBe(
      'IMPORTER-12345',
    );
  });

  it('refuses to rotate when SECRET_ENCRYPTION_KEY_OLD is not configured', async () => {
    process.env.SECRET_ENCRYPTION_KEY = newKey;
    delete process.env.SECRET_ENCRYPTION_KEY_OLD;
    const svc = new EncryptedSecretService();
    const rotation = new SecretRotationService(
      createRepoMock<BrokerAdapterEntity>() as any,
      createRepoMock<BrokerClientEntity>() as any,
      svc,
    );
    await expect(rotation.rotateAll()).rejects.toThrow(/must be set/);
  });
});
