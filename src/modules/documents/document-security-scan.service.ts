import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

export interface DocumentScanInput {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface DocumentScanResult {
  status: 'clean' | 'blocked' | 'unavailable';
  provider: string;
  reason?: string;
}

export abstract class DocumentSecurityScanAdapter {
  abstract readonly providerKey: string;
  abstract scan(input: DocumentScanInput): Promise<DocumentScanResult>;
}

export const DOCUMENT_SCAN_ADAPTER = 'DOCUMENT_SCAN_ADAPTER' as const;

const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * Default scanner — enforces a size limit and refuses the EICAR test string
 * so dev environments fail loudly on the standard antivirus probe. Production
 * deploys should supply a real adapter (ClamAV, Lambda, vendor API) via
 * DOCUMENT_SCAN_ADAPTER token.
 */
@Injectable()
export class LocalPolicyScanAdapter extends DocumentSecurityScanAdapter {
  readonly providerKey = 'local-policy';

  async scan(input: DocumentScanInput): Promise<DocumentScanResult> {
    const maxBytes = Number(process.env.DOCUMENT_SCAN_MAX_BYTES || 25_000_000);
    if (input.content.byteLength > maxBytes) {
      return {
        status: 'blocked',
        provider: this.providerKey,
        reason: `File exceeds configured scan size limit (${maxBytes} bytes)`,
      };
    }
    // EICAR is a 68-byte ASCII signature. Cheap substring check is enough.
    if (
      input.content.byteLength < 4096 &&
      input.content.toString('utf8').includes(EICAR_SIGNATURE)
    ) {
      return {
        status: 'blocked',
        provider: this.providerKey,
        reason: 'EICAR test signature detected',
      };
    }
    return { status: 'clean', provider: this.providerKey };
  }
}

@Injectable()
export class DocumentSecurityScanService {
  private readonly logger = new Logger(DocumentSecurityScanService.name);

  constructor(
    @Optional()
    @Inject(DOCUMENT_SCAN_ADAPTER)
    private readonly adapter: DocumentSecurityScanAdapter | null,
    private readonly defaultAdapter: LocalPolicyScanAdapter,
  ) {
    const provider = (adapter ?? defaultAdapter).providerKey;
    this.logger.log(`Document scanning provider: ${provider}`);
  }

  async scan(input: DocumentScanInput): Promise<DocumentScanResult> {
    const adapter = this.adapter ?? this.defaultAdapter;
    try {
      return await adapter.scan(input);
    } catch (err) {
      this.logger.warn(
        `Scan adapter ${adapter.providerKey} failed: ${(err as Error).message} — treating as unavailable`,
      );
      return {
        status: 'unavailable',
        provider: adapter.providerKey,
        reason: (err as Error).message,
      };
    }
  }
}
