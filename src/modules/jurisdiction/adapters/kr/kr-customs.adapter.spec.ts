jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { KrCustomsAdapter } from './kr-customs.adapter';
import { KrTariffLookupService } from './services/kr-tariff-lookup.service';
import { KrVatResolverService } from './services/kr-vat-resolver.service';
import { FormulaEvaluationService } from '../../../calculator/services/formula-evaluation.service';
import { FormulaGenerationService } from '@hts/core/services/formula-generation.service';

class StubOpenAi {
  response() { throw new Error('AI should not be called'); }
}

function makeAdapter(): KrCustomsAdapter {
  const evaluator = new FormulaEvaluationService(
    new FormulaGenerationService(new StubOpenAi() as any),
  );
  return new KrCustomsAdapter(
    new KrTariffLookupService(),
    new KrVatResolverService(),
    evaluator,
  );
}

describe('KrCustomsAdapter', () => {
  it('claims jurisdictionCode = KR and supports KR destinations', () => {
    const adapter = makeAdapter();
    expect(adapter.jurisdictionCode).toBe('KR');
    expect(adapter.supports({ country: 'KR' })).toBe(true);
    expect(adapter.supports({ country: 'US' })).toBe(false);
  });

  it('applies MFN duty + VAT 10% on a CN-origin T-shirt at KRW 1,000,000', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 1_000_000,
        weightKg: 0.2,
        quantity: 1,
      } as any,
      {
        destinationCountry: 'KR',
        shippingAmount: 50_000,
        insuranceAmount: 5_000,
      } as any,
    );

    // 13% MFN on 1,000,000 = 130,000
    expect(result.baseDuty).toBe(130_000);
    expect(result.additionalTariffs).toBe(0);
    // VAT 10% on (1,000,000 + 130,000 + 50,000 + 5,000) = 118,500
    expect(result.taxes).toBe(118_500);
    expect(result.totalCustomsDuty).toBe(130_000);
    expect(result.borderPayable).toBe(248_500);
    expect(result.landedCost).toBe(
      1_000_000 + 50_000 + 5_000 + 248_500,
    );
  });

  it('exempts duty + VAT for a KRW 150,000 personal-use parcel (under de minimis)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 150_000,
        quantity: 1,
      } as any,
      { destinationCountry: 'KR' } as any,
    );

    expect(result.baseDuty).toBe(0);
    expect(result.taxes).toBe(0);
    expect(result.borderPayable).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('KR_DE_MINIMIS'))).toBe(true);
  });

  it('emits a chapter99/identifier-style component for source citation', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 1_000_000,
      } as any,
      { destinationCountry: 'KR' } as any,
    );

    expect(result.citations.length).toBeGreaterThan(0);
    expect(
      result.citations.some((c) => c.source.includes('Korea Customs Service')),
    ).toBe(true);
    expect(
      result.citations.some((c) => c.source.includes('National Tax Service')),
    ).toBe(true);
  });

  it('applies KORUS preferential rate (0%) when US origin + KORUS certificate claimed', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '6109.10.00.04',
      countryOfOrigin: 'US',
      certificate: { agreement: 'KORUS', claimed: true },
    } as any);

    expect(measures.some((m) => m.identifier === 'KR_KORUS')).toBe(true);
  });

  it('emits a warning for HS6 not in the seed table', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '0000.00.00.00',
        countryOfOrigin: 'CN',
        declaredValue: 1_000_000,
      } as any,
      { destinationCountry: 'KR' } as any,
    );
    expect(result.baseDuty).toBe(0);
    expect(
      result.components.some((c) =>
        (c.identifier || '').includes('KR_MFN_000000_UNKNOWN'),
      ),
    ).toBe(true);
  });
});
