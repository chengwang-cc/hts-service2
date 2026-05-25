import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ForbiddenException } from '@nestjs/common';
import { LocalDiskStorageAdapter } from '../../src/modules/documents/adapters/local-disk-storage.adapter';
import {
  DocumentStorageService,
} from '../../src/modules/documents/document-storage.service';
import {
  DocumentSecurityScanService,
  LocalPolicyScanAdapter,
} from '../../src/modules/documents/document-security-scan.service';

describe('Document storage and scan (R0-A)', () => {
  let tmp: string;
  let adapter: LocalDiskStorageAdapter;
  let service: DocumentStorageService;

  beforeEach(async () => {
    tmp = await mkdtemp();
    process.env.DOCUMENT_STORAGE_LOCAL_PATH = tmp;
    process.env.DOCUMENT_STORAGE_LOCAL_SIGNING_SECRET = 'unit-test-secret';
    adapter = new LocalDiskStorageAdapter();
    service = new DocumentStorageService(adapter);
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('stores bytes under a tenant-prefixed path and round-trips through the signed URL', async () => {
    const stored = await service.store({
      organizationId: 'org-A',
      ownerUserId: 'user-1',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('hello, world'),
      purpose: 'broker-packets',
    });
    expect(stored.storageKey).toMatch(/^broker-packets\/org-A\//);
    expect(stored.byteSize).toBe(12);
    const url = await service.createReadUrl(stored.storageKey, {
      organizationId: 'org-A',
      fileName: 'invoice.pdf',
    });
    expect(url).toContain('/api/v1/documents/local/');
    // Pull params out of the URL and exercise the signed-read path.
    const parsed = new URL(url);
    const sig = parsed.searchParams.get('sig')!;
    const exp = Number(parsed.searchParams.get('exp'));
    const read = await adapter.readForSignedUrl(
      stored.storageKey,
      'org-A',
      exp,
      sig,
    );
    expect(read.content.toString()).toBe('hello, world');
  });

  it('refuses to sign a read URL for a key that does not belong to the caller tenant (R0-A-05)', async () => {
    const stored = await service.store({
      organizationId: 'org-A',
      ownerUserId: 'user-1',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('secret bytes'),
      purpose: 'broker-packets',
    });
    await expect(
      service.createReadUrl(stored.storageKey, { organizationId: 'org-B' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to fulfill a signed URL whose tenant suffix was tampered with', async () => {
    const stored = await service.store({
      organizationId: 'org-A',
      ownerUserId: 'user-1',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('secret bytes'),
      purpose: 'broker-packets',
    });
    const url = await service.createReadUrl(stored.storageKey, {
      organizationId: 'org-A',
    });
    const parsed = new URL(url);
    const exp = Number(parsed.searchParams.get('exp'));
    const sig = parsed.searchParams.get('sig')!;
    // Caller flips the org param to try to read another tenant's key.
    await expect(
      adapter.readForSignedUrl(stored.storageKey, 'org-evil', exp, sig),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks the EICAR test signature (R0-A-04)', async () => {
    const scan = new DocumentSecurityScanService(null, new LocalPolicyScanAdapter());
    const eicar = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      'ascii',
    );
    const result = await scan.scan({
      fileName: 'eicar.com',
      mimeType: 'application/octet-stream',
      content: eicar,
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('EICAR');
  });
});

async function mkdtemp() {
  const dir = join(
    tmpdir(),
    `doc-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
