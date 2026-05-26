import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ExceptionRulesModule } from '../exception-rules/exception-rules.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';
import { QueueModule } from '../queue/queue.module';
import { KnowledgeCardEntity } from './entities/knowledge-card.entity';
import { KnowledgeSourceCrawlRunEntity } from './entities/knowledge-source-crawl-run.entity';
import { KnowledgeSourceEntity } from './entities/knowledge-source.entity';
import { KnowledgeSourceItemEntity } from './entities/knowledge-source-item.entity';
import { RuleReviewAlertEntity } from './entities/rule-review-alert.entity';
import { KnowledgeCardService } from './services/knowledge-card.service';
import { KnowledgeSourceRegistryService } from './services/knowledge-source-registry.service';
import { RuleReviewAlertService } from './services/rule-review-alert.service';
import { KnowledgeCardChangeDetectorService } from './services/knowledge-card-change-detector.service';
import { DocumentExtractorService } from './services/document-extractor.service';
import { DocumentChunkerService } from './services/document-chunker.service';
import { DocumentClassifierService } from './services/document-classifier.service';
import { KnowledgeCardIngestionService } from './services/knowledge-card-ingestion.service';
import { KnowledgeCrawlerPolicyService } from './services/knowledge-crawler-policy.service';
import { RssFeedReaderService } from './services/rss-feed-reader.service';
import {
  AlertNotifierService,
  LogOnlyAlertNotifier,
} from './services/alert-notifier.service';
import {
  AlertAdvisoryService,
  NoopAlertAdvisoryService,
} from './services/alert-advisory.service';
import { SourceMonitorJob } from './jobs/source-monitor.job';
import { DailyDigestJob } from './jobs/daily-digest.job';
import { KnowledgebaseCardsAdminController } from './controllers/knowledgebase-cards.admin.controller';
import { KnowledgeQueryController } from './controllers/knowledge-query.controller';
import { KnowledgeQueryService } from './services/knowledge-query.service';

/**
 * KnowledgebaseCardsModule (Phase 8).
 *
 * Standalone module for the cross-cutting knowledge-card pipeline +
 * rule-review-alert system. Separate from the existing `knowledgebase`
 * module (which is HTS-document-specific) so the two evolve
 * independently. Imports `KnowledgebaseModule` only to access the
 * shared PdfParserService.
 *
 * Exports the ingestion + alert services so the source-monitor cron
 * and any future automation can consume them.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeCardEntity,
      RuleReviewAlertEntity,
      KnowledgeSourceEntity,
      KnowledgeSourceItemEntity,
      KnowledgeSourceCrawlRunEntity,
    ]),
    KnowledgebaseModule, // for PdfParserService
    ExceptionRulesModule,
    QueueModule,
    AuditModule,
    // EmbeddingService is provided globally by CoreModule.forRoot() in
    // AppModule (re-exported by `@hts/core`), so it can be injected
    // here without an explicit import.
  ],
  controllers: [KnowledgebaseCardsAdminController, KnowledgeQueryController],
  providers: [
    KnowledgeCardService,
    KnowledgeSourceRegistryService,
    RuleReviewAlertService,
    KnowledgeCardChangeDetectorService,
    DocumentExtractorService,
    DocumentChunkerService,
    DocumentClassifierService,
    KnowledgeCardIngestionService,
    KnowledgeCrawlerPolicyService,
    KnowledgeQueryService,
    RssFeedReaderService,
    AlertNotifierService,
    LogOnlyAlertNotifier,
    NoopAlertAdvisoryService,
    AlertAdvisoryService,
    SourceMonitorJob,
    DailyDigestJob,
  ],
  exports: [
    KnowledgeCardService,
    KnowledgeSourceRegistryService,
    RuleReviewAlertService,
    KnowledgeCardIngestionService,
    KnowledgeQueryService,
    AlertNotifierService,
    NoopAlertAdvisoryService,
    AlertAdvisoryService,
    SourceMonitorJob,
    DailyDigestJob,
  ],
})
export class KnowledgebaseCardsModule {}
