import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { LookupModule } from '../lookup/lookup.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';
import { LandedCostModule } from '../landed-cost/landed-cost.module';
import { JurisdictionModule } from '../jurisdiction/jurisdiction.module';
import { HtsEntity, CalculationHistoryEntity } from '@hts/core';
import {
  HtsDocumentEntity,
  HtsNoteEntity,
  KnowledgeChunkEntity,
} from '@hts/knowledgebase';

// V1 Controllers (legacy — ai-service proxy)
import { HtsPublicController } from './v1/controllers/hts-public.controller';
import { CalculatorV1Controller } from './v1/controllers/calculator-v1.controller';
import { KnowledgebasePublicController } from './v1/controllers/knowledgebase-public.controller';
import { ClassificationPublicController } from './v1/controllers/classification-public.controller';

// V2 Controllers (native hts-service for hts-ui)
import { CalculatorV2Controller } from './v2/controllers/calculator-v2.controller';

// Shared services
import { AiServiceProxyService } from './v1/services/ai-service-proxy.service';
import { CalculationHistoryService } from './shared/calculation-history.service';

/**
 * Public API Module
 * Versioned public APIs for external access.
 *
 * v1 — legacy/passthrough for hts-web2. Tariff routes proxy to ai-service.
 * v2 — native hts-service for hts-ui. No external dependencies.
 *
 * Both versions share /calculations and /calculations/:id (via
 * CalculationHistoryService) so audit history works regardless of which
 * engine produced the row.
 *
 * IMPORTANT: Import wrapper modules (not package modules) to access services.
 */
@Module({
  imports: [
    ApiKeysModule,
    LookupModule,
    CalculatorModule,    // CalculationService, TariffRateBatchService for v2
    KnowledgebaseModule,
    LandedCostModule,    // v2 /quote route
    JurisdictionModule,  // v2 /jurisdictions route
    TypeOrmModule.forFeature([
      HtsEntity,
      CalculationHistoryEntity,
      HtsDocumentEntity,
      HtsNoteEntity,
      KnowledgeChunkEntity,
    ]),
  ],
  controllers: [
    // V1 Controllers (legacy)
    HtsPublicController,
    CalculatorV1Controller,
    KnowledgebasePublicController,
    ClassificationPublicController,
    // V2 Controllers (native)
    CalculatorV2Controller,
  ],
  providers: [
    AiServiceProxyService,
    CalculationHistoryService,
  ],
  exports: [CalculationHistoryService, AiServiceProxyService],
})
export class PublicApiModule {}
