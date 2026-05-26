jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { SgCustomsAdapter } from './sg-customs.adapter';
import { SgTariffLookupService } from './services/sg-tariff-lookup.service';
import { SgGstResolverService } from './services/sg-gst-resolver.service';
import { FormulaEvaluationService } from '../../../calculator/services/formula-evaluation.service';
import { FormulaGenerationService } from '@hts/core/services/formula-generation.service';

class StubOpenAi {
  response() { throw new Error('AI should not be called'); }
}

function makeAdapter(): SgCustomsAdapter {
  const evaluator = new FormulaEvaluationService(
    new FormulaGenerationService(new StubOpenAi() as any),
  );
  return new SgCustomsAdapter(
    new SgTariffLookupService(),
    new SgGstResolverService(),
    evaluator,
  );
}

describe('SgCustomsAdapter', () => {
  it('claims jurisdictionCode = SG and supports SG destinations', () => {
    const adapter = makeAdapter();
    expect(adapter.jurisdictionCode).toBe('SG');
    expect(adapter.supports({ country: 'SG' })).toBe(true);
    expect(adapter.supports({ country: 'MY' })).toBe(false);
  });

  it('returns duty = 0 with an SG_FREE_PORT warning for a non-dutiable T-shirt at SGD 1,000', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 1000,
        quantity: 1,
      } as any,
      {
        destinationCountry: 'SG',
        shippingAmount: 25,
        insuranceAmount: 5,
      } as any,
    );
    expect(result.baseDuty).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('SG_FREE_PORT'))).toBe(true);
    // GST 9% on 1000 + 0 + 25 + 5 = 92.70
    expect(result.taxes).toBe(92.7);
    expect(result.borderPayable).toBe(92.7);
  });

  it('applies 20% duty + GST on motor vehicle imports', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '8703.23.00.00',
        countryOfOrigin: 'JP',
        declaredValue: 50_000,
        quantity: 1,
      } as any,
      { destinationCountry: 'SG' } as any,
    );
    expect(result.baseDuty).toBe(10_000); // 50,000 × 20%
    // GST 9% on (50,000 + 10,000) = 5,400
    // BUT LVIG threshold is 400 SGD; 50,000 > 400, so GST applies at border.
    expect(result.taxes).toBe(5_400);
    expect(result.borderPayable).toBe(15_400);
  });

  it('suppresses GST at border for LVIG-eligible parcels (≤ SGD 400)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 200,
      } as any,
      { destinationCountry: 'SG' } as any,
    );
    expect(result.taxes).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('SG_LVIG_OVR'))).toBe(true);
  });

  it('flags a tobacco-chapter HS as dutiable with an excise placeholder', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '2402.20.00.00',
      countryOfOrigin: 'ID',
    } as any);
    expect(measures[0].identifier).toMatch(/SG_EXCISE_TOBACCO_240220/);
  });

  it('emits Singapore Customs citation for every component', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '8703.23.00.00',
        countryOfOrigin: 'JP',
        declaredValue: 50_000,
      } as any,
      { destinationCountry: 'SG' } as any,
    );
    expect(
      result.citations.some((c) => c.source.includes('Singapore Customs')),
    ).toBe(true);
    expect(result.citations.some((c) => c.source.includes('IRAS'))).toBe(true);
  });
});
