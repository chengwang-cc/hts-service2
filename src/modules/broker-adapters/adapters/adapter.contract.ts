import { BrokerEntryEntity } from '../../broker-entries/entities/broker-entry.entity';
import { BrokerEntryLineEntity } from '../../broker-entries/entities/broker-entry-line.entity';
import { BrokerAdapterEntity } from '../entities/broker-adapter.entity';

export interface AdapterContext {
  adapter: BrokerAdapterEntity;
  entry: BrokerEntryEntity;
  lines: BrokerEntryLineEntity[];
  decryptedSecrets?: Record<string, string>;
}

export interface AdapterArtifact {
  contentType: string;
  fileName: string;
  body: Buffer;
}

export interface AdapterDeliveryResult {
  delivered: boolean;
  requestSummary?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
  error?: string;
}

export interface BrokerExportAdapter {
  readonly key: BrokerAdapterEntity['adapterType'];
  /** Builds the entry artifact (CSV, JSON, EDI etc.) */
  build(ctx: AdapterContext): Promise<AdapterArtifact>;
  /** Delivers the artifact to the provider (webhook, SFTP, etc.). For
   * download-only adapters, returns delivered:true without contacting any
   * external system. */
  deliver?(ctx: AdapterContext, artifact: AdapterArtifact): Promise<AdapterDeliveryResult>;
  /** Declares the fields the adapter requires for export. */
  requiredFields(): string[];
}
