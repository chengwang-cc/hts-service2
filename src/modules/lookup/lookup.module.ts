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
    ]),
  ],
  controllers: [LookupController],
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
  ],
  exports: [
    SearchService,
    ClassificationService,
    UrlClassifierService,
    LookupConversationAgentService,
    RateLimitService,
    GroundedVerifierService,
  ],
})
export class LookupModule implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly lookupConversationAgentService: LookupConversationAgentService,
  ) {}

  async onModuleInit(): Promise<void> {
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
  }
}
