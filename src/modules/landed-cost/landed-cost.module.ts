import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HtsEntity } from '@hts/core';
import {
  LandedCostQuoteEntity,
  LandedCostLineEntity,
  ExchangeRateSnapshotEntity,
} from './entities';
// AUDIT FIX H3 — register rule entities here too so RuleEngineService's
// @InjectRepository decorators resolve regardless of whether NestJS picks
// up the re-export from JurisdictionModule.exports = [..., TypeOrmModule].
import {
  FeeRuleEntity,
  TaxRuleEntity,
  LowValueRuleEntity,
} from '../jurisdiction/entities';
import { LandedCostService } from './services/landed-cost.service';
import { CurrencyConversionService } from './services/currency-conversion.service';
import { IncompleteCodeFallbackService } from './services/incomplete-code-fallback.service';
import { RuleEngineService } from './services/rule-engine.service';
import { LandedCostController } from './controllers/landed-cost.controller';
import { JurisdictionModule } from '../jurisdiction/jurisdiction.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ClassificationModule } from '../classification/classification.module';
import { CalculatorModule } from '../calculator/calculator.module';

/**
 * LandedCostModule (P3)
 *
 * Owns `POST /landed-cost/quotes` and the quote lifecycle (calculated /
 * confirmed / expired / requires_review). Delegates per-line calculation
 * to jurisdiction adapters via AdapterRegistry.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LandedCostQuoteEntity,
      LandedCostLineEntity,
      ExchangeRateSnapshotEntity,
      HtsEntity,
      FeeRuleEntity,
      TaxRuleEntity,
      LowValueRuleEntity,
    ]),
    JurisdictionModule,
    ApiKeysModule,
    CatalogModule,
    ClassificationModule,
    CalculatorModule,
  ],
  controllers: [LandedCostController],
  providers: [
    LandedCostService,
    CurrencyConversionService,
    IncompleteCodeFallbackService,
    RuleEngineService,
  ],
  exports: [LandedCostService, RuleEngineService],
})
export class LandedCostModule {}
