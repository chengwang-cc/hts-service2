import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { LookupModule } from '../lookup/lookup.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';
import { BatchModule } from '../batch/batch.module';
import { BillingModule } from '../billing/billing.module';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import { PartnerUsageMonthlyEntity } from '../partner-attribution/entities/partner-usage-monthly.entity';
import { HtsEntity, CalculationHistoryEntity } from '@hts/core';
import {
  HtsDocumentEntity,
  HtsNoteEntity,
  KnowledgeChunkEntity,
} from '@hts/knowledgebase';

// V1 Controllers
import { HtsPublicController } from './v1/controllers/hts-public.controller';
import { CalculatorPublicController } from './v1/controllers/calculator-public.controller';
import { KnowledgebasePublicController } from './v1/controllers/knowledgebase-public.controller';
import { ClassificationPublicController } from './v1/controllers/classification-public.controller';
import { BatchPublicController } from './v1/controllers/batch-public.controller';

/**
 * Public API Module
 * Versioned public APIs for external access
 *
 * IMPORTANT: Must import wrapper modules (not package modules) to access services
 */
@Module({
  imports: [
    ApiKeysModule,
    LookupModule, // Import wrapper module that exports services
    CalculatorModule, // Import wrapper module that exports services
    KnowledgebaseModule, // Import wrapper module that exports services
    BatchModule, // Exports BatchJobService for BatchPublicController
    BillingModule, // PartnerQuotaGuard for monthly-quota enforcement on /api/v1/*
    // The guard injects OrganizationEntity + PartnerUsageMonthlyEntity
    // repositories. NestJS instantiates per-controller guards in the
    // consumer module's DI context, so even though BillingModule has the
    // forFeature() for these entities, PublicApiModule needs its own
    // registration to resolve them here. Without this, boot fails with:
    //   "Nest can't resolve dependencies of the PartnerQuotaGuard …
    //    OrganizationEntityRepository at index [1] … in the PublicApiModule
    //    context."
    TypeOrmModule.forFeature([
      HtsEntity,
      CalculationHistoryEntity,
      HtsDocumentEntity,
      HtsNoteEntity,
      KnowledgeChunkEntity,
      OrganizationEntity,
      PartnerUsageMonthlyEntity,
    ]),
  ],
  controllers: [
    // V1 Controllers
    HtsPublicController,
    CalculatorPublicController,
    KnowledgebasePublicController,
    ClassificationPublicController,
    BatchPublicController,
  ],
})
export class PublicApiModule {}
