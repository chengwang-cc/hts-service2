import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  HtsEntity,
  HtsEmbeddingEntity,
  HtsFormulaUpdateEntity,
  HtsFormulaCandidateEntity,
  HtsTestCaseEntity,
  HtsTestResultEntity,
  HtsImportHistoryEntity,
  HtsSettingEntity,
  HtsExtraTaxEntity,
  CalculationHistoryEntity,
  HtsRepository,
  HtsProcessorService,
  FormulaGenerationService,
  HtsEmbeddingGenerationService,
  HtsFormulaUpdateService,
  HtsFormulaGenerationService,
  HtsFormulaUpdateController,
} from '@hts/core';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HtsEntity,
      HtsEmbeddingEntity,
      HtsFormulaUpdateEntity,
      HtsFormulaCandidateEntity,
      HtsTestCaseEntity,
      HtsTestResultEntity,
      HtsImportHistoryEntity,
      HtsSettingEntity,
      HtsExtraTaxEntity,
      CalculationHistoryEntity,
    ]),
  ],
  controllers: [HtsFormulaUpdateController],
  providers: [
    HtsRepository,
    HtsProcessorService,
    FormulaGenerationService,
    HtsEmbeddingGenerationService,
    HtsFormulaUpdateService,
    HtsFormulaGenerationService,
  ],
  exports: [
    HtsRepository,
    HtsProcessorService,
    FormulaGenerationService,
    HtsEmbeddingGenerationService,
    HtsFormulaUpdateService,
    HtsFormulaGenerationService,
  ],
})
export class CoreWrapperModule {}
