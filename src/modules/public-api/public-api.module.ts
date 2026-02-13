import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { LookupModule } from '@hts/lookup';
import { CalculatorModule } from '@hts/calculator';
import { KnowledgebaseModule } from '@hts/knowledgebase';
import { HtsEntity, CalculationHistoryEntity } from '@hts/core';

// V1 Controllers
import { HtsPublicController } from './v1/controllers/hts-public.controller';
import { CalculatorPublicController } from './v1/controllers/calculator-public.controller';
import { KnowledgebasePublicController } from './v1/controllers/knowledgebase-public.controller';
import { ClassificationPublicController } from './v1/controllers/classification-public.controller';

/**
 * Public API Module
 * Versioned public APIs for external access
 */
@Module({
  imports: [
    ApiKeysModule,
    LookupModule.forRoot(),
    CalculatorModule.forRoot(),
    KnowledgebaseModule.forRoot(),
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
