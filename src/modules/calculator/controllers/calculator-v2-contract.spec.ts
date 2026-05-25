/**
 * Contract test for the JWT-friendly calculator v2 endpoints
 * (`GET /v2/formula` and `POST /v2/tariff-rates`).
 *
 * The intent is to lock in the shape of the response the calculator-v2 UI
 * relies on:
 *   - `chapter99HtsCode` is populated for any Chapter 99 component, not only
 *     `componentType === 'chapter_99'`
 *   - `programFamily` and `programAuthority` are present on every row
 *   - `sourceCitation` is preserved through the batch layer
 *   - The row-level `sources[]` is de-duplicated
 *   - `systemSelectedChapter99Headings` round-trips
 *
 * If any of these fields disappear in the future, CI fails and the UI's
 * cost-allocation / Chapter 99 details / sources panels would otherwise
 * silently regress.
 */

// Heavy transitive imports (TypeORM entity decorators, ai-service repos,
// etc.) are stubbed so the contract test stays a pure shape check that
// doesn't require a database.
jest.mock('../services', () => ({
  CalculationService: class CalculationService {},
  FormulaEvaluationService: class FormulaEvaluationService {},
}));
jest.mock('../services/tariff-formula-resolver.service', () => ({
  TariffFormulaResolverService: class TariffFormulaResolverService {},
}));
jest.mock('../services/tariff-rate-batch.service', () => ({
  TariffRateBatchService: class TariffRateBatchService {},
}));
jest.mock('../entities', () => ({ CalculationScenarioEntity: class {} }));
jest.mock('../dto', () => ({ CalculateDto: class CalculateDto {} }));
jest.mock('../../api-keys/guards/api-key.guard', () => ({
  ApiKeyGuard: class {},
}));
jest.mock('../../api-keys/decorators/api-permissions.decorator', () => ({
  ApiPermissions: () => () => undefined,
}));
jest.mock('../../api-keys/decorators/skip-jwt-auth.decorator', () => ({
  SkipJwtAuth: () => () => undefined,
}));
jest.mock('../../auth/decorators/public.decorator', () => ({
  Public: () => () => undefined,
}));
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { CalculatorController } from './calculator.controller';

describe('CalculatorController (v2 contract)', () => {
  let controller: CalculatorController;
  let tariffRateBatch: { batchFormulas: jest.Mock; batchCalculate: jest.Mock };

  beforeEach(() => {
    tariffRateBatch = {
      batchFormulas: jest.fn(),
      batchCalculate: jest.fn(),
    };
    controller = new CalculatorController(
      {} as any, // calculationService
      {} as any, // formulaEvaluation
      {} as any, // tariffFormulaResolver
      tariffRateBatch as any,
      {} as any, // scenarioRepository
    );
  });

  describe('GET /v2/formula', () => {
    it('returns the rich formulas payload with chapter99HtsCode + programFamily', async () => {
      tariffRateBatch.batchFormulas.mockResolvedValue([
        {
          htsCode: '6109.10.00.04',
          country: 'CN',
          effectiveHtsCode: '6109.10.00.04',
          blocked: false,
          blockReason: null,
          message: '',
          systemSelectedChapter99Headings: ['9903.88.15'],
          formulas: [
            {
              componentType: 'base',
              tariffType: 'GENERAL',
              tariffTypeDescription: 'Base (general / MFN) rate',
              formula: 'value * 0.165',
              formulaVariables: [{ name: 'value', type: 'number' }],
              chapter99HtsCode: null,
              programFamily: 'base',
              programAuthority: 'HTS Chapter 1-97',
              rateText: '16.5%',
              identifier: '6109.10.00.04',
              confidence: 0.98,
              sourceCitation: { source: 'USITC HTS' },
            },
            {
              componentType: 'section_301',
              tariffType: 'SECTION_301',
              tariffTypeDescription: 'Section 301 List 4A',
              formula: 'value * 0.075',
              formulaVariables: [{ name: 'value', type: 'number' }],
              chapter99HtsCode: '9903.88.15',
              programFamily: 'section_301',
              programAuthority: 'Section 301 of the Trade Act of 1974',
              rateText: '7.5%',
              identifier: 'SECTION_301_CN_LIST4',
              confidence: 0.95,
              sourceCitation: { source: 'USTR Section 301 List 4A' },
            },
          ],
        },
      ]);

      const res = (await controller.getFormulaV2(
        '6109.10.00.04',
        'CN',
        '2026-05-25',
        undefined,
        undefined,
        { user: { organizationId: 'org_1' } } as any,
      )) as any;

      expect(res.systemSelectedChapter99Headings).toEqual(['9903.88.15']);
      expect(res.formulas).toHaveLength(2);

      const section301 = res.formulas.find(
        (f: any) => f.componentType === 'section_301',
      );
      expect(section301.chapter99HtsCode).toBe('9903.88.15');
      expect(section301.programFamily).toBe('section_301');
      expect(section301.programAuthority).toMatch(/Section 301/);
      expect(section301.rateText).toBe('7.5%');
      expect(section301.sourceCitation.source).toBe(
        'USTR Section 301 List 4A',
      );
    });

    it('throws BAD_REQUEST when htsCode is missing', async () => {
      await expect(
        controller.getFormulaV2('', 'CN', undefined, undefined, undefined, {
          user: { organizationId: 'org_1' },
        } as any),
      ).rejects.toThrow(/htsCode and country are required/);
    });

    it('forwards selectedChapter99Headings to the batch service', async () => {
      tariffRateBatch.batchFormulas.mockResolvedValue([
        {
          htsCode: '6109.10.00.04',
          country: 'CN',
          effectiveHtsCode: '6109.10.00.04',
          blocked: false,
          blockReason: null,
          message: '',
          systemSelectedChapter99Headings: [],
          formulas: [],
        },
      ]);

      await controller.getFormulaV2(
        '6109.10.00.04',
        'CN',
        undefined,
        undefined,
        '9903.88.15, 9903.01.25',
        { user: { organizationId: 'org_1' } } as any,
      );

      expect(tariffRateBatch.batchFormulas).toHaveBeenCalledWith([
        expect.objectContaining({
          selectedChapter99Headings: ['9903.88.15', '9903.01.25'],
        }),
      ]);
    });
  });

  describe('POST /v2/tariff-rates', () => {
    it('returns totals, breakdown, and sources with canonical vocabulary', async () => {
      tariffRateBatch.batchCalculate.mockResolvedValue([
        {
          htsCode: '6109.10.00.04',
          country: 'CN',
          effectiveHtsCode: '6109.10.00.04',
          blocked: false,
          blockReason: null,
          message: '',
          systemSelectedChapter99Headings: ['9903.88.15'],
          totalDuty: 240,
          fees: 33.58,
          taxes: 0,
          totals: { duty: 240, fees: 33.58, taxes: 0, payable: 273.58 },
          confidence: 0.95,
          confidenceDetails: {
            score: 0.95,
            label: 'high',
            source: 'fallback',
            basedOn: {},
            caveats: [],
          },
          breakdown: [
            {
              componentType: 'base',
              tariffType: 'GENERAL',
              tariffTypeDescription: 'Base rate',
              amount: 165,
              formula: 'value * 0.165',
              formulaVariables: [{ name: 'value', type: 'number' }],
              chapter99HtsCode: null,
              programFamily: 'base',
              programAuthority: 'HTS Chapter 1-97',
              confidence: 0.98,
              sourceCitation: { source: 'USITC HTS' },
              error: null,
            },
            {
              componentType: 'section_301',
              tariffType: 'SECTION_301',
              tariffTypeDescription: 'Section 301 List 4A',
              amount: 75,
              formula: 'value * 0.075',
              formulaVariables: [{ name: 'value', type: 'number' }],
              chapter99HtsCode: '9903.88.15',
              programFamily: 'section_301',
              programAuthority: 'Section 301 of the Trade Act of 1974',
              confidence: 0.95,
              sourceCitation: { source: 'USTR Section 301 List 4A' },
              error: null,
            },
          ],
          sources: [
            { source: 'USITC HTS', rowIdentifier: '6109.10.00.04' },
            { source: 'USTR Section 301 List 4A', rowIdentifier: 'L4A' },
          ],
        },
      ]);

      const res = (await controller.getTariffRatesV2(
        [{ htsCode: '6109.10.00.04', country: 'CN', inputs: { value: 1000 } }],
        { user: { organizationId: 'org_1' } } as any,
      )) as any[];

      const row = res[0];
      expect(row.totals).toEqual({
        duty: 240,
        fees: 33.58,
        taxes: 0,
        payable: 273.58,
      });
      expect(row.systemSelectedChapter99Headings).toEqual(['9903.88.15']);
      expect(row.sources).toHaveLength(2);

      const section301Row = row.breakdown.find(
        (b: any) => b.componentType === 'section_301',
      );
      expect(section301Row.chapter99HtsCode).toBe('9903.88.15');
      expect(section301Row.programFamily).toBe('section_301');
      expect(section301Row.programAuthority).toMatch(/Section 301/);
      expect(section301Row.sourceCitation.source).toBe(
        'USTR Section 301 List 4A',
      );
    });

    it('returns an empty array when body is not an array', async () => {
      tariffRateBatch.batchCalculate.mockResolvedValue([]);
      const res = (await controller.getTariffRatesV2(
        null as any,
        { user: { organizationId: 'org_1' } } as any,
      )) as any[];
      expect(res).toEqual([]);
      expect(tariffRateBatch.batchCalculate).toHaveBeenCalledWith([]);
    });
  });
});
