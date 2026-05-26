import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalculationScenarioEntity,
  TariffCardShadowComparisonEntity,
  TariffEvidenceEntity,
  TariffKnowledgeCardEntity,
  TradeAgreementEntity,
  TradeAgreementEligibilityEntity,
  RateRetrievalService,
  FormulaEvaluationService,
  CalculationService,
  CalculatorController,
  TariffFormulaResolverService,
  TariffRateBatchService,
  ShadowComparatorService,
  FormulaSemanticsService,
  FormulaScopeService,
  TariffKnowledgeCardService,
  TariffConfidenceService,
  PolicyApplicabilityService,
  TariffConditionEngineService,
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
import { ExceptionRulesModule } from '../exception-rules/exception-rules.module';
import { TariffSourceFreshnessService } from './accuracy/tariff-source-freshness.service';
import { EvidenceCoverageService } from './accuracy/evidence-coverage.service';
import { AccuracySchedulerService } from './accuracy/accuracy-scheduler.service';
import { AccuracyController } from './accuracy/accuracy.controller';

@Module({
  imports: [
    CoreWrapperModule,
    KnowledgebaseModule,
    ApiKeysModule,
    ExceptionRulesModule, // P2.T5 — registry + runner; rules ship disabled
    TypeOrmModule.forFeature([
      CalculationScenarioEntity,
      TariffCardShadowComparisonEntity,
      TariffEvidenceEntity,
      TariffKnowledgeCardEntity,
      CalculationHistoryEntity,
      TradeAgreementEntity,
      TradeAgreementEligibilityEntity,
      HtsEntity,
      HtsExtraTaxEntity,
      HtsTariffHistory2025Entity,
    ]),
  ],
  controllers: [CalculatorController, AccuracyController],
  providers: [
    RateRetrievalService,
    FormulaEvaluationService,
    CalculationService,
    TariffFormulaResolverService,
    TariffRateBatchService,
    ShadowComparatorService,
    FormulaSemanticsService,
    FormulaScopeService,
    TariffKnowledgeCardService,
    TariffConfidenceService,
    PolicyApplicabilityService,
    TariffConditionEngineService,
    TariffSourceFreshnessService,
    EvidenceCoverageService,
    AccuracySchedulerService,
  ],
  exports: [
    RateRetrievalService,
    FormulaEvaluationService,
    CalculationService,
    TariffFormulaResolverService,
    TariffRateBatchService,
    ShadowComparatorService,
    FormulaSemanticsService,
    FormulaScopeService,
    TariffKnowledgeCardService,
    TariffConfidenceService,
    PolicyApplicabilityService,
    TariffConditionEngineService,
    TariffSourceFreshnessService,
    EvidenceCoverageService,
    AccuracySchedulerService,
  ],
})
export class CalculatorModule {}
