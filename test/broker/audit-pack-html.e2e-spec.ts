import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalDiskStorageAdapter } from '../../src/modules/documents/adapters/local-disk-storage.adapter';
import { DocumentStorageService } from '../../src/modules/documents/document-storage.service';
import { BrokerPostEntryService } from '../../src/modules/broker-post-entry/services/broker-post-entry.service';
import { createAuditMock, createRepoMock, ctx } from './helpers';
import type {
  BrokerAuditPackEntity,
  BrokerPostEntryCaseEntity,
} from '../../src/modules/broker-post-entry/entities';

describe('R2-E-01/02: audit pack HTML rendering + download URL', () => {
  let tmp: string;
  let storage: DocumentStorageService;

  beforeEach(async () => {
    tmp = join(
      tmpdir(),
      `audit-pack-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tmp, { recursive: true });
    process.env.DOCUMENT_STORAGE_LOCAL_PATH = tmp;
    process.env.DOCUMENT_STORAGE_LOCAL_SIGNING_SECRET = 'unit';
    storage = new DocumentStorageService(new LocalDiskStorageAdapter());
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function build(initialPack: Partial<BrokerAuditPackEntity>) {
    const cases = createRepoMock<BrokerPostEntryCaseEntity>();
    const packs = createRepoMock<BrokerAuditPackEntity>([
      initialPack as BrokerAuditPackEntity,
    ]);
    // The constructor signature is long; we only need cases, packs, audit,
    // and storage to exercise renderAuditPackHtml + getAuditPackDownloadUrl.
    // Everything else gets a no-op repo stub.
    const noop = createRepoMock();
    const svc = new BrokerPostEntryService(
      cases as any,
      packs as any,
      noop as any, // entries
      noop as any, // lines
      noop as any, // packets
      noop as any, // documents
      noop as any, // fields
      noop as any, // suggestions
      noop as any, // decisions
      noop as any, // validationResults
      noop as any, // exportJobs
      noop as any, // statusMessages
      createAuditMock(),
      storage,
    );
    return { svc, packs };
  }

  it('renders an HTML pack from an existing JSON pack manifest', async () => {
    const sourceId = '11111111-1111-1111-1111-111111111111';
    const { svc, packs } = build({
      id: sourceId,
      brokerOrganizationId: ctx.organizationId,
      entryId: 'entry-1',
      format: 'json',
      storageKey: `broker-audit-packs/${ctx.organizationId}/entry-1/json-key`,
      sha256: 'abc',
      byteSize: 10,
      manifest: {
        version: 1,
        generatedAt: '2026-05-25T00:00:00Z',
        entry: {
          id: 'entry-1',
          entryNumber: 'E-001',
          status: 'approved',
        },
        lines: [
          {
            lineNumber: 1,
            htsNumber: '6109.10.00',
            description: 'cotton tees',
            countryOfOrigin: 'VN',
            quantity: '100',
            totalValue: '450.0000',
          },
        ],
      },
    });
    const htmlPack = await svc.renderAuditPackHtml(ctx, sourceId);
    expect(htmlPack.format).toBe('html');
    expect(htmlPack.byteSize).toBeGreaterThan(100);
    expect(packs.__store).toHaveLength(2);
    // The signed download URL exposes the local-disk dev path.
    const url = await svc.getAuditPackDownloadUrl(ctx, htmlPack.id);
    expect(url.url).toContain('/api/v1/documents/local/');
    expect(url.packId).toBe(htmlPack.id);
  });

  it('refuses cross-tenant download URL requests', async () => {
    const sourceId = '22222222-2222-2222-2222-222222222222';
    const { svc } = build({
      id: sourceId,
      brokerOrganizationId: 'other-org',
      entryId: 'entry-x',
      format: 'json',
      storageKey: 'broker-audit-packs/other-org/entry-x/key',
      sha256: 'x',
      byteSize: 5,
      manifest: { entry: {}, lines: [] },
    });
    await expect(svc.getAuditPackDownloadUrl(ctx, sourceId)).rejects.toThrow(
      /another tenant/i,
    );
  });
});
