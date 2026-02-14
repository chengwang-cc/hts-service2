import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { LookupModule } from '../lookup/lookup.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';
import { HtsEntity, CalculationHistoryEntity } from '@hts/core';

// V1 Controllers
import { HtsPublicController } from './v1/controllers/hts-public.controller';
import { CalculatorPublicController } from './v1/controllers/calculator-public.controller';
import { KnowledgebasePublicController } from './v1/controllers/knowledgebase-public.controller';
import { ClassificationPublicController } from './v1/controllers/classification-public.controller';

/**
 * Public API Module
 * Versioned public APIs for external access
 *
 * IMPORTANT: Must import wrapper modules (not package modules) to access services
 */
@Module({
  imports: [
    ApiKeysModule,
    LookupModule,  // Import wrapper module that exports services
    CalculatorModule,  // Import wrapper module that exports services
    KnowledgebaseModule,  // Import wrapper module that exports services
    TypeOrmModule.forFeature([HtsEntity, CalculationHistoryEntity]),
  ],
  controllers: [
    // V1 Controllers
    HtsPublicController,
    CalculatorPublicController,
    KnowledgebasePublicController,
    ClassificationPublicController,
  ],
})
export class PublicApiModule {}
