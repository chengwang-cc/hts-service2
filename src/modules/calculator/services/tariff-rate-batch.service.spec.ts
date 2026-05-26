jest.mock('./tariff-formula-resolver.service', () => ({
  TariffFormulaResolverService: class TariffFormulaResolverService {},
}));

import { FormulaGenerationService } from '@hts/core/services/formula-generation.service';
import { FormulaEvaluationService } from './formula-evaluation.service';
import { FormulaScopeService } from './formula-scope.service';
import { PolicyApplicabilityService } from './policy-applicability.service';
import { TariffRateBatchService } from './tariff-rate-batch.service';
import { TariffConditionEngineService } from './tariff-condition-engine.service';

class StubOpenAiService {
  response() {
    throw new Error('AI should not be called in batch service tests');
  }
}

describe('TariffRateBatchService', () => {
  it('passes scoped inputs into condition evaluation', async () => {
    const resolver = {
      resolve: jest.fn().mockResolvedValue({
        htsNumber: '1234.56.78.90',
        effectiveHtsCode: '1234.56.78.90',
        blocked: false,
        message: '',
        warnings: [],
        citations: [],
        allRequiredVariables: [
          { name: 'quantity_dozen', type: 'number', dimension: 'quantity' },
        ],
        components: [
          {
            componentType: 'base',
            formula: 'quantity_dozen * 2',
            requiredVariables: [
              { name: 'quantity_dozen', type: 'number', dimension: 'quantity' },
            ],
            appliesWhen: { kind: 'always' },
            conditions: { frameworkRateOnly: true },
            sourceCitation: { source: 'test' },
            confidence: 1,
          },
        ],
      }),
    };
    const conditionEngine = {
      evaluate: jest.fn().mockReturnValue(true),
    };
    const tariffConfidence = {
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
    const formulaGeneration = new FormulaGenerationService(
      new StubOpenAiService() as any,
    );
    const service = new TariffRateBatchService(
      resolver as any,
      new FormulaEvaluationService(formulaGeneration),
      new FormulaScopeService(),
      new PolicyApplicabilityService(),
      conditionEngine as unknown as TariffConditionEngineService,
      tariffConfidence as any,
    );

    const [result] = await service.batchCalculate([
      {
        htsCode: '1234.56.78.90',
        country: 'CN',
        inputs: {
          value: 100,
          quantity: 24,
          quantityUnit: 'each' as any,
        },
      },
    ]);

    expect(result.totalDuty).toBe(4);
    expect(result.confidence).toBe(1);
    expect(conditionEngine.evaluate).toHaveBeenCalledWith(
      { frameworkRateOnly: true },
      expect.objectContaining({
        additionalInputs: expect.objectContaining({
          quantity_dozen: 2,
        }),
      }),
    );
  });

  describe('rich component contract', () => {
    function build(serviceComponents: any[]) {
      const resolver = {
        resolve: jest.fn().mockResolvedValue({
          htsNumber: '6109.10.00.04',
          effectiveHtsCode: '6109.10.00.04',
          blocked: false,
          message: '',
          warnings: [],
          citations: [],
          allRequiredVariables: [
            { name: 'value', type: 'number', dimension: 'money' },
          ],
          components: serviceComponents,
        }),
      };
      const conditionEngine = { evaluate: jest.fn().mockReturnValue(true) };
      const tariffConfidence = {
        scoreFor: jest.fn().mockResolvedValue({
          score: 0.95,
          label: 'high',
          source: 'fallback',
          basedOn: {},
          caveats: [],
        }),
      };
      const formulaGeneration = new FormulaGenerationService(
        new StubOpenAiService() as any,
      );
      return new TariffRateBatchService(
        resolver as any,
        new FormulaEvaluationService(formulaGeneration),
        new FormulaScopeService(),
        new PolicyApplicabilityService(),
        conditionEngine as unknown as TariffConditionEngineService,
        tariffConfidence as any,
      );
    }

    it('propagates chapter99HtsCode for a Section 301 component (not only chapter_99 type)', async () => {
      const service = build([
        {
          componentType: 'base',
          formula: 'value * 0.165',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: '6109.10.00.04',
          sourceCitation: { source: 'USITC HTS' },
          confidence: 0.98,
        },
        {
          componentType: 'section_301',
          formula: 'value * 0.075',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: 'SECTION_301_CN_LIST4',
          // The Chapter 99 code lives in conditions.htsHeading for legacy
          // hts_extra_taxes rows. The batch resolver should still surface
          // the precise 9903.88 code on the breakdown row.
          conditions: { htsHeading: '9903.88.15' },
          sourceCitation: { source: 'USTR Section 301 List 4A' },
          confidence: 0.95,
          programFamily: 'section_301',
          programAuthority: 'Section 301 of the Trade Act of 1974',
        },
      ]);

      const [row] = await service.batchCalculate([
        { htsCode: '6109.10.00.04', country: 'CN', inputs: { value: 1000 } },
      ]);

      const ch99 = row.breakdown.find((b) => b.tariffType === 'SECTION_301');
      expect(ch99).toBeDefined();
      expect(ch99!.chapter99HtsCode).toBe('9903.88.15');
      expect(ch99!.programFamily).toBe('section_301');
      expect(ch99!.programAuthority).toMatch(/Section 301/);
      expect(ch99!.sourceCitation).toEqual(
        expect.objectContaining({ source: 'USTR Section 301 List 4A' }),
      );
    });

    it('classifies an unlabeled chapter_99 row as other_chapter_99 (not section_301)', async () => {
      // Regression: prior to calculator-v2 the resolver defaulted unknown
      // extras to section_301, masking Section 201/421/IEEPA/quota/MTB.
      const service = build([
        {
          componentType: 'chapter_99',
          formula: 'value * 0.10',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: 'UNKNOWN_ADD_ON',
          sourceCitation: { source: 'hts_extra_taxes' },
          confidence: 0.5,
        },
      ]);

      const [row] = await service.batchCalculate([
        { htsCode: '6109.10.00.04', country: 'CN', inputs: { value: 1000 } },
      ]);

      expect(row.breakdown[0].programFamily).toBe('other_chapter_99');
    });

    it('falls back to a 9903.xx identifier when conditions are missing', async () => {
      const service = build([
        {
          componentType: 'chapter_99',
          formula: 'value * 0.05',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: '9903.01.25',
          sourceCitation: { source: 'IEEPA reciprocal baseline' },
          confidence: 0.9,
        },
      ]);

      const [row] = await service.batchCalculate([
        { htsCode: '6109.10.00.04', country: 'XX', inputs: { value: 1000 } },
      ]);
      expect(row.breakdown[0].chapter99HtsCode).toBe('9903.01.25');
      expect(row.breakdown[0].programFamily).toBe('reciprocal');
    });

    it('emits a de-duplicated top-level sources array', async () => {
      const service = build([
        {
          componentType: 'base',
          formula: 'value * 0.10',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: '6109.10.00.04',
          sourceCitation: {
            source: 'USITC HTS',
            rowIdentifier: '6109.10.00.04',
          },
          confidence: 0.98,
        },
        {
          componentType: 'section_301',
          formula: 'value * 0.075',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: 'SECTION_301_CN_LIST4',
          sourceCitation: {
            source: 'USITC HTS',
            rowIdentifier: '6109.10.00.04',
          },
          confidence: 0.95,
        },
        {
          componentType: 'mpf',
          formula: 'value * 0.003464',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: 'MPF',
          sourceCitation: { source: 'CBP 19 CFR 24.23', rowIdentifier: 'MPF' },
          confidence: 0.99,
          constraints: {
            minAmount: 33.58,
            maxAmount: 651.5,
            rounding: 'component_2dp',
          },
        },
      ]);

      const [row] = await service.batchCalculate([
        { htsCode: '6109.10.00.04', country: 'CN', inputs: { value: 1000 } },
      ]);
      expect(row.sources).toBeDefined();
      // USITC HTS appears twice on inputs, once on output (dedupe by source+rowIdentifier).
      expect(row.sources!).toHaveLength(2);
      expect(row.sources!.map((s) => s.source).sort()).toEqual([
        'CBP 19 CFR 24.23',
        'USITC HTS',
      ]);
    });

    it('fails closed in validation mode when any component evaluation fails', async () => {
      const service = build([
        {
          componentType: 'base',
          formula: 'missing_value * 0.10',
          requiredVariables: [{ name: 'value', type: 'number' }],
          appliesWhen: { kind: 'always' },
          identifier: '6109.10.00.04',
          sourceCitation: { source: 'USITC HTS' },
          confidence: 0.98,
        },
      ]);

      const [row] = await service.batchCalculate(
        [{ htsCode: '6109.10.00.04', country: 'CN', inputs: { value: 1000 } }],
        { failOnComponentError: true },
      );

      expect(row.blocked).toBe(true);
      expect(row.blockReason).toMatch(/COMPONENT_EVALUATION_ERROR/);
      expect(row.breakdown[0].error).toBeTruthy();
    });
  });
});
