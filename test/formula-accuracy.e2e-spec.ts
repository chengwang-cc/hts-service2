jest.mock('@hts/knowledgebase', () => ({
  NoteResolutionService: class NoteResolutionService {},
}));
jest.mock('@hts/calculator', () => ({
  FormulaSemanticsService: class FormulaSemanticsService {},
  TariffEvidenceEntity: class TariffEvidenceEntity {},
  TariffKnowledgeCardEntity: class TariffKnowledgeCardEntity {},
  TariffRateBatchService: class TariffRateBatchService {},
  validateFormulaArtifacts: jest.fn(() => ({
    valid: true,
    errors: [],
    validatorVersion: 'test-validator',
  })),
}));

import { FormulaGenerationService } from '../src/core/services/formula-generation.service';
import { FormulaEvaluationService } from '../src/modules/calculator/services/formula-evaluation.service';
import { FormulaScopeService } from '../src/modules/calculator/services/formula-scope.service';
import { PolicyApplicabilityService } from '../src/modules/calculator/services/policy-applicability.service';
import { TariffConditionEngineService } from '../src/modules/calculator/services/tariff-condition-engine.service';
import { FormulaSemanticsService } from '../src/modules/calculator/services/formula-semantics.service';
import { TariffRateBatchService } from '../src/modules/calculator/services/tariff-rate-batch.service';
import { FormulaMaintenanceService } from '../src/modules/admin/services/formula-maintenance.service';
import { PolicyChangeMonitorService } from '../src/modules/admin/services/policy-change-monitor.service';

class StubOpenAiService {
  response() {
    throw new Error('AI should not be called in formula accuracy e2e tests');
  }
}

function chain(
  result: { one?: unknown; rawOne?: unknown; many?: unknown[] } = {},
) {
  const qb: any = {};
  for (const method of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'limit',
    'select',
    'addSelect',
    'groupBy',
    'setParameter',
    'setParameters',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getOne = jest.fn().mockResolvedValue(result.one || null);
  qb.getRawOne = jest.fn().mockResolvedValue(result.rawOne || null);
  qb.getMany = jest.fn().mockResolvedValue(result.many || []);
  return qb;
}

function confidence() {
  return {
    scoreFor: jest.fn().mockResolvedValue({
      score: 1,
      label: 'high',
      source: 'fallback',
      basedOn: {
        cardId: null,
        cardStatus: null,
        evidenceCount: 0,
        agreementScore: null,
        freshnessDays: null,
        brokerGoldenSetMatch: null,
        shadowPendingMismatches: 0,
        latestEvidenceAt: null,
      },
      caveats: [],
    }),
  };
}

describe('formula accuracy phase 1-12 e2e safeguards', () => {
  it('routes ambiguous ranges to manual review instead of compiling a lower bound', async () => {
    const service = new FormulaGenerationService(
      new StubOpenAiService() as any,
    );

    expect(service.generateFormulaByPattern('5% to 10%')).toBeNull();
    await expect(service.generateFormula('5% to 10%')).rejects.toThrow(
      'manual review',
    );
  });

  it('treats added free HTS rows as mechanical zero-formula evidence candidates', () => {
    const formulaGeneration = new FormulaGenerationService(
      new StubOpenAiService() as any,
    );
    const maintenance = new FormulaMaintenanceService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      formulaGeneration,
      new FormulaSemanticsService(),
      new FormulaEvaluationService(formulaGeneration),
      undefined,
    );

    const result = (maintenance as any).deterministicClassifyDiff(
      {
        diffType: 'ADDED',
        diffSummary: {
          changes: { generalRate: { current: null, staged: 'Free' } },
        },
      },
      {
        generalRate: 'Free',
        special: null,
        other: null,
        chapter99: null,
        unit: null,
      },
    );

    expect(result.classification).toBe('mechanical');
    expect(result.parsedRates).toEqual([
      expect.objectContaining({
        field: 'generalRate',
        formula: '0',
        variables: [],
      }),
    ]);
  });

  it('keeps batch duty, fee, and tax totals separate', async () => {
    const formulaGeneration = new FormulaGenerationService(
      new StubOpenAiService() as any,
    );
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        htsNumber: '1234.56.78.90',
        effectiveHtsCode: '1234.56.78.90',
        blocked: false,
        message: '',
        warnings: [],
        citations: [],
        allRequiredVariables: [{ name: 'value', type: 'number' }],
        components: [
          {
            componentType: 'base',
            formula: 'value * 0.1',
            requiredVariables: [{ name: 'value', type: 'number' }],
            appliesWhen: { kind: 'always' },
            sourceCitation: { source: 'test' },
            confidence: 1,
          },
          {
            componentType: 'mpf',
            formula: '5',
            requiredVariables: [],
            appliesWhen: { kind: 'always' },
            sourceCitation: { source: 'test' },
            confidence: 1,
          },
          {
            componentType: 'post_tax',
            formula: '2',
            requiredVariables: [],
            appliesWhen: { kind: 'always' },
            sourceCitation: { source: 'test' },
            confidence: 1,
          },
        ],
      }),
    };
    const service = new TariffRateBatchService(
      resolver as any,
      new FormulaEvaluationService(formulaGeneration),
      new FormulaScopeService(),
      new PolicyApplicabilityService(),
      new TariffConditionEngineService(new PolicyApplicabilityService()),
      confidence() as any,
    );

    const [result] = await service.batchCalculate([
      {
        htsCode: '1234.56.78.90',
        country: 'CN',
        inputs: { value: 100 },
      },
    ]);

    expect(result.totalDuty).toBe(10);
    expect(result.fees).toBe(5);
    expect(result.taxes).toBe(2);
    expect(result.totals).toEqual({
      duty: 10,
      fees: 5,
      taxes: 2,
      payable: 17,
    });
  });

  it('turns policy proposals into linked pending evidence only', async () => {
    const documentRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'doc-1',
        sourceName: 'Federal Register',
        title: 'Tariff notice',
        documentUrl: 'https://example.test/notice',
        snapshotUri: 's3://snapshot/notice',
      }),
    };
    const proposalRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: value.id || 'proposal-1',
        ...value,
      })),
    };
    const evidenceRepo = {
      createQueryBuilder: jest.fn(() => chain()),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'evidence-1', ...value })),
    };
    const sourceRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'source-1',
        sourceUrl: 'https://www.federalregister.gov/api/v1/',
      }),
    };
    const service = new PolicyChangeMonitorService(
      documentRepo as any,
      proposalRepo as any,
      { createQueryBuilder: jest.fn(() => chain()) } as any,
      evidenceRepo as any,
      sourceRepo as any,
      new FormulaSemanticsService(),
      new StubOpenAiService() as any,
    );

    const result = await service.recordProposal({
      documentId: 'doc-1',
      htsNumber: '9903.88.15',
      countryCode: 'CN',
      destinationCode: 'US',
      rateClass: 'section_301',
      componentType: 'section_301',
      effectiveFrom: '2026-05-24',
      effectiveTo: null,
      newRateText: '25%',
      proposedFormula: 'value * 0.25',
      proposedConditionAst: { kind: 'country_in', countries: ['CN'] },
      citationQuote: 'The additional duty is 25 percent.',
      parserConfidence: 0.8,
      parserName: 'policy-test',
      parserVersion: 'e2e',
    });

    expect(result.evidenceId).toBe('evidence-1');
    expect(evidenceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        htsNumber: '9903.88.15',
        status: 'pending',
        validationStatus: 'valid',
        sourceId: 'source-1',
      }),
    );
  });
});
