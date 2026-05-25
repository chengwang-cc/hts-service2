import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import {
  BrokerAdapterEntity,
  BrokerExportJobEntity,
  BrokerStatusMessageEntity,
} from '../broker-adapters/entities';
import {
  BrokerAiSuggestionEntity,
  BrokerDecisionEntity,
} from '../broker-decisions/entities';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../broker-entries/entities';
import {
  BrokerDocumentEntity,
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from '../broker-packets/entities';
import { BrokerValidationResultEntity } from '../broker-rules/entities';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { BrokerPostEntryController } from './controllers/broker-post-entry.controller';
import {
  BrokerAuditPackEntity,
  BrokerPostEntryCaseEntity,
} from './entities';
import { PolicyChangeBridge } from './jobs/policy-change-bridge.service';
import { BrokerPostEntryTimerWorker } from './jobs/post-entry-timer.worker';
import { BrokerPostEntryService } from './services/broker-post-entry.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerPostEntryCaseEntity,
      BrokerAuditPackEntity,
      BrokerEntryEntity,
      BrokerEntryLineEntity,
      BrokerDocumentPacketEntity,
      BrokerDocumentEntity,
      BrokerExtractedFieldEntity,
      BrokerAiSuggestionEntity,
      BrokerDecisionEntity,
      BrokerValidationResultEntity,
      BrokerAdapterEntity,
      BrokerExportJobEntity,
      BrokerStatusMessageEntity,
    ]),
    AuditModule,
    DocumentsModule,
    NotificationsModule,
    QueueModule,
  ],
  controllers: [BrokerPostEntryController],
  providers: [
    BrokerPostEntryService,
    BrokerPostEntryTimerWorker,
    PolicyChangeBridge,
  ],
  exports: [BrokerPostEntryService, PolicyChangeBridge],
})
export class BrokerPostEntryModule {}
