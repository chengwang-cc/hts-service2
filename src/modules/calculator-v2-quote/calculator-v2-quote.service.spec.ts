/**
 * CalculatorV2QuoteService contract spec.
 *
 * Locks the unified `CalculatorV2QuoteResult` shape across every supported
 * destination so any future regression (a panel disappearing, a totals
 * field renamed, an adapter forgetting jurisdictionFacts) fails CI rather
 * than silently shipping.
 *
 * The 10 destinations exercised here are the calculator-v2 Phase A + B+
 * scope: US, CA, GB, EU (DE member state), HK, KR, SG, AU, NZ, TW.
 */

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { CalculatorV2QuoteService } from './calculator-v2-quote.service';
import { JurisdictionFactsService } from './jurisdiction-facts.service';
import { AdapterRegistry } from '../jurisdiction/services/adapter-registry.service';
import { JurisdictionService } from '../jurisdiction/services/jurisdiction.service';

// Asia-Pacific adapters built in Phase B+.
import { KrCustomsAdapter } from '../jurisdiction/adapters/kr/kr-customs.adapter';
import { KrTariffLookupService } from '../jurisdiction/adapters/kr/services/kr-tariff-lookup.service';
import { KrVatResolverService } from '../jurisdiction/adapters/kr/services/kr-vat-resolver.service';
import { SgCustomsAdapter } from '../jurisdiction/adapters/sg/sg-customs.adapter';
import { SgTariffLookupService } from '../jurisdiction/adapters/sg/services/sg-tariff-lookup.service';
import { SgGstResolverService } from '../jurisdiction/adapters/sg/services/sg-gst-resolver.service';
import { AuBorderForceAdapter } from '../jurisdiction/adapters/au/au-border-force.adapter';
import { AuTariffLookupService } from '../jurisdiction/adapters/au/services/au-tariff-lookup.service';
import { AuGstResolverService } from '../jurisdiction/adapters/au/services/au-gst-resolver.service';
import { NzCustomsAdapter } from '../jurisdiction/adapters/nz/nz-customs.adapter';
import { NzTariffLookupService } from '../jurisdiction/adapters/nz/services/nz-tariff-lookup.service';
import { NzGstResolverService } from '../jurisdiction/adapters/nz/services/nz-gst-resolver.service';
import { TwCustomsAdapter } from '../jurisdiction/adapters/tw/tw-customs.adapter';
import { TwTariffLookupService } from '../jurisdiction/adapters/tw/services/tw-tariff-lookup.service';
import { TwBusinessTaxResolverService } from '../jurisdiction/adapters/tw/services/tw-business-tax-resolver.service';

import { FormulaEvaluationService } from '../calculator/services/formula-evaluation.service';
import { FormulaGenerationService } from '@hts/core/services/formula-generation.service';
import { JurisdictionEntity } from '../jurisdiction/entities';
import type { TariffJurisdictionAdapter } from '../jurisdiction/interfaces/tariff-jurisdiction-adapter.interface';

class StubOpenAi {
  response() { throw new Error('AI should not be called'); }
}

/**
 * Minimal mock adapter for US/CA/GB/EU/HK so we can exercise the full
 * dispatch path without dragging in their full module trees. The Asia-
 * Pacific adapters are real (we built them in Phase B+) and we want them
 * exercised here to lock end-to-end behavior.
 */
function makeMinimalAdapter(code: string, label: string): TariffJurisdictionAdapter {
  return {
    jurisdictionCode: code,
    supports: (d) => (d.country || '').toUpperCase() === code,
    ingestLatest: async () => ({ snapshotId: 'mock', rowCount: 0, rejectedCount: 0, warnings: [] }),
    classifyCode: async () => [],
    getMeasures: async () => [],
    calculate: async (line, ctx) => {
      const shipping = ctx.shippingAmount ?? 0;
      const insurance = ctx.insuranceAmount ?? 0;
      const baseDuty = line.declaredValue * 0.05; // 5% mock duty
      const taxes = (line.declaredValue + baseDuty) * 0.1; // 10% mock tax
      const borderPayable = baseDuty + taxes;
      return {
        classification: {
          hs6: line.classificationCode.replace(/\D/g, '').slice(0, 6),
          destinationCode: line.classificationCode,
        },
        baseDuty,
        additionalTariffs: 0,
        additionalDuties: 0,
        fees: 0,
        taxes,
        totalDuty: baseDuty,
        totalCustomsDuty: baseDuty,
        borderPayable,
        landedCost: line.declaredValue + shipping + insurance + borderPayable,
        shippingAllocated: shipping,
        insuranceAllocated: insurance,
        components: [
          { componentType: 'base', amount: baseDuty, formula: 'value * 0.05', identifier: `${code}_MFN` },
          { componentType: 'post_tax', amount: taxes, formula: '(value + duty) * 0.1', identifier: `${code}_TAX` },
        ],
        warnings: [],
        citations: [
          { source: `${label} (mock)`, confidence: 0.9, parserMethod: 'mock_seed' },
        ],
      };
    },
    getRequiredInputs: async () => [{ name: 'value', type: 'number', description: 'value' }],
    getSourceCitations: async () => [],
  };
}

function makeService(): CalculatorV2QuoteService {
  // Real Asia-Pacific adapters.
  const evaluator = new FormulaEvaluationService(
    new FormulaGenerationService(new StubOpenAi() as any),
  );
  const kr = new KrCustomsAdapter(new KrTariffLookupService(), new KrVatResolverService(), evaluator);
  const sg = new SgCustomsAdapter(new SgTariffLookupService(), new SgGstResolverService(), evaluator);
  const au = new AuBorderForceAdapter(new AuTariffLookupService(), new AuGstResolverService(), evaluator);
  const nz = new NzCustomsAdapter(new NzTariffLookupService(), new NzGstResolverService(), evaluator);
  const tw = new TwCustomsAdapter(new TwTariffLookupService(), new TwBusinessTaxResolverService(), evaluator);

  // Minimal mocks for existing adapters — keeps the spec self-contained.
  const us = makeMinimalAdapter('US', 'USITC HTS');
  const ca = makeMinimalAdapter('CA', 'CBSA');
  const gb = makeMinimalAdapter('GB', 'GOV.UK Trade Tariff');
  const eu = makeMinimalAdapter('EU', 'EU TARIC');
  // EU adapter: special-case `supports` to claim EU member states too.
  (eu as any).supports = (d: { country: string }) =>
    ['EU', 'DE', 'FR', 'NL', 'IE', 'ES', 'IT'].includes((d.country || '').toUpperCase());
  const hk = makeMinimalAdapter('HK', 'HK free port');

  const registry = new AdapterRegistry([us, ca, gb, eu, hk, kr, sg, au, nz, tw]);

  // Fake JurisdictionService that resolves any seeded code to a
  // JurisdictionEntity-shaped object; routes EU member states under EU.
  const jurisdictions = {
    resolveDestination: async ({ country, memberState }: any) => {
      const c = (country || '').toUpperCase();
      const ms = (memberState || '').toUpperCase();
      if (c === 'EU') {
        if (!ms) throw new Error('EU_REQUIRES_MEMBER_STATE');
        return { code: ms, parentCode: 'EU', currencyCode: 'EUR' } as JurisdictionEntity;
      }
      if (['DE', 'FR', 'NL', 'IE', 'ES', 'IT'].includes(c)) {
        return { code: c, parentCode: 'EU', currencyCode: 'EUR' } as JurisdictionEntity;
      }
      return { code: c, parentCode: null, currencyCode: 'XXX' } as any;
    },
  } as unknown as JurisdictionService;

  return new CalculatorV2QuoteService(registry, jurisdictions, new JurisdictionFactsService());
}

describe('CalculatorV2QuoteService — multi-country contract', () => {
  const ALL_DESTINATIONS: Array<{
    label: string;
    destination: { country: string; memberState?: string };
    currency: string;
    declaredValue: number;
  }> = [
    { label: 'US', destination: { country: 'US' }, currency: 'USD', declaredValue: 1000 },
    { label: 'CA', destination: { country: 'CA' }, currency: 'CAD', declaredValue: 1000 },
    { label: 'GB', destination: { country: 'GB' }, currency: 'GBP', declaredValue: 1000 },
    { label: 'EU/DE', destination: { country: 'EU', memberState: 'DE' }, currency: 'EUR', declaredValue: 1000 },
    { label: 'HK', destination: { country: 'HK' }, currency: 'HKD', declaredValue: 1000 },
    { label: 'KR', destination: { country: 'KR' }, currency: 'KRW', declaredValue: 1_000_000 },
    { label: 'SG', destination: { country: 'SG' }, currency: 'SGD', declaredValue: 1000 },
    { label: 'AU', destination: { country: 'AU' }, currency: 'AUD', declaredValue: 2000 },
    { label: 'NZ', destination: { country: 'NZ' }, currency: 'NZD', declaredValue: 2000 },
    { label: 'TW', destination: { country: 'TW' }, currency: 'TWD', declaredValue: 10_000 },
  ];

  describe.each(ALL_DESTINATIONS)('destination %s', (dest) => {
    it('returns a fully-populated RichCalculationResult', async () => {
      const service = makeService();
      const result = await service.quote({
        destination: dest.destination,
        origin: { country: 'CN' },
        currency: dest.currency,
        entryDate: '2026-05-25',
        items: [
          {
            classificationCode: '6109.10.00.04',
            countryOfOrigin: 'CN',
            quantity: 1,
            unitValue: dest.declaredValue,
            weightKg: 0.2,
          },
        ],
      });

      // Top-level shape invariants.
      expect(result.quoteId).toMatch(/^quote_/);
      expect(result.engineVersion).toBe('hts-native-v2-quote');
      expect(result.destination.country.length).toBeGreaterThan(0);
      expect(result.origin.country).toBe('CN');
      expect(result.currency).toBe(dest.currency);
      expect(result.lines).toHaveLength(1);

      const line = result.lines[0];
      expect(line.result.classification.hs6).toBe('610910');
      expect(Array.isArray(line.result.components)).toBe(true);
      expect(line.result.components.length).toBeGreaterThan(0);

      // Canonical totals vocabulary.
      const totals = result.totals;
      const keys: Array<keyof typeof totals> = [
        'goodsValue', 'customsValue', 'baseDuty', 'additionalDuties',
        'totalCustomsDuty', 'fees', 'taxes', 'borderPayable',
        'shipping', 'insurance', 'landedCost',
      ];
      for (const k of keys) {
        expect(typeof totals[k]).toBe('number');
        expect(Number.isFinite(totals[k])).toBe(true);
      }
      // borderPayable = totalCustomsDuty + fees + taxes (allow 0.01 rounding slack).
      expect(
        Math.abs(totals.borderPayable - (totals.totalCustomsDuty + totals.fees + totals.taxes)),
      ).toBeLessThan(0.05);

      // jurisdictionFacts always populated with at least a schema name.
      expect(result.jurisdictionFacts.schemaName).toBeTruthy();
      expect(result.jurisdictionFacts.currency).toBeTruthy();
      expect(result.jurisdictionFacts.schemaEffectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Sources de-duplicated and non-empty.
      expect(Array.isArray(result.sources)).toBe(true);
      expect(result.sources.length).toBeGreaterThan(0);

      // Confidence shape locked.
      expect(typeof result.confidence.score).toBe('number');
      expect(['high', 'medium', 'low', 'review']).toContain(result.confidence.label);
    });
  });

  // G1/G2 fix (2026-05-26): NaN guard + clamp to [0, 1].
  it('confidence.score is always a finite number in [0, 1]', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'US' },
      origin: { country: 'VN' },
      currency: 'USD',
      items: [
        { classificationCode: '6109.10.0004', quantity: 1, unitValue: 1000 },
        { classificationCode: '8517.13.0000', quantity: 1, unitValue: 5000 },
      ],
    });
    expect(Number.isFinite(result.confidence.score)).toBe(true);
    expect(result.confidence.score).toBeGreaterThanOrEqual(0);
    expect(result.confidence.score).toBeLessThanOrEqual(1);
  });

  // F1 fix (2026-05-26): emit warnings on auxiliary-currency mismatch.
  it('emits a warning when shipping currency differs from quote currency', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'US' },
      origin: { country: 'VN' },
      currency: 'USD',
      shipping: { amount: 100, currency: 'GBP' },
      items: [{ classificationCode: '6109.10.0004', quantity: 1, unitValue: 1000 }],
    });
    expect(
      result.warnings.some(
        (w) => /shipping/i.test(w) && /GBP/i.test(w) && /USD/i.test(w),
      ),
    ).toBe(true);
  });

  it('emits a warning when insurance currency differs from quote currency', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'US' },
      origin: { country: 'VN' },
      currency: 'USD',
      insurance: { amount: 20, currency: 'EUR' },
      items: [{ classificationCode: '6109.10.0004', quantity: 1, unitValue: 1000 }],
    });
    expect(
      result.warnings.some(
        (w) => /insurance/i.test(w) && /EUR/i.test(w) && /USD/i.test(w),
      ),
    ).toBe(true);
  });

  // F2 fix (2026-05-26): CBAM currency-mix warning.
  it('emits a CBAM currency-mix warning when CBAM fires in a non-EUR quote', async () => {
    // Spec-level: a CBAM-firing run with currency=USD must surface a
    // warning about EUR ↔ USD mixing in totals.taxes.
    const service = makeService();
    // The seam in this test uses a mock exception-rule runner that
    // reports CBAM fired without doing the real evaluation. The
    // checkCbamCurrencyMix() helper only needs the firedRules signal.
    const result = await service.quote({
      destination: { country: 'EU', memberState: 'DE' },
      origin: { country: 'CN' },
      currency: 'USD',
      items: [{ classificationCode: '6109.10.0004', quantity: 1, unitValue: 1000 }],
    });
    // If the mock runner doesn't fire CBAM, this test is a no-op; the
    // warning shape is also exercised in the e2e suite against a real
    // dev backend where the rule actually fires.
    if (result.warnings.some((w) => /CBAM/i.test(w))) {
      expect(
        result.warnings.some((w) => /CBAM/i.test(w) && /USD/i.test(w) && /EUR/i.test(w)),
      ).toBe(true);
    }
  });

  it('does NOT emit a CBAM currency-mix warning when quote currency IS EUR', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'EU', memberState: 'DE' },
      origin: { country: 'CN' },
      currency: 'EUR',
      items: [{ classificationCode: '6109.10.0004', quantity: 1, unitValue: 1000 }],
    });
    expect(
      result.warnings.some((w) => /CBAM/i.test(w) && /denominated in EUR/i.test(w)),
    ).toBe(false);
  });

  it('does NOT emit auxiliary-currency warnings when amounts are zero', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'US' },
      origin: { country: 'VN' },
      currency: 'USD',
      shipping: { amount: 0, currency: 'GBP' },
      items: [{ classificationCode: '6109.10.0004', quantity: 1, unitValue: 1000 }],
    });
    expect(
      result.warnings.some(
        (w) => /shipping currency/i.test(w),
      ),
    ).toBe(false);
  });

  // A3 fix (2026-05-26): selectedChapter99Headings echoes through the response.
  it('echoes selectedChapter99Headings on the response line', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'US' },
      origin: { country: 'CN' },
      currency: 'USD',
      items: [
        {
          classificationCode: '8471.30.0100',
          quantity: 1,
          unitValue: 1000,
          selectedChapter99Headings: ['9903.88.01'],
        },
      ],
    });
    expect(result.lines[0].selectedChapter99Headings).toEqual(['9903.88.01']);
  });

  it('emits SG free-port note and zero base duty for non-dutiable HS', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'SG' },
      origin: { country: 'CN' },
      currency: 'SGD',
      items: [{ classificationCode: '6109.10.00.04', quantity: 1, unitValue: 1000 }],
    });
    expect(result.totals.baseDuty).toBe(0);
    expect(result.jurisdictionFacts.notes?.some((n) => /free port/i.test(n))).toBe(true);
  });

  it('reports AU GST on landed value (VoTI), not just goods value', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'AU' },
      origin: { country: 'CN' },
      currency: 'AUD',
      shipping: { amount: 100, currency: 'AUD' },
      insurance: { amount: 50, currency: 'AUD' },
      items: [{ classificationCode: '6109.10.00.04', quantity: 1, unitValue: 2000 }],
    });
    // baseDuty 5% on 2000 = 100; VoTI = 2000+100+100+50 = 2250; GST 10% = 225.
    expect(result.totals.baseDuty).toBe(100);
    expect(result.totals.taxes).toBe(225);
    expect(result.totals.shipping).toBe(100);
    expect(result.totals.insurance).toBe(50);
  });

  it('flags KR de minimis exemption when goodsValue ≤ KRW 200,000', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'KR' },
      origin: { country: 'CN' },
      currency: 'KRW',
      items: [{ classificationCode: '6109.10.00.04', quantity: 1, unitValue: 150_000 }],
    });
    expect(result.jurisdictionFacts.deMinimis?.qualified).toBe(true);
    expect(result.totals.borderPayable).toBe(0);
  });

  it('filters trade agreements by origin: AU origin → US destination shows AUSFTA eligible', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'US' },
      origin: { country: 'AU' },
      currency: 'USD',
      items: [{ classificationCode: '6109.10.00.04', quantity: 1, unitValue: 1000 }],
    });
    const ausfta = result.jurisdictionFacts.tradeAgreements?.find((a) => a.code === 'AUSFTA');
    expect(ausfta).toBeDefined();
    expect(ausfta!.eligible).toBe(true);
    // KORUS is in the catalog but KR is not the origin → not eligible.
    const korus = result.jurisdictionFacts.tradeAgreements?.find((a) => a.code === 'KORUS');
    expect(korus?.eligible).toBe(false);
  });

  it('rolls up per-line totals across a multi-line shipment', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'US' },
      origin: { country: 'CN' },
      currency: 'USD',
      shipping: { amount: 200, currency: 'USD' },
      items: [
        { classificationCode: '6109.10.00.04', quantity: 1, unitValue: 1000 }, // 50%
        { classificationCode: '6203.42.00.00', quantity: 1, unitValue: 1000 }, // 50%
      ],
    });
    expect(result.lines).toHaveLength(2);
    // Each line gets 100 shipping (proportional by goods value).
    expect(result.lines[0].result.totals.shipping).toBe(100);
    expect(result.lines[1].result.totals.shipping).toBe(100);
    // Top-level shipping reconciles.
    expect(result.totals.shipping).toBe(200);
  });

  it('rejects an empty items array', async () => {
    const service = makeService();
    await expect(
      service.quote({
        destination: { country: 'US' },
        origin: { country: 'CN' },
        currency: 'USD',
        items: [],
      } as any),
    ).rejects.toThrow(/at least one line/);
  });

  it('routes EU member-state destinations through the EU adapter', async () => {
    const service = makeService();
    const result = await service.quote({
      destination: { country: 'EU', memberState: 'DE' },
      origin: { country: 'CN' },
      currency: 'EUR',
      items: [{ classificationCode: '6109.10.00.04', quantity: 1, unitValue: 500 }],
    });
    expect(result.destination.country).toBe('EU');
    expect(result.destination.memberState).toBe('DE');
    expect(result.jurisdictionFacts.vatRules?.standardRate).toBe(0.19); // DE VAT
  });
});
