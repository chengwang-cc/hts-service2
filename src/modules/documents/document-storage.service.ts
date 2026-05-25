import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';

export interface DocumentUploadInput {
  organizationId: string;
  ownerUserId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  purpose: string;
}

export interface StoredDocument {
  storageKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export interface ReadUrlOptions {
  /** Expected tenant org id; the adapter must refuse keys that don't match. */
  organizationId: string;
  /** Suggested URL lifetime in seconds. Adapters may clamp. */
  expiresInSeconds?: number;
  /** Optional file name to suggest in the presigned URL response. */
  fileName?: string;
}

export abstract class DocumentStorageAdapter {
  abstract readonly providerKey: string;
  abstract store(input: DocumentUploadInput): Promise<StoredDocument>;
  /**
   * Returns a short-lived URL to fetch the stored object. Adapters must
   * enforce that the storage key belongs to the supplied organization
   * before issuing a URL (defense in depth — controllers also tenant-check).
   */
  abstract createReadUrl(
    storageKey: string,
    opts: ReadUrlOptions,
  ): Promise<string>;
}

export const DOCUMENT_STORAGE_ADAPTER = 'DOCUMENT_STORAGE_ADAPTER' as const;

@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);

  constructor(
    @Optional()
    @Inject(DOCUMENT_STORAGE_ADAPTER)
    private readonly adapter: DocumentStorageAdapter | null = null,
  ) {
    if (!adapter) {
      this.logger.warn(
        'DocumentStorageService booted without an adapter — all store/createReadUrl calls will throw',
      );
    } else {
      this.logger.log(
        `DocumentStorageService using adapter: ${adapter.providerKey}`,
      );
    }
  }

  /**
   * Compose a tenant-scoped storage key with a deterministic content hash.
   * Keys always start with `<purpose>/<organizationId>/...` so the adapter
   * can verify ownership at read time without an extra DB lookup.
   */
  buildKey(
    purpose: string,
    organizationId: string,
    parts: string[],
    sha256: string,
  ): string {
    const safe = [purpose, organizationId, ...parts]
      .map((s) => s.replace(/[^a-zA-Z0-9_\-./]/g, '_'))
      .join('/');
    return `${safe}/${sha256}`;
  }

  async store(input: DocumentUploadInput): Promise<StoredDocument> {
    if (!this.adapter) {
      throw new NotImplementedException(
        'Document storage adapter is not configured',
      );
    }
    if (!input.organizationId) {
      throw new InternalServerErrorException(
        'Tenant context required to store a document',
      );
    }
    return this.adapter.store(input);
  }

  async createReadUrl(
    storageKey: string,
    opts: ReadUrlOptions,
  ): Promise<string> {
    if (!this.adapter) {
      throw new NotImplementedException(
        'Document storage adapter is not configured',
      );
    }
    if (!opts.organizationId) {
      throw new ForbiddenException(
        'Tenant context required for storage URL signing',
      );
    }
    if (!this.keyBelongsToTenant(storageKey, opts.organizationId)) {
      throw new ForbiddenException('Storage key belongs to another tenant');
    }
    return this.adapter.createReadUrl(storageKey, opts);
  }

  fingerprint(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Storage keys are formatted as `<purpose>/<organizationId>/...` — refuse
   * to sign URLs for keys that don't match the caller's tenant.
   */
  keyBelongsToTenant(storageKey: string, organizationId: string): boolean {
    if (!storageKey || !organizationId) return false;
    const segments = storageKey.split('/');
    // Expect at least: [purpose, orgId, ...rest, sha]
    return segments.length >= 3 && segments[1] === organizationId;
  }

  get providerKey(): string {
    return this.adapter?.providerKey ?? 'none';
  }
}
