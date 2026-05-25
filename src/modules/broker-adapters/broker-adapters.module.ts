import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OrgPermissionsGuard } from '../auth/guards/org-permissions.guard';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../broker-entries/entities';
import { BrokerTasksModule } from '../broker-tasks/broker-tasks.module';
import { QueueModule } from '../queue/queue.module';
import { SecurityModule } from '../security/security.module';
import { CargoWiseAdapter } from './adapters/cargowise.adapter';
import { DescartesAdapter } from './adapters/descartes.adapter';
import { GenericCsvAdapter } from './adapters/generic-csv.adapter';
import { JsonWebhookAdapter } from './adapters/json-webhook.adapter';
import { MagayaAcelynkAdapter } from './adapters/magaya-acelynk.adapter';
import { ProviderProfileAdapter } from './adapters/provider-profile.adapter';
import {
  LocalDiskSftpTransport,
  SftpCsvAdapter,
  SftpTransport,
  SFTP_TRANSPORT,
} from './adapters/sftp-csv.adapter';
import { BrokerAdaptersController } from './controllers/broker-adapters.controller';
import {
  BrokerAdapterEntity,
  BrokerExportJobEntity,
  BrokerStatusMessageEntity,
} from './entities';
import { AdapterStatusPollingWorker } from './jobs/adapter-status-polling.worker';
import { BrokerAdaptersService } from './services/broker-adapters.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerAdapterEntity,
      BrokerExportJobEntity,
      BrokerStatusMessageEntity,
      BrokerEntryEntity,
      BrokerEntryLineEntity,
    ]),
    AuditModule,
    SecurityModule,
    BrokerTasksModule,
    QueueModule,
  ],
  controllers: [BrokerAdaptersController],
  providers: [
    BrokerAdaptersService,
    GenericCsvAdapter,
    JsonWebhookAdapter,
    ProviderProfileAdapter,
    MagayaAcelynkAdapter,
    DescartesAdapter,
    CargoWiseAdapter,
    LocalDiskSftpTransport,
    {
      // R2-C-04 — production rebinds SFTP_TRANSPORT to a real ssh2-sftp-client
      // wrapper. Dev/test uses the local-disk transport.
      provide: SFTP_TRANSPORT,
      inject: [LocalDiskSftpTransport],
      useFactory: (local: LocalDiskSftpTransport): SftpTransport => local,
    },
    SftpCsvAdapter,
    AdapterStatusPollingWorker,
    OrgPermissionsGuard,
  ],
  exports: [BrokerAdaptersService],
})
export class BrokerAdaptersModule {}
