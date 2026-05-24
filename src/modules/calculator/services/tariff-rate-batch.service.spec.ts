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
    const formulaGeneration = new FormulaGenerationService(
      new StubOpenAiService() as any,
    );
    const service = new TariffRateBatchService(
      resolver as any,
      new FormulaEvaluationService(formulaGeneration),
      new FormulaScopeService(),
      new PolicyApplicabilityService(),
      conditionEngine as unknown as TariffConditionEngineService,
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
    expect(conditionEngine.evaluate).toHaveBeenCalledWith(
      { frameworkRateOnly: true },
      expect.objectContaining({
        additionalInputs: expect.objectContaining({
          quantity_dozen: 2,
        }),
      }),
    );
  });
});
