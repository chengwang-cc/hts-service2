import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import {
  DocumentStorageAdapter,
  DocumentUploadInput,
  ReadUrlOptions,
  StoredDocument,
} from '../document-storage.service';

/**
 * S3 adapter — reads bucket + region from env. Storage keys are
 * `<purpose>/<organizationId>/<sha256>` so a stolen presigned URL only
 * leaks one object, and read-URL signing refuses cross-tenant keys.
 */
@Injectable()
export class S3StorageAdapter extends DocumentStorageAdapter {
  readonly providerKey = 's3';
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor() {
    super();
    const region = process.env.AWS_REGION || 'us-east-1';
    const bucket =
      process.env.DOCUMENT_STORAGE_S3_BUCKET || process.env.S3_BUCKET_NAME;
    if (!bucket) {
      throw new InternalServerErrorException(
        'S3StorageAdapter requires DOCUMENT_STORAGE_S3_BUCKET or S3_BUCKET_NAME',
      );
    }
    this.bucket = bucket;
    this.keyPrefix = (
      process.env.DOCUMENT_STORAGE_S3_PREFIX || 'documents'
    ).replace(/^\/+|\/+$/g, '');
    this.client = new S3Client({ region });
    this.logger.log(
      `S3 storage configured: bucket=${this.bucket} prefix=${this.keyPrefix} region=${region}`,
    );
  }

  async store(input: DocumentUploadInput): Promise<StoredDocument> {
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const storageKey = `${input.purpose}/${input.organizationId}/${sha256}`;
    const objectKey = this.toObjectKey(storageKey);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: input.content,
        ContentType: input.mimeType,
        Metadata: {
          'organization-id': input.organizationId,
          'owner-user-id': input.ownerUserId,
          'original-filename': sanitizeForHeader(input.fileName),
          purpose: input.purpose,
        },
      }),
    );
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
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.toObjectKey(storageKey),
      ResponseContentDisposition: opts.fileName
        ? `attachment; filename="${sanitizeForHeader(opts.fileName)}"`
        : undefined,
    });
    const expiresIn = Math.min(
      Math.max(opts.expiresInSeconds ?? 300, 30),
      3600,
    );
    return getSignedUrl(this.client, command, { expiresIn });
  }

  private toObjectKey(storageKey: string): string {
    return this.keyPrefix ? `${this.keyPrefix}/${storageKey}` : storageKey;
  }
}

function sanitizeForHeader(value: string): string {
  return value.replace(/[\r\n"\\]/g, '_');
}
