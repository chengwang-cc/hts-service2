import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HtsTestCaseEntity } from '../../../core/entities/hts-test-case.entity';
import { TariffEvidenceEntity } from '../../calculator/entities/tariff-evidence.entity';
import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { QueueService } from '../../queue/queue.service';
import { Repository } from 'typeorm';
import {
  FormulaComponentArtifact,
  FormulaExtractorOutput,
  FormulaSourcePack,
  JsonRecord,
} from './formula-ai-validation.schemas';
import { toJsonRecord } from './formula-ai-validation.util';

export interface AcceptFormulaAiArtifactInput {
  sourcePack: FormulaSourcePack;
  artifact: FormulaExtractorOutput;
  reviewer?: string;
  aiModel?: string | null;
  aiPromptVersion?: string | null;
  createRegressionTests?: boolean;
  enqueueRecompute?: boolean;
}

export interface AcceptFormulaAiArtifactResult {
  evidenceCreated: number;
  testCasesCreated: number;
  recomputeJobId: string | null;
  evidenceIds: string[];
  testCaseIds: string[];
}

@Injectable()
export class FormulaAiEvidenceService {
  constructor(
    @InjectRepository(TariffEvidenceEntity)
    private readonly evidenceRepo: Repository<TariffEvidenceEntity>,
    @InjectRepository(HtsTestCaseEntity)
    private readonly testCaseRepo: Repository<HtsTestCaseEntity>,
    private readonly semantics: FormulaSemanticsService,
    private readonly queueService: QueueService,
  ) {}

  async acceptArtifact(
    input: AcceptFormulaAiArtifactInput,
  ): Promise<AcceptFormulaAiArtifactResult> {
    this.assertArtifactCanCreateEvidence(input);
    const evidenceIds: string[] = [];
    const testCaseIds: string[] = [];

    for (const component of input.artifact.components) {
      if (!component.formulaText) {
        continue;
      }
      const evidence = await this.createPendingEvidence(input, component);
      evidenceIds.push(evidence.id);
      if (input.createRegressionTests !== false) {
        const tests = await this.createRegressionTests(
          input.sourcePack,
          component,
          input.reviewer || 'formula-ai-council',
        );
        testCaseIds.push(...tests.map((testCase) => testCase.id));
      }
    }

    let recomputeJobId: string | null = null;
    if (input.enqueueRecompute !== false && evidenceIds.length > 0) {
      recomputeJobId =
        (await this.queueService.sendJob('tariff-knowledge-card-recompute', {
          htsNumber: input.sourcePack.htsNumber,
          countryCode: input.sourcePack.originCountry,
          destinationCode: input.sourcePack.destinationCountry,
          triggeredBy: 'formula-ai-council-review',
        })) || null;
    }

    return {
      evidenceCreated: evidenceIds.length,
      testCasesCreated: testCaseIds.length,
      recomputeJobId,
      evidenceIds,
      testCaseIds,
    };
  }

  private assertArtifactCanCreateEvidence(
    input: AcceptFormulaAiArtifactInput,
  ): void {
    const artifact = input.artifact;
    if (
      artifact.verdict !== 'formula_extracted' &&
      artifact.verdict !== 'no_duty'
    ) {
      throw new BadRequestException(
        `Artifact verdict ${artifact.verdict} cannot create evidence`,
      );
    }
    if (artifact.needsJudge) {
      throw new BadRequestException(
        'Artifact still requires judge review and cannot create evidence',
      );
    }
    if (artifact.components.some((component) => component.blockers.length > 0)) {
      throw new BadRequestException(
        'Artifact contains component blockers and cannot create evidence',
      );
    }
    const formulaComponents = artifact.components.filter(
      (component) => !!component.formulaText,
    );
    if (formulaComponents.length === 0) {
      throw new BadRequestException(
        'Artifact has no formula-bearing components and cannot create evidence',
      );
    }
    if (input.createRegressionTests === false) {
      throw new BadRequestException(
        'Formula AI accepted artifacts must create regression tests',
      );
    }
    const missingVectors = formulaComponents.filter(
      (component) =>
        !component.testVectors.some(
          (vector) =>
            this.numberRecord(vector.inputs) !== null &&
            this.expectedNumber(vector) !== null,
        ),
    );
    if (missingVectors.length > 0) {
      throw new BadRequestException(
        'Every accepted formula component must include at least one valid numeric regression test vector',
      );
    }
  }

  private async createPendingEvidence(
    input: AcceptFormulaAiArtifactInput,
    component: FormulaComponentArtifact,
  ): Promise<TariffEvidenceEntity> {
    const analyzed = this.semantics.analyze(component.formulaText || '0');
    const validationStatus =
      analyzed.validationErrors.length === 0 ? 'valid' : 'invalid';
    const evidence = this.evidenceRepo.create({
      htsNumber: input.sourcePack.htsNumber,
      countryCode: input.sourcePack.originCountry,
      destinationCode: input.sourcePack.destinationCountry,
      rateClass: this.rateClassFor(component),
      componentType: component.componentType,
      calculationStage: component.componentType,
      sourceId: null,
      source: null,
      citationUrl: null,
      citationQuote: component.sourceRateText,
      citationSnapshotUri: null,
      sourceEffectiveFrom: input.sourcePack.effectiveDate,
      sourceEffectiveTo: null,
      rateText: component.sourceRateText,
      formulaText: component.formulaText,
      formulaAst: component.formulaAst || toJsonRecord(analyzed.formulaAst),
      formulaCanonical: analyzed.canonicalFormula,
      compiledFormula: component.formulaText,
      formulaSemanticHash: analyzed.semanticHash,
      conditionAst: component.conditionAst,
      unitDimensions: this.stringRecord(component.unitDimensions),
      constraints: { items: component.constraints },
      roundingPolicy: component.roundingPolicy,
      parserName: 'multi-llm-council',
      parserVersion: 'formula-extractor-v1',
      parserConfidence: input.artifact.confidence,
      aiModel: input.aiModel || null,
      aiPromptVersion: input.aiPromptVersion || 'formula-extractor-v1',
      validationStatus,
      validationErrors: analyzed.validationErrors,
      testVectors: component.testVectors,
      reviewerConfidence: input.artifact.confidence,
      reviewer: input.reviewer || 'formula-ai-council',
      reviewedAt: new Date(),
      status: 'pending',
      supersededBy: null,
      metadata: {
        source: 'formula-ai-council',
        sourcePackId: input.sourcePack.sourcePackId,
        reasonCodes: input.artifact.reasonCodes,
        assumptions: component.assumptions,
        blockers: component.blockers,
        humanReviewRequired: true,
      },
    });
    return this.evidenceRepo.save(evidence);
  }

  private async createRegressionTests(
    sourcePack: FormulaSourcePack,
    component: FormulaComponentArtifact,
    createdBy: string,
  ): Promise<HtsTestCaseEntity[]> {
    const out: HtsTestCaseEntity[] = [];
    for (const [index, vector] of component.testVectors.entries()) {
      const inputs = this.numberRecord(vector.inputs);
      const expected = this.expectedNumber(vector);
      if (!inputs || expected === null) {
        continue;
      }
      const testCase = this.testCaseRepo.create({
        htsNumber: sourcePack.htsNumber,
        country: sourcePack.originCountry,
        testName: `Formula AI ${sourcePack.htsNumber} ${component.componentType} #${index + 1}`,
        description: `Generated from multi-LLM formula validation source pack ${sourcePack.sourcePackId}`,
        inputValues: inputs,
        expectedOutput: expected,
        tolerance: 0.01,
        rateType: this.testRateTypeFor(component),
        source: 'LLM_FORMULA_REGRESSION',
        isActive: true,
        priority: 80,
        createdBy,
        notes: `Formula: ${component.formulaText || 'none'}`,
        tags: [
          'formula-ai-council',
          sourcePack.sourceVersion,
          component.componentType,
        ],
      });
      out.push(await this.testCaseRepo.save(testCase));
    }
    return out;
  }

  private rateClassFor(component: FormulaComponentArtifact): string {
    if (component.componentType === 'additionalDuty') {
      return 'chapter99';
    }
    if (component.componentType === 'unknown') {
      return 'unknown';
    }
    return 'general';
  }

  private testRateTypeFor(component: FormulaComponentArtifact): string {
    return component.componentType === 'additionalDuty'
      ? 'CHAPTER_99'
      : 'GENERAL';
  }

  private stringRecord(value: JsonRecord | null): Record<string, string> | null {
    if (!value) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        out[key] = item;
      }
    }
    return out;
  }

  private numberRecord(value: unknown): Record<string, number> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const out: Record<string, number> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item !== 'number' || !Number.isFinite(item)) {
        return null;
      }
      out[key] = item;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private expectedNumber(vector: JsonRecord): number | null {
    for (const key of ['expectedOutput', 'expectedDuty', 'expected', 'amount']) {
      const value = vector[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }
}
