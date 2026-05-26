import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnthropicService } from '../../core/services/anthropic.service';
import { AuditModule } from '../audit/audit.module';
import { OrgPermissionsGuard } from '../auth/guards/org-permissions.guard';
import { BrokerCoreModule } from '../broker-core/broker-core.module';
import { BrokerClientEntity } from '../broker-core/entities/broker-client.entity';
import { BrokerEntriesModule } from '../broker-entries/broker-entries.module';
import { BrokerShipmentEntity } from '../broker-entries/entities';
import { DocumentsModule } from '../documents/documents.module';
import { QueueModule } from '../queue/queue.module';
import {
  BrokerPacketsController,
  BrokerPortalUploadsController,
} from './controllers/broker-packets.controller';
import {
  BrokerDocumentEntity,
  BrokerDocumentPacketEntity,
  BrokerExtractedFieldEntity,
} from './entities';
import { TenantRateLimitGuard } from './guards/tenant-rate-limit.guard';
import { BrokerPacketsWorker } from './jobs/broker-packets-worker.service';
import { EmbeddingClassifierAdapter } from './services/classifiers/embedding-classifier.adapter';
import { HeuristicClassifierAdapter } from './services/classifiers/heuristic-classifier.adapter';
import {
  DocumentClassifierAdapter,
  DOCUMENT_CLASSIFIER_ADAPTER,
} from './services/classifiers/document-classifier.adapter';
import { AnthropicFieldExtractorAdapter } from './services/extractors/anthropic-field-extractor.adapter';
import {
  FieldExtractorAdapter,
  FIELD_EXTRACTOR_ADAPTER,
  FIELD_REASONER_ADAPTER,
} from './services/extractors/field-extractor.adapter';
import { StubFieldExtractorAdapter } from './services/extractors/stub-field-extractor.adapter';
import { BrokerPacketsService } from './services/broker-packets.service';
import { DocumentClassifierService } from './services/document-classifier.service';
import { FieldExtractorService } from './services/field-extractor.service';
import { PacketReconciliationService } from './services/reconciliation.service';

const logger = new Logger('BrokerPacketsModule');

function resolveExtractorProvider(): 'stub' | 'anthropic' {
  const env = (process.env.FIELD_EXTRACTOR_PROVIDER || '').toLowerCase();
  if (env === 'stub' || env === 'anthropic') return env;
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'stub';
}

function resolveClassifierProvider(): 'heuristic' | 'embedding' {
  const env = (process.env.DOCUMENT_CLASSIFIER_PROVIDER || '').toLowerCase();
  if (env === 'heuristic' || env === 'embedding') return env;
  return 'heuristic';
}

const extractorProvider = resolveExtractorProvider();
const classifierProvider = resolveClassifierProvider();
logger.log(
  `Resolved providers: extractor=${extractorProvider} classifier=${classifierProvider}`,
);

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BrokerDocumentPacketEntity,
      BrokerDocumentEntity,
      BrokerExtractedFieldEntity,
      BrokerClientEntity,
      BrokerShipmentEntity,
    ]),
    AuditModule,
    DocumentsModule,
    QueueModule,
    BrokerCoreModule,
    BrokerEntriesModule,
  ],
  controllers: [BrokerPacketsController, BrokerPortalUploadsController],
  providers: [
    // The packet module is the only consumer of AnthropicService outside of
    // lookup, so provide a local instance via the existing config wiring.
    {
      provide: AnthropicService,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => new AnthropicService(cfg),
    },
    StubFieldExtractorAdapter,
    AnthropicFieldExtractorAdapter,
    HeuristicClassifierAdapter,
    EmbeddingClassifierAdapter,
    {
      provide: FIELD_EXTRACTOR_ADAPTER,
      inject: [StubFieldExtractorAdapter, AnthropicFieldExtractorAdapter],
      useFactory: (
        stub: StubFieldExtractorAdapter,
        anthropic: AnthropicFieldExtractorAdapter,
      ): FieldExtractorAdapter =>
        extractorProvider === 'anthropic' ? anthropic : stub,
    },
    {
      // R1-E-04 — second-pass reasoner. Bound to the Anthropic adapter when
      // available and the primary is the stub; otherwise null so the
      // FieldExtractorService skips the second pass.
      provide: FIELD_REASONER_ADAPTER,
      inject: [AnthropicFieldExtractorAdapter],
      useFactory: (anthropic: AnthropicFieldExtractorAdapter) => {
        const enabled = (
          process.env.BROKER_EXTRACTOR_REASONER || 'auto'
        ).toLowerCase();
        if (enabled === 'off') return null;
        if (enabled === 'on') return anthropic;
        // 'auto' (default): only enable reasoner when primary is the stub,
        // since running the same model twice rarely improves results.
        return extractorProvider === 'stub' && process.env.ANTHROPIC_API_KEY
          ? anthropic
          : null;
      },
    },
    {
      provide: DOCUMENT_CLASSIFIER_ADAPTER,
      inject: [HeuristicClassifierAdapter, EmbeddingClassifierAdapter],
      useFactory: (
        heuristic: HeuristicClassifierAdapter,
        embedding: EmbeddingClassifierAdapter,
      ): DocumentClassifierAdapter =>
        classifierProvider === 'embedding' ? embedding : heuristic,
    },
    BrokerPacketsService,
    DocumentClassifierService,
    FieldExtractorService,
    PacketReconciliationService,
    BrokerPacketsWorker,
    TenantRateLimitGuard,
    OrgPermissionsGuard,
  ],
  exports: [BrokerPacketsService],
})
export class BrokerPacketsModule {}
