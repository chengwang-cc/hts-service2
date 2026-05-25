import { Logger, Module } from '@nestjs/common';
import { LocalDiskStorageAdapter } from './adapters/local-disk-storage.adapter';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';
import { DocumentsController } from './controllers/documents.controller';
import {
  DocumentSecurityScanAdapter,
  DocumentSecurityScanService,
  DOCUMENT_SCAN_ADAPTER,
  LocalPolicyScanAdapter,
} from './document-security-scan.service';
import {
  DocumentStorageAdapter,
  DocumentStorageService,
  DOCUMENT_STORAGE_ADAPTER,
} from './document-storage.service';

const logger = new Logger('DocumentsModule');

function resolveStorageProvider(): 'local' | 's3' {
  const requested = (
    process.env.DOCUMENT_STORAGE_PROVIDER || ''
  ).toLowerCase();
  if (requested === 's3' || requested === 'local') return requested;
  // Auto-select: if an S3 bucket is configured, use S3; else local-disk.
  if (
    process.env.DOCUMENT_STORAGE_S3_BUCKET ||
    process.env.S3_BUCKET_NAME
  ) {
    return 's3';
  }
  return 'local';
}

const storageProvider = resolveStorageProvider();
logger.log(`Document storage provider resolved to "${storageProvider}"`);

@Module({
  controllers: [DocumentsController],
  providers: [
    LocalDiskStorageAdapter,
    S3StorageAdapter,
    LocalPolicyScanAdapter,
    {
      provide: DOCUMENT_STORAGE_ADAPTER,
      inject: [LocalDiskStorageAdapter, S3StorageAdapter],
      useFactory: (
        local: LocalDiskStorageAdapter,
        s3: S3StorageAdapter,
      ): DocumentStorageAdapter => (storageProvider === 's3' ? s3 : local),
    },
    {
      // Pluggable scan adapter — default to local-policy. Production deploys
      // can rebind DOCUMENT_SCAN_ADAPTER via a custom module.
      provide: DOCUMENT_SCAN_ADAPTER,
      inject: [LocalPolicyScanAdapter],
      useFactory: (local: LocalPolicyScanAdapter): DocumentSecurityScanAdapter =>
        local,
    },
    DocumentStorageService,
    DocumentSecurityScanService,
  ],
  exports: [
    DocumentStorageService,
    DocumentSecurityScanService,
    LocalDiskStorageAdapter,
  ],
})
export class DocumentsModule {}
