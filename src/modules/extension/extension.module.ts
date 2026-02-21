import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtensionController } from './controllers/extension.controller';
import { DetectionService } from './services/detection.service';
import { WebScrapingService } from './services/web-scraping.service';
import { AgentOrchestrationService } from './services/agent-orchestration.service';
import { VisionMonitoringService } from './services/vision-monitoring.service';
import { ResultCacheService } from './services/result-cache.service';
import { ExtensionFeedbackEntity } from './entities/extension-feedback.entity';
import { VisionAnalysisEntity } from './entities/vision-analysis.entity';
import { ScrapingMetadataEntity } from './entities/scraping-metadata.entity';
import { PuppeteerMCPServer } from './mcp/servers/puppeteer-server';
import { VisionRateLimitGuard } from './guards/vision-rate-limit.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';

/**
 * Extension Module
 * Provides API endpoints for Chrome extension support
 * Includes image recognition and web scraping capabilities
 * With rate limiting, monitoring, and caching
 *
 * Note: VisionService and OpenAiService are provided globally by CoreModule
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExtensionFeedbackEntity,
      VisionAnalysisEntity,
      ScrapingMetadataEntity,
    ]),
    ApiKeysModule, // Import for ApiKeyGuard and ApiKeyService
  ],
  controllers: [ExtensionController],
  providers: [
    // Core services
    DetectionService,
    WebScrapingService,
    PuppeteerMCPServer,
    AgentOrchestrationService,

    // Enhancement services
    VisionMonitoringService,
    ResultCacheService,
    VisionRateLimitGuard,
  ],
  exports: [
    DetectionService,
    WebScrapingService,
    AgentOrchestrationService,
    VisionMonitoringService,
    ResultCacheService,
  ],
})
export class ExtensionModule {}
