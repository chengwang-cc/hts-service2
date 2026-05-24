import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalculationScenarioEntity,
  TradeAgreementEntity,
  TradeAgreementEligibilityEntity,
  RateRetrievalService,
  FormulaEvaluationService,
  CalculationService,
  CalculatorController,
  TariffFormulaResolverService,
  TariffRateBatchService,
  ShadowComparatorService,
} from '@hts/calculator';
import {
  CalculationHistoryEntity,
  HtsEntity,
  HtsExtraTaxEntity,
  HtsTariffHistory2025Entity,
} from '@hts/core';
import { CoreWrapperModule } from '../core/core.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [
    CoreWrapperModule,
    KnowledgebaseModule,
    ApiKeysModule,
    TypeOrmModule.forFeature([
      CalculationScenarioEntity,
      CalculationHistoryEntity,
      TradeAgreementEntity,
      TradeAgreementEligibilityEntity,
      HtsEntity,
      HtsExtraTaxEntity,
      HtsTariffHistory2025Entity,
    ]),
  ],
  controllers: [CalculatorController],
  providers: [
    RateRetrievalService,
    FormulaEvaluationService,
    CalculationService,
    TariffFormulaResolverService,
    TariffRateBatchService,
    ShadowComparatorService,
  ],
  exports: [
    RateRetrievalService,
    FormulaEvaluationService,
    CalculationService,
    TariffFormulaResolverService,
    TariffRateBatchService,
    ShadowComparatorService,
  ],
})
export class CalculatorModule {}
