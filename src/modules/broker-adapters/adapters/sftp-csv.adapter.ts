import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve as resolvePath } from 'path';
import {
  AdapterArtifact,
  AdapterContext,
  AdapterDeliveryResult,
  BrokerExportAdapter,
} from './adapter.contract';
import { GenericCsvAdapter } from './generic-csv.adapter';

/**
 * SFTP transport contract — production rebinds this token with a real
 * ssh2-sftp-client (or similar) wrapper. The default LocalDiskSftpTransport
 * writes to disk for dev/test.
 */
export abstract class SftpTransport {
  abstract readonly providerKey: string;
  abstract deliver(
    config: SftpDeliveryConfig,
    payload: AdapterArtifact,
  ): Promise<{ delivered: boolean; uri: string; error?: string }>;
}

export interface SftpDeliveryConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  remoteDir: string;
}

export const SFTP_TRANSPORT = 'SFTP_TRANSPORT' as const;

@Injectable()
export class LocalDiskSftpTransport extends SftpTransport {
  readonly providerKey = 'local-disk';
  private readonly logger = new Logger(LocalDiskSftpTransport.name);
  private readonly root: string;

  constructor() {
    super();
    this.root = resolvePath(
      process.env.BROKER_ADAPTER_SFTP_LOCAL_PATH ||
        './var/broker-sftp-outbox',
    );
    this.logger.log(`Local SFTP outbox root: ${this.root}`);
  }

  async deliver(
    config: SftpDeliveryConfig,
    payload: AdapterArtifact,
  ): Promise<{ delivered: boolean; uri: string; error?: string }> {
    try {
      // Even in local mode we honour config.remoteDir so the produced path
      // mirrors what a real SFTP drop would look like — easier to compare
      // payloads between dev and prod.
      const safeDir = config.remoteDir.replace(/[^a-zA-Z0-9_\-./]/g, '_');
      const dir = resolvePath(this.root, safeDir);
      const path = resolvePath(dir, payload.fileName);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, payload.body);
      return { delivered: true, uri: `file://${path}` };
    } catch (err) {
      return {
        delivered: false,
        uri: '',
        error: (err as Error).message,
      };
    }
  }
}

/**
 * R2-C-04 — generic SFTP CSV export. Reuses the GenericCsvAdapter to
 * build the artifact body, then hands off to the bound SftpTransport for
 * delivery. publicConfig must contain { host, port, remoteDir }; secrets
 * carry { sftpUsername, sftpPassword | sftpPrivateKey }.
 */
@Injectable()
export class SftpCsvAdapter implements BrokerExportAdapter {
  readonly key = 'sftp_csv' as const;
  private readonly logger = new Logger(SftpCsvAdapter.name);

  constructor(
    private readonly csv: GenericCsvAdapter,
    @Optional() @Inject(SFTP_TRANSPORT) private readonly transport: SftpTransport | null,
  ) {
    if (!transport) {
      this.logger.warn(
        'SftpCsvAdapter has no SFTP_TRANSPORT binding — deliver() will report unavailable',
      );
    }
  }

  build(ctx: AdapterContext): Promise<AdapterArtifact> {
    return this.csv.build(ctx);
  }

  async deliver(
    ctx: AdapterContext,
    artifact: AdapterArtifact,
  ): Promise<AdapterDeliveryResult> {
    if (!this.transport) {
      return {
        delivered: false,
        error: 'SFTP transport not configured on this deploy',
      };
    }
    const cfg = ctx.adapter.publicConfig as Record<string, unknown> | null;
    const secrets = ctx.decryptedSecrets ?? {};
    const host = String(cfg?.host ?? '');
    const port = Number(cfg?.port ?? 22);
    const remoteDir = String(cfg?.remoteDir ?? '/');
    const username = String(secrets.sftpUsername ?? cfg?.username ?? '');
    if (!host || !username) {
      return {
        delivered: false,
        error: 'SFTP adapter requires publicConfig.host + secrets.sftpUsername',
      };
    }
    const delivery = await this.transport.deliver(
      {
        host,
        port,
        username,
        password: secrets.sftpPassword,
        privateKey: secrets.sftpPrivateKey,
        remoteDir,
      },
      artifact,
    );
    return {
      delivered: delivery.delivered,
      requestSummary: {
        provider: this.transport.providerKey,
        uri: delivery.uri,
        byteSize: artifact.body.byteLength,
      },
      error: delivery.error,
    };
  }

  requiredFields(): string[] {
    return this.csv.requiredFields();
  }
}
