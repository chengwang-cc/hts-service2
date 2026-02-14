import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculatorModule as CalculatorPackageModule } from '@hts/calculator';
import {
  CalculationScenarioEntity,
  TradeAgreementEntity,
  TradeAgreementEligibilityEntity,
  RateRetrievalService,
  FormulaEvaluationService,
  CalculationService,
  CalculatorController,
} from '@hts/calculator';
import { CalculationHistoryEntity, HtsEntity, HtsExtraTaxEntity } from '@hts/core';
import { CoreWrapperModule } from '../core/core.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';

@Module({
  imports: [
    CalculatorPackageModule.forRoot(),
    CoreWrapperModule,
    KnowledgebaseModule,
    TypeOrmModule.forFeature([
      CalculationScenarioEntity,
      CalculationHistoryEntity,
      TradeAgreementEntity,
      TradeAgreementEligibilityEntity,
      HtsEntity,
      HtsExtraTaxEntity,
    ]),
  ],
  controllers: [CalculatorController],
  providers: [
    RateRetrievalService,
    FormulaEvaluationService,
    CalculationService,
  ],
  exports: [
    RateRetrievalService,
    FormulaEvaluationService,
    CalculationService,
  ],
})
export class CalculatorModule {}
