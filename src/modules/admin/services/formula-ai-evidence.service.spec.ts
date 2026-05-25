import { BadRequestException } from '@nestjs/common';
import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { FormulaAiEvidenceService } from './formula-ai-evidence.service';
import type {
  FormulaExtractorOutput,
  FormulaSourcePack,
} from './formula-ai-validation.schemas';

const sourcePack: FormulaSourcePack = {
  sourcePackId: 'pack-1',
  htsNumber: '6109.10.00.12',
  sourceVersion: '2026 Revision 8',
  effectiveDate: '2026-05-22',
  destinationCountry: 'US',
  originCountry: 'ALL',
  articleDescription: 'Cotton T-shirts',
  unit: null,
  rateText: '16.5%',
  specialRateText: null,
  otherRateText: null,
  chapter99Text: null,
  chapterNotes: [],
  sectionNotes: [],
  generalNotes: [],
  chapter99Candidates: [],
  currentFormulaArtifact: {},
  knownParserOutput: {},
  knownBrokerCases: [],
  knownProviderQuotes: [],
  knownEvidence: [],
  knownCards: [],
  requiredOutputSchemaVersion: 'formula-artifact-v1',
  metadata: {},
};

const artifact: FormulaExtractorOutput = {
  modelRole: 'extractor',
  verdict: 'formula_extracted',
  components: [
    {
      componentType: 'baseDuty',
      sourceRateText: '16.5%',
      formulaText: 'value * 0.165',
      formulaAst: {},
      conditionAst: null,
      unitDimensions: { value: 'money' },
      constraints: [],
      roundingPolicy: {},
      citations: [],
      testVectors: [{ inputs: { value: 1000 }, expectedOutput: 165 }],
      assumptions: [],
      blockers: [],
    },
  ],
  confidence: 0.9,
  reasonCodes: [],
  needsJudge: false,
};

function repo<T>() {
  return {
    create: jest.fn((value: T) => value),
    save: jest.fn(async (value: T) => ({ id: 'saved-id', ...value })),
  };
}

describe('FormulaAiEvidenceService', () => {
  it('creates pending evidence, regression tests, and a recompute job', async () => {
    const evidenceRepo = repo<any>();
    const testCaseRepo = repo<any>();
    const queueService = {
      sendJob: jest.fn().mockResolvedValue('job-1'),
    };
    const service = new FormulaAiEvidenceService(
      evidenceRepo as any,
      testCaseRepo as any,
      new FormulaSemanticsService(),
      queueService as any,
    );

    const result = await service.acceptArtifact({
      sourcePack,
      artifact,
      reviewer: 'reviewer@example.com',
    });

    expect(result.evidenceCreated).toBe(1);
    expect(result.testCasesCreated).toBe(1);
    expect(result.recomputeJobId).toBe('job-1');
    expect(evidenceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        validationStatus: 'valid',
        formulaText: 'value * 0.165',
      }),
    );
  });

  it('rejects unsupported artifacts', async () => {
    const service = new FormulaAiEvidenceService(
      repo<any>() as any,
      repo<any>() as any,
      new FormulaSemanticsService(),
      { sendJob: jest.fn() } as any,
    );

    await expect(
      service.acceptArtifact({
        sourcePack,
        artifact: { ...artifact, verdict: 'unsupported' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects accepted artifacts without valid regression vectors', async () => {
    const service = new FormulaAiEvidenceService(
      repo<any>() as any,
      repo<any>() as any,
      new FormulaSemanticsService(),
      { sendJob: jest.fn() } as any,
    );

    await expect(
      service.acceptArtifact({
        sourcePack,
        artifact: {
          ...artifact,
          components: [
            {
              ...artifact.components[0],
              testVectors: [],
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects attempts to disable regression test creation', async () => {
    const service = new FormulaAiEvidenceService(
      repo<any>() as any,
      repo<any>() as any,
      new FormulaSemanticsService(),
      { sendJob: jest.fn() } as any,
    );

    await expect(
      service.acceptArtifact({
        sourcePack,
        artifact,
        createRegressionTests: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
