import { Module } from '@nestjs/common';
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
} from '@hts/lookup';
import { HtsEntity, CoreModule } from '@hts/core';
import { AuthModule } from '../auth/auth.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';

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
    TypeOrmModule.forFeature([
      ProductClassificationEntity,
      ApiUsageEntity,
      LookupConversationSessionEntity,
      LookupConversationMessageEntity,
      LookupConversationFeedbackEntity,
      HtsEntity,
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
  ],
  exports: [
    SearchService,
    ClassificationService,
    UrlClassifierService,
    LookupConversationAgentService,
    RateLimitService,
  ],
})
export class LookupModule {}
