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
} from '@hts/calculator';
import {
  CalculationHistoryEntity,
  HtsEntity,
  HtsExtraTaxEntity,
  HtsTariffHistory2025Entity,
} from '@hts/core';
import { CoreWrapperModule } from '../core/core.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';

@Module({
  imports: [
    CoreWrapperModule,
    KnowledgebaseModule,
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
  ],
  exports: [RateRetrievalService, FormulaEvaluationService, CalculationService],
})
export class CalculatorModule {}
