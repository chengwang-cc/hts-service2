import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import {
  ProductClassificationEntity,
  ApiUsageEntity,
  LookupConversationSessionEntity,
  LookupConversationMessageEntity,
  LookupConversationFeedbackEntity,
  SearchService,
  ClassificationService,
  UrlClassifierService,
  LookupConversationAgentService,
  RateLimitService,
  RateLimitGuard,
  LookupController,
  GroundedVerifierService,
} from '@hts/lookup';
import { LookupIntentRuleEntity } from './entities/lookup-intent-rule.entity';
import { LookupTestSampleEntity } from './entities/lookup-test-sample.entity';
import { IntentRuleService } from './services/intent-rule.service';
import { RuleCoverageService, INTENT_COVERAGE_CHAPTER_QUEUE } from './services/rule-coverage.service';
import { TestSampleGenerationService, TEST_SAMPLE_ENTRY_QUEUE, TEST_SAMPLE_COORDINATOR_QUEUE, TestSampleJobData } from './services/test-sample-generation.service';
import { LookupJobController } from './controllers/lookup-job.controller';
import { LookupIntentRuleController, LookupTestSampleController } from './controllers/lookup-intent-rule.controller';
import { LookupDebugController } from './controllers/lookup-debug.controller';
import { IntentRuleAdminService } from './services/intent-rule-admin.service';
import { IntentRuleDebugService, INTENT_RULE_DEBUG_QUEUE } from './services/intent-rule-debug.service';
import { RerankService } from './services/rerank.service';
import { SmartClassifyService } from './services/smart-classify.service';
import { LookupDebugSessionEntity } from './entities/lookup-debug-session.entity';
import { HtsEntity, CoreModule, AnthropicService } from '@hts/core';
import { AuthModule } from '../auth/auth.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';
import { HtsNoteEntity } from '../knowledgebase/entities/hts-note.entity';
import { UsageRecordEntity } from '../billing/entities/usage-record.entity';
import { UsageTrackingService } from '../billing/services/usage-tracking.service';
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';

export const LOOKUP_CONVERSATION_QUEUE = 'lookup-conversation-message';

/**
 * Lookup Wrapper Module
 * Provides Lookup services with access to TypeORM repositories
 * in the main app context where DataSource is available
 *
 * Authentication is handled by global JwtAuthGuard in AppModule
 */
@Module({
  imports: [
    HttpModule,
    AuthModule, // Provides JWT authentication components
    KnowledgebaseModule,
    CoreModule.forFeature(),
    QueueModule,
    TypeOrmModule.forFeature([
      ProductClassificationEntity,
      ApiUsageEntity,
      LookupConversationSessionEntity,
      LookupConversationMessageEntity,
      LookupConversationFeedbackEntity,
      HtsEntity,
      HtsNoteEntity,
      UsageRecordEntity,
      LookupIntentRuleEntity,
      LookupTestSampleEntity,
      LookupDebugSessionEntity,
    ]),
  ],
  controllers: [LookupController, LookupJobController, LookupIntentRuleController, LookupTestSampleController, LookupDebugController],
  providers: [
    SearchService,
    ClassificationService,
    UrlClassifierService,
    LookupConversationAgentService,
    RateLimitService,
    RateLimitGuard,
    UsageTrackingService,
    AnthropicService,
    GroundedVerifierService,
    IntentRuleService,
    RuleCoverageService,
    TestSampleGenerationService,
    IntentRuleAdminService,
    IntentRuleDebugService,
    RerankService,
    SmartClassifyService,
  ],
  exports: [
    SearchService,
    ClassificationService,
    UrlClassifierService,
    LookupConversationAgentService,
    RateLimitService,
    GroundedVerifierService,
    IntentRuleService,
    RuleCoverageService,
    TestSampleGenerationService,
    IntentRuleAdminService,
    IntentRuleDebugService,
    RerankService,
    SmartClassifyService,
  ],
})
export class LookupModule implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly lookupConversationAgentService: LookupConversationAgentService,
    private readonly ruleCoverageService: RuleCoverageService,
    private readonly testSampleService: TestSampleGenerationService,
    private readonly debugService: IntentRuleDebugService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Conversation agent handler
    await this.queueService.registerHandler(
      LOOKUP_CONVERSATION_QUEUE,
      async (job) => {
        const { conversationId, messageId, message } = job.data as {
          conversationId: string;
          messageId: string;
          message: string;
        };
        await this.lookupConversationAgentService.processMessage(
          conversationId,
          messageId,
          message,
        );
      },
      { teamSize: 3, teamConcurrency: 1 },
    );

    // Job 1: Rule coverage scan — 2 chapters processed concurrently
    await this.queueService.registerHandler(
      INTENT_COVERAGE_CHAPTER_QUEUE,
      async (job) => {
        const { chapter } = job.data as { chapter: string };
        await this.ruleCoverageService.processChapter(chapter);
      },
      { teamSize: 1, teamConcurrency: 2 },
    );

    // Job 2a: Test sample coordinator — fans out into per-entry jobs (concurrency: 1)
    await this.queueService.registerHandler(
      TEST_SAMPLE_COORDINATOR_QUEUE,
      async (_job) => {
        await this.testSampleService.runCoordinator();
      },
      { teamSize: 1, teamConcurrency: 1 },
    );

    // Job 2b: Test sample entry — 5 entries processed concurrently
    await this.queueService.registerHandler(
      TEST_SAMPLE_ENTRY_QUEUE,
      async (job) => {
        await this.testSampleService.processEntry(job.data as TestSampleJobData);
      },
      { teamSize: 1, teamConcurrency: 5 },
    );

    // Job 3: Intent rule debug session — AI loop to fix search ranking
    await this.queueService.registerHandler(
      INTENT_RULE_DEBUG_QUEUE,
      async (job) => {
        const { sessionId } = job.data as { sessionId: string };
        await this.debugService.processSession(sessionId);
      },
      { teamSize: 1, teamConcurrency: 3 },
    );
  }
}
