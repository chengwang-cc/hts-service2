import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '@hts/core';
import {
  CalculationScenarioEntity,
  CalculationHistoryEntity,
  TradeAgreementEntity,
  TradeAgreementEligibilityEntity,
} from './entities';
import {
  RateRetrievalService,
  FormulaEvaluationService,
  CalculationService,
} from './services';
import { CalculatorController } from './controllers/calculator.controller';

@Module({})
export class CalculatorModule {
  static forRoot(): DynamicModule {
    return {
      module: CalculatorModule,
      imports: [
        CoreModule.forFeature(),
        TypeOrmModule.forFeature([
          CalculationScenarioEntity,
          CalculationHistoryEntity,
          TradeAgreementEntity,
          TradeAgreementEligibilityEntity,
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
    };
  }
}
