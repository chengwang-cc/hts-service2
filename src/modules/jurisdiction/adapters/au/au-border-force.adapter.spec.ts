jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { AuBorderForceAdapter } from './au-border-force.adapter';
import { AuTariffLookupService } from './services/au-tariff-lookup.service';
import { AuGstResolverService } from './services/au-gst-resolver.service';
import { FormulaEvaluationService } from '../../../calculator/services/formula-evaluation.service';
import { FormulaGenerationService } from '@hts/core/services/formula-generation.service';

class StubOpenAi {
  response() { throw new Error('AI should not be called'); }
}

function makeAdapter(): AuBorderForceAdapter {
  const evaluator = new FormulaEvaluationService(
    new FormulaGenerationService(new StubOpenAi() as any),
  );
  return new AuBorderForceAdapter(
    new AuTariffLookupService(),
    new AuGstResolverService(),
    evaluator,
  );
}

describe('AuBorderForceAdapter', () => {
  it('claims jurisdictionCode = AU', () => {
    const adapter = makeAdapter();
    expect(adapter.jurisdictionCode).toBe('AU');
    expect(adapter.supports({ country: 'AU' })).toBe(true);
  });

  it('computes GST on VoTI (declared + duty + shipping + insurance), not on goods value', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 2_000, // > AUD 1,000 LVIG threshold
        quantity: 1,
      } as any,
      {
        destinationCountry: 'AU',
        shippingAmount: 100,
        insuranceAmount: 50,
      } as any,
    );

    // 5% MFN on 2,000 = 100
    expect(result.baseDuty).toBe(100);
    // VoTI = 2,000 + 100 + 100 + 50 = 2,250
    // GST 10% on VoTI = 225  (NOT 200, which would be on goods value alone)
    expect(result.taxes).toBe(225);
    expect(result.borderPayable).toBe(325);
    expect(result.landedCost).toBe(2_000 + 100 + 50 + 325);
  });

  it('suppresses border GST for LVIG-eligible parcels (≤ AUD 1,000)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '6109.10.00.04',
        countryOfOrigin: 'CN',
        declaredValue: 500,
      } as any,
      { destinationCountry: 'AU' } as any,
    );
    expect(result.taxes).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('AU_LVIG_OST'))).toBe(true);
  });

  it('applies AUSFTA preferential rate for US origin + AUSFTA certificate', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '6109.10.00.04',
      countryOfOrigin: 'US',
      certificate: { agreement: 'AUSFTA', claimed: true },
    } as any);
    expect(measures.some((m) => m.identifier === 'AU_AUSFTA')).toBe(true);
  });

  it('applies AANZFTA when NZ origin + AANZFTA certificate', async () => {
    const adapter = makeAdapter();
    const measures = await adapter.getMeasures({
      classificationCode: '6109.10.00.04',
      countryOfOrigin: 'NZ',
      certificate: { agreement: 'AANZFTA', claimed: true },
    } as any);
    expect(measures.some((m) => m.identifier === 'AU_AANZFTA')).toBe(true);
  });

  it('defaults to 5% MFN for unseeded HS6 with a warning', async () => {
    const adapter = makeAdapter();
    const result = await adapter.calculate(
      {
        classificationCode: '0000.00.00.00',
        countryOfOrigin: 'CN',
        declaredValue: 2_000,
      } as any,
      { destinationCountry: 'AU' } as any,
    );
    expect(result.baseDuty).toBe(100); // 5% of 2,000
    expect(
      result.components.some((c) =>
        (c.identifier || '').includes('AU_MFN_000000_DEFAULT'),
      ),
    ).toBe(true);
  });
});
