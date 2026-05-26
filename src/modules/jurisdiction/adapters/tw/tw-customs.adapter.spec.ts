jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { TwCustomsAdapter } from './tw-customs.adapter';
import { TwTariffLookupService } from './services/tw-tariff-lookup.service';
import { TwBusinessTaxResolverService } from './services/tw-business-tax-resolver.service';
import { FormulaEvaluationService } from '../../../calculator/services/formula-evaluation.service';
import { FormulaGenerationService } from '@hts/core/services/formula-generation.service';

class StubOpenAi {
  response() { throw new Error('AI should not be called'); }
}

function makeAdapter(): TwCustomsAdapter {
  const evaluator = new FormulaEvaluationService(
    new FormulaGenerationService(new StubOpenAi() as any),
  );
  return new TwCustomsAdapter(
    new TwTariffLookupService(),
    new TwBusinessTaxResolverService(),
    evaluator,
  );
}

describe('TwCustomsAdapter', () => {
  it('claims jurisdictionCode = TW', () => {
    const adapter = makeAdapter();
    expect(adapter.jurisdictionCode).toBe('TW');
    expect(adapter.supports({ country: 'TW' })).toBe(true);
  });

  it('applies MFN 10.5% + Business Tax 5% on T-shirt CN-origin > de minimis', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 10_000, // > TWD 2,000
        quantity: 1,
      } as any,
      {
        destinationCountry: 'TW',
        shippingAmount: 500,
        insuranceAmount: 100,
      } as any,
    );

    expect(result.baseDuty).toBe(1_050); // 10.5% of 10,000
    // Business Tax 5% on (10,000 + 1,050 + 500 + 100) = 582.50
    expect(result.taxes).toBe(582.5);
    expect(result.borderPayable).toBe(1_632.5);
    expect(result.landedCost).toBe(10_000 + 500 + 100 + 1_632.5);
  });

  it('exempts duty and Business Tax for TWD 1,500 parcel under de minimis', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 1_500,
      } as any,
      { destinationCountry: 'TW' } as any,
    );
    expect(result.baseDuty).toBe(0);
    expect(result.taxes).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('TW_DE_MINIMIS'))).toBe(true);
  });

  it('applies ANZTEC preferential rate for NZ origin + ANZTEC certificate', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '6109.10.00.04',
      countryOfOrigin: 'NZ',
      certificate: { agreement: 'ANZTEC', claimed: true },
    } as any);
    expect(measures.some((m) => m.identifier === 'TW_ANZTEC')).toBe(true);
  });

  it('applies ASTEP preferential rate for SG origin + ASTEP certificate', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '6109.10.00.04',
      countryOfOrigin: 'SG',
      certificate: { agreement: 'ASTEP', claimed: true },
    } as any);
    expect(measures.some((m) => m.identifier === 'TW_ASTEP')).toBe(true);
  });
});
