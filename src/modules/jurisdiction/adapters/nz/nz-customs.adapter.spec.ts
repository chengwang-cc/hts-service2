jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { NzCustomsAdapter } from './nz-customs.adapter';
import { NzTariffLookupService } from './services/nz-tariff-lookup.service';
import { NzGstResolverService } from './services/nz-gst-resolver.service';
import { FormulaEvaluationService } from '../../../calculator/services/formula-evaluation.service';
import { FormulaGenerationService } from '@hts/core/services/formula-generation.service';

class StubOpenAi {
  response() { throw new Error('AI should not be called'); }
}

function makeAdapter(): NzCustomsAdapter {
  const evaluator = new FormulaEvaluationService(
    new FormulaGenerationService(new StubOpenAi() as any),
  );
  return new NzCustomsAdapter(
    new NzTariffLookupService(),
    new NzGstResolverService(),
    evaluator,
  );
}

describe('NzCustomsAdapter', () => {
  it('claims jurisdictionCode = NZ', () => {
    const adapter = makeAdapter();
    expect(adapter.jurisdictionCode).toBe('NZ');
    expect(adapter.supports({ country: 'NZ' })).toBe(true);
  });

  it('computes GST 15% on landed value (not goods value) for CN-origin shipment > LVIG', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 2_000, // > NZD 1,000 LVIG
        quantity: 1,
      } as any,
      {
        destinationCountry: 'NZ',
        shippingAmount: 100,
        insuranceAmount: 50,
      } as any,
    );

    // 10% MFN on 2,000 = 200
    expect(result.baseDuty).toBe(200);
    // Landed = 2,000 + 200 + 100 + 50 = 2,350
    // GST 15% on landed = 352.50
    expect(result.taxes).toBe(352.5);
    expect(result.borderPayable).toBe(552.5);
    expect(result.landedCost).toBe(2_000 + 100 + 50 + 552.5);
  });

  it('suppresses border GST for LVIG-eligible parcels (≤ NZD 1,000)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 500,
      } as any,
      { destinationCountry: 'NZ' } as any,
    );
    expect(result.taxes).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('NZ_LVIG_OST'))).toBe(true);
  });

  it('applies CER preferential rate for AU origin + CER certificate', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '6109.10.00.04',
      countryOfOrigin: 'AU',
      certificate: { agreement: 'CER', claimed: true },
    } as any);
    expect(measures.some((m) => m.identifier === 'NZ_CER')).toBe(true);
  });

  it('applies ANZTEC for TW origin + ANZTEC certificate', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '6109.10.00.04',
      countryOfOrigin: 'TW',
      certificate: { agreement: 'ANZTEC', claimed: true },
    } as any);
    expect(measures.some((m) => m.identifier === 'NZ_ANZTEC')).toBe(true);
  });
});
