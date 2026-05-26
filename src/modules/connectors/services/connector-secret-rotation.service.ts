import {
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { ConnectorEntity } from '@hts/connectors';
import {
  EncryptedSecret,
  EncryptedSecretService,
} from '../../security/encrypted-secret.service';

/**
 * Connector secret rotation + plaintext backfill.
 *
 * Two operations:
 *
 *   - `backfill()`: scan every connector row, find fields that are
 *     stored as plaintext strings (a Stripe-style `shpat_*` or `pk_*`
 *     leaking through legacy import paths), re-encrypt with the
 *     current key, write back. Re-runnable; idempotent.
 *
 *   - `rotate(oldKeyEnv)`: scan every connector row whose secret
 *     fields are encrypted with a previous key version, decrypt using
 *     the named legacy env (`SECRET_ENCRYPTION_KEY_OLD`), re-encrypt
 *     with the current key. Emits one audit row per rotated connector.
 *
 * The rotation flow expected by ops:
 *
 *   1. Set `SECRET_ENCRYPTION_KEY` to a freshly generated 32-byte key
 *      (also set `SECRET_ENCRYPTION_KEY_VERSION` to e.g. `v2`).
 *   2. Move the old key to `SECRET_ENCRYPTION_KEY_OLD`.
 *   3. Deploy. Existing rows now decrypt via the rotation path; new
 *      writes encrypt with the new key.
 *   4. Trigger this rotation worker (admin endpoint or pg-boss job)
 *      to migrate all stored rows to the new key.
 *   5. After confirmation, remove `SECRET_ENCRYPTION_KEY_OLD`.
 *
 * A small `keyPrefix` on `connector.metadata.secretKeyVersions` lets
 * operators tell at a glance which keys still have legacy versions —
 * it's a Stripe-style prefix that gets persisted on each saved row.
 */
export interface RotationReport {
  total: number;
  scanned: number;
  rotated: number;
  backfilled: number;
  skipped: number;
  errors: number;
  perConnectorErrors: Array<{ id: string; reason: string }>;
}

const SECRET_FIELDS = ['accessToken', 'apiSecret', 'apiKey'] as const;

@Injectable()
export class ConnectorSecretRotationService {
  private readonly logger = new Logger(ConnectorSecretRotationService.name);

  constructor(
    @InjectRepository(ConnectorEntity)
    private readonly connectors: Repository<ConnectorEntity>,
    private readonly secrets: EncryptedSecretService,
    @Optional() private readonly audit: AuditService | null = null,
  ) {}

  /**
   * Walk all connectors and re-encrypt plaintext secret strings. Safe
   * to call repeatedly; rows that are already enveloped are skipped.
   */
  async backfill(): Promise<RotationReport> {
    const all = await this.connectors.find();
    const report: RotationReport = {
      total: all.length,
      scanned: 0,
      rotated: 0,
      backfilled: 0,
      skipped: 0,
      errors: 0,
      perConnectorErrors: [],
    };
    for (const connector of all) {
      report.scanned += 1;
      try {
        const config = (connector.config ?? {}) as Record<string, unknown>;
        let touched = false;
        for (const field of SECRET_FIELDS) {
          const value = config[field];
          if (typeof value === 'string' && value && value !== '***') {
            config[field] = this.secrets.encrypt(value);
            touched = true;
          }
        }
        if (touched) {
          connector.config = this.stampMetadata(config, connector);
          await this.connectors.save(connector);
          report.backfilled += 1;
          await this.recordAudit(connector.id, 'backfill');
        } else {
          report.skipped += 1;
        }
      } catch (e: any) {
        report.errors += 1;
        report.perConnectorErrors.push({
          id: connector.id,
          reason: e?.message ?? String(e),
        });
        this.logger.warn(
          `connector ${connector.id} backfill failed: ${e?.message ?? e}`,
        );
      }
    }
    this.logger.log(
      `connector.backfill scanned=${report.scanned} backfilled=${report.backfilled} skipped=${report.skipped} errors=${report.errors}`,
    );
    return report;
  }

  /**
   * Rotate every connector row whose `keyVersion` does not match the
   * current key. Reads old ciphertext using `oldKeyEnv` (default
   * `SECRET_ENCRYPTION_KEY_OLD`), re-encrypts under the current key.
   */
  async rotate(oldKeyEnv = 'SECRET_ENCRYPTION_KEY_OLD'): Promise<RotationReport> {
    const currentVersion = process.env.SECRET_ENCRYPTION_KEY_VERSION || 'v1';
    const all = await this.connectors.find();
    const report: RotationReport = {
      total: all.length,
      scanned: 0,
      rotated: 0,
      backfilled: 0,
      skipped: 0,
      errors: 0,
      perConnectorErrors: [],
    };
    for (const connector of all) {
      report.scanned += 1;
      try {
        const config = (connector.config ?? {}) as Record<string, unknown>;
        let touched = false;
        for (const field of SECRET_FIELDS) {
          const value = config[field];
          if (isEnvelope(value)) {
            if ((value as EncryptedSecret).keyVersion === currentVersion) {
              continue;
            }
            config[field] = this.secrets.rotateSecret(
              value as EncryptedSecret,
              oldKeyEnv,
            );
            touched = true;
          }
        }
        if (touched) {
          connector.config = this.stampMetadata(config, connector);
          await this.connectors.save(connector);
          report.rotated += 1;
          await this.recordAudit(connector.id, 'rotate');
        } else {
          report.skipped += 1;
        }
      } catch (e: any) {
        report.errors += 1;
        report.perConnectorErrors.push({
          id: connector.id,
          reason: e?.message ?? String(e),
        });
        this.logger.warn(
          `connector ${connector.id} rotate failed: ${e?.message ?? e}`,
        );
      }
    }
    this.logger.log(
      `connector.rotate scanned=${report.scanned} rotated=${report.rotated} skipped=${report.skipped} errors=${report.errors}`,
    );
    return report;
  }

  private stampMetadata(
    config: Record<string, unknown>,
    connector: ConnectorEntity,
  ): ConnectorEntity['config'] {
    const versions: Record<string, string> = {};
    for (const field of SECRET_FIELDS) {
      const value = config[field];
      if (isEnvelope(value)) {
        versions[field] = (value as EncryptedSecret).keyVersion ?? 'v1';
      }
    }
    const existingMetadata = (connector.metadata ?? {}) as Record<string, unknown>;
    connector.metadata = {
      ...existingMetadata,
      secretKeyVersions: versions,
    };
    return config as ConnectorEntity['config'];
  }

  private async recordAudit(
    connectorId: string,
    action: 'rotate' | 'backfill',
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.record({
      eventType: `connector.secret_${action}`,
      actorUserId: 'connector-rotation-worker',
      resourceType: 'connector',
      resourceId: connectorId,
      source: 'connectors',
      metadata: {
        keyVersion: process.env.SECRET_ENCRYPTION_KEY_VERSION || 'v1',
      },
    });
  }
}

function isEnvelope(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EncryptedSecret).algorithm === 'aes-256-gcm' &&
    typeof (value as EncryptedSecret).ciphertext === 'string'
  );
}
