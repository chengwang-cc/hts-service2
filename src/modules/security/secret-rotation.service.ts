import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { BrokerAdapterEntity } from '../broker-adapters/entities/broker-adapter.entity';
import { BrokerClientEntity } from '../broker-core/entities/broker-client.entity';
import { EncryptedSecretService } from './encrypted-secret.service';

export interface RotationOptions {
  oldKeyEnv?: string;
  batchSize?: number;
  dryRun?: boolean;
}

export interface RotationReport {
  scope: string;
  scanned: number;
  rotated: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  oldKeyEnv: string;
}

/**
 * Re-encrypts stored secrets onto the active SECRET_ENCRYPTION_KEY by
 * decrypting with a legacy key (SECRET_ENCRYPTION_KEY_OLD by default).
 * Caller is responsible for setting the new key as active before invoking.
 */
@Injectable()
export class SecretRotationService {
  private readonly logger = new Logger(SecretRotationService.name);

  constructor(
    @InjectRepository(BrokerAdapterEntity)
    private readonly adapters: Repository<BrokerAdapterEntity>,
    @InjectRepository(BrokerClientEntity)
    private readonly clients: Repository<BrokerClientEntity>,
    private readonly secrets: EncryptedSecretService,
  ) {}

  async rotateAll(opts: RotationOptions = {}): Promise<RotationReport[]> {
    const oldKeyEnv = opts.oldKeyEnv || 'SECRET_ENCRYPTION_KEY_OLD';
    if (!process.env[oldKeyEnv]) {
      throw new BadRequestException(
        `${oldKeyEnv} must be set to the previous base64 key before rotation`,
      );
    }
    const adapterReport = await this.rotateBrokerAdapters(opts, oldKeyEnv);
    const clientReport = await this.rotateBrokerClients(opts, oldKeyEnv);
    return [adapterReport, clientReport];
  }

  private async rotateBrokerAdapters(
    opts: RotationOptions,
    oldKeyEnv: string,
  ): Promise<RotationReport> {
    const batchSize = opts.batchSize ?? 100;
    const report: RotationReport = {
      scope: 'broker_adapters.encrypted_config',
      scanned: 0,
      rotated: 0,
      skipped: 0,
      errors: 0,
      dryRun: Boolean(opts.dryRun),
      oldKeyEnv,
    };
    let offset = 0;
    while (true) {
      const rows = await this.adapters.find({
        where: { encryptedConfig: Not(IsNull()) },
        take: batchSize,
        skip: offset,
        order: { createdAt: 'ASC' },
      });
      if (!rows.length) break;
      for (const row of rows) {
        report.scanned += 1;
        if (!row.encryptedConfig) {
          report.skipped += 1;
          continue;
        }
        try {
          const rotated = this.secrets.rotateSecret(
            row.encryptedConfig,
            oldKeyEnv,
          );
          if (!opts.dryRun) {
            row.encryptedConfig = rotated;
            await this.adapters.save(row);
          }
          report.rotated += 1;
        } catch (err) {
          this.logger.warn(
            `Adapter ${row.id} rotation failed: ${(err as Error).message}`,
          );
          report.errors += 1;
        }
      }
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
    return report;
  }

  private async rotateBrokerClients(
    opts: RotationOptions,
    oldKeyEnv: string,
  ): Promise<RotationReport> {
    const batchSize = opts.batchSize ?? 100;
    const report: RotationReport = {
      scope: 'broker_clients.encrypted_importer_id',
      scanned: 0,
      rotated: 0,
      skipped: 0,
      errors: 0,
      dryRun: Boolean(opts.dryRun),
      oldKeyEnv,
    };
    let offset = 0;
    while (true) {
      const rows = await this.clients.find({
        where: { encryptedImporterId: Not(IsNull()) },
        take: batchSize,
        skip: offset,
        order: { createdAt: 'ASC' },
      });
      if (!rows.length) break;
      for (const row of rows) {
        report.scanned += 1;
        if (!row.encryptedImporterId) {
          report.skipped += 1;
          continue;
        }
        try {
          const rotated = this.secrets.rotateSecret(
            row.encryptedImporterId,
            oldKeyEnv,
          );
          if (!opts.dryRun) {
            row.encryptedImporterId = rotated;
            await this.clients.save(row);
          }
          report.rotated += 1;
        } catch (err) {
          this.logger.warn(
            `Client ${row.id} rotation failed: ${(err as Error).message}`,
          );
          report.errors += 1;
        }
      }
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
    return report;
  }
}
