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
import { VisionService, OpenAiService } from '@hts/core';

/**
 * Extension Module
 * Provides API endpoints for Chrome extension support
 * Includes image recognition and web scraping capabilities
 * With rate limiting, monitoring, and caching
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExtensionFeedbackEntity,
      VisionAnalysisEntity,
      ScrapingMetadataEntity,
    ]),
  ],
  controllers: [ExtensionController],
  providers: [
    // Core services
    DetectionService,
    VisionService,
    OpenAiService,
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
    VisionService,
    WebScrapingService,
    AgentOrchestrationService,
    VisionMonitoringService,
    ResultCacheService,
  ],
})
export class ExtensionModule {}
