import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';

jest.mock('../../calculator/services/tariff-formula-resolver.service', () => ({
  TariffFormulaResolverService: class TariffFormulaResolverService {},
}));

jest.mock('../../calculator/services/tariff-rate-batch.service', () => ({
  TariffRateBatchService: class TariffRateBatchService {},
}));

import { ExternalProviderFormulaAdminService } from './external-provider-formula.admin.service';

function snapshotQueryBuilder<T>(result: T | null) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

describe('ExternalProviderFormulaAdminService validation plumbing', () => {
  function buildService(snapshot: Record<string, unknown> | null = null) {
    const formulaRepo = {
      createQueryBuilder: jest.fn(() => snapshotQueryBuilder(snapshot)),
    };
    const htsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const tariffFormulaResolver = {
      resolve: jest.fn().mockResolvedValue({ components: [] }),
    };
    const tariffRateBatch = {
      batchCalculate: jest.fn().mockResolvedValue([
        {
          htsCode: '8302.49.60.85',
          effectiveHtsCode: '8302.49.60.85',
          blocked: false,
          blockReason: null,
          totalDuty: 1700,
          fees: 0,
          taxes: 0,
          totals: { duty: 1700, fees: 0, taxes: 0, payable: 1700 },
          breakdown: [
            {
              componentType: 'additionalDuty',
              tariffType: 'chapter99',
              programFamily: 'section_301',
              chapter99HtsCode: '9903.88.15',
              amount: 1700,
              formula: 'value * 0.17',
            },
          ],
          sources: [],
        },
      ]),
    };

    return {
      service: new ExternalProviderFormulaAdminService(
        formulaRepo as any,
        htsRepo as any,
        {} as any,
        {} as any,
        new FormulaSemanticsService(),
        tariffFormulaResolver as any,
        tariffRateBatch as any,
      ),
      formulaRepo,
      htsRepo,
      tariffFormulaResolver,
      tariffRateBatch,
    };
  }

  it('includes the HTS number in the provider snapshot context hash', () => {
    const { service } = buildService();
    const base = {
      provider: 'FLEXPORT',
      countryCode: 'CN',
      entryDate: '2026-05-25',
      modeOfTransport: 'OCEAN',
      inputContext: { value: 10000 },
    };

    const first = (service as any).hashContext({
      ...base,
      htsNumber: '8302.49.60.85',
    });
    const second = (service as any).hashContext({
      ...base,
      htsNumber: '8302.49.60.86',
    });

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).not.toBe(second);
  });

  it('builds Flexport URLs with material inputs and FIELD passthroughs', () => {
    const { service } = buildService();

    const url = (service as any).buildFlexportUrl({
      htsNumber: '8302.49.60.85',
      countryCode: 'CN',
      entryDate: '2026-05-25',
      modeOfTransport: 'OCEAN',
      value: 10000,
      productName: 'other',
      inputContext: {
        dateOfLoading: '2026-05-25',
        aluminumWeightPercentage: 30,
        aluminumCountryOfSmelt: 'CA',
        steelWeightPercentage: 50,
        chapter99Selections: { '99038213': false },
        spiSelections: { C: false },
        FIELD_CUSTOM_RATE_CONTEXT: { program: 'test' },
      },
    });

    const params = new URL(url).searchParams;
    expect(params.get('htsCode')).toBe('8302.49.60.85');
    expect(params.get('country')).toBe('CN');
    expect(params.get('value')).toBe('10000');
    expect(params.get('FIELD_DATE_OF_LOADING')).toBe('"2026-05-25"');
    expect(params.get('FIELD_ALUMINUM_WEIGHT_PERCENTAGE')).toBe('30');
    expect(params.get('FIELD_ALUMINUM_COUNTRY_OF_SMELT')).toBe('"CA"');
    expect(params.get('FIELD_STEEL_WEIGHT_PERCENTAGE')).toBe('50');
    expect(params.get('FIELD_CHOSEN_HTS_CODES')).toBe('{"99038213":false}');
    expect(params.get('FIELD_CHOSEN_SPIS')).toBe('{"C":false}');
    expect(params.get('FIELD_CUSTOM_RATE_CONTEXT')).toBe('{"program":"test"}');
  });

  it('uses quote mode to compare provider totals against the local calculator', async () => {
    const snapshot = {
      id: 'snapshot-1',
      provider: 'FLEXPORT',
      htsNumber: '8302.49.60.85',
      countryCode: 'CN',
      entryDate: '2026-05-25',
      modeOfTransport: 'OCEAN',
      isLatest: true,
      inputContext: { value: 10000 },
      formulaRaw: null,
      formulaNormalized: null,
      formulaComponents: null,
      outputBreakdown: {
        totalDuty: 1700,
        components: [
          {
            componentType: 'additionalDuty',
            programFamily: 'section_301',
            chapter99HtsCode: '9903.88.15',
            amount: 1700,
            formulaText: '0.17 * value',
          },
        ],
      },
    };
    const { service, tariffRateBatch } = buildService(snapshot);

    const result = await service.compareWithLiveFormula({
      provider: 'FLEXPORT',
      htsNumber: '8302.49.60.85',
      countryCode: 'CN',
      entryDate: '2026-05-25',
      modeOfTransport: 'OCEAN',
      inputContext: { value: 10000 },
      validationMode: 'quote',
    });

    expect(result.comparison).toEqual(
      expect.objectContaining({
        isMatch: true,
        validationMode: 'quote',
        mismatchReason: 'MATCH',
      }),
    );
    expect(result.comparison.quoteComparison).toEqual(
      expect.objectContaining({
        providerTotalDuty: 1700,
        localTotalDuty: 1700,
        delta: 0,
        localBlocked: false,
      }),
    );
    expect(tariffRateBatch.batchCalculate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          htsCode: '8302.49.60.85',
          country: 'CN',
          entryDate: '2026-05-25',
          inputs: { value: 10000 },
        }),
      ],
      { failOnComponentError: true },
    );
  });
});
