import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import {
  DocumentStorageAdapter,
  DocumentUploadInput,
  ReadUrlOptions,
  StoredDocument,
} from '../document-storage.service';

/**
 * Local-disk adapter — only intended for dev/test. Stores bytes under a
 * tenant-prefixed path and serves them through a signed pseudo-URL that the
 * documents controller resolves back to a file read. Production must use the
 * S3 adapter (DOCUMENT_STORAGE_PROVIDER=s3).
 */
@Injectable()
export class LocalDiskStorageAdapter extends DocumentStorageAdapter {
  readonly providerKey = 'local-disk';
  private readonly logger = new Logger(LocalDiskStorageAdapter.name);
  private readonly root: string;
  private readonly secret: string;

  constructor() {
    super();
    this.root = resolve(
      process.env.DOCUMENT_STORAGE_LOCAL_PATH || './var/document-storage',
    );
    this.secret =
      process.env.DOCUMENT_STORAGE_LOCAL_SIGNING_SECRET ||
      'local-dev-document-signing-secret';
    this.logger.log(`Local document storage root: ${this.root}`);
  }

  async store(input: DocumentUploadInput): Promise<StoredDocument> {
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const storageKey = `${input.purpose}/${input.organizationId}/${sha256}`;
    const fullPath = this.toAbsolute(storageKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.content);
    return {
      storageKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.content.byteLength,
      sha256,
    };
  }

  async createReadUrl(
    storageKey: string,
    opts: ReadUrlOptions,
  ): Promise<string> {
    if (!storageKey.includes(`/${opts.organizationId}/`)) {
      throw new ForbiddenException('Storage key belongs to another tenant');
    }
    const expiresAt =
      Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 300);
    const sig = this.sign(storageKey, opts.organizationId, expiresAt);
    const base =
      process.env.API_BASE_URL?.replace(/\/$/, '') ||
      `http://localhost:${process.env.PORT ?? 3100}`;
    return `${base}/api/v1/documents/local/${encodeURIComponent(storageKey)}?org=${opts.organizationId}&exp=${expiresAt}&sig=${sig}`;
  }

  /**
   * Resolve a signed local URL back to bytes. Used by the local-only
   * documents controller (R0-A-05) to serve previews in dev.
   */
  async readForSignedUrl(
    storageKey: string,
    organizationId: string,
    expires: number,
    sig: string,
  ): Promise<{ content: Buffer; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expires) || expires < now) {
      throw new ForbiddenException('Signed URL expired');
    }
    const expected = this.sign(storageKey, organizationId, expires);
    if (expected !== sig) {
      throw new ForbiddenException('Signed URL signature invalid');
    }
    if (!storageKey.includes(`/${organizationId}/`)) {
      throw new ForbiddenException('Storage key belongs to another tenant');
    }
    const fullPath = this.toAbsolute(storageKey);
    try {
      const content = await readFile(fullPath);
      return { content, expiresAt: expires };
    } catch (err) {
      this.logger.warn(
        `Local storage read failed for ${storageKey}: ${(err as Error).message}`,
      );
      throw new NotFoundException('Stored document not found');
    }
  }

  private toAbsolute(storageKey: string): string {
    // Defense: prevent path traversal via normalized resolve under root.
    const safe = storageKey.replace(/[^a-zA-Z0-9_\-./]/g, '_');
    const full = resolve(join(this.root, safe));
    if (!full.startsWith(this.root + sep) && full !== this.root) {
      throw new ForbiddenException('Refusing to write outside storage root');
    }
    return full;
  }

  private sign(
    storageKey: string,
    organizationId: string,
    expiresAt: number,
  ): string {
    return createHash('sha256')
      .update(`${storageKey}|${organizationId}|${expiresAt}|${this.secret}`)
      .digest('hex')
      .slice(0, 32);
  }
}
