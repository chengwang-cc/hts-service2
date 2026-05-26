import { CbamScopeService } from './cbam-scope.service';
import { CbamEmbeddedCarbonRule } from './cbam-embedded-carbon.rule';
import {
  CbamQuarterlySettlementService,
  toQuarter,
} from './cbam-quarterly-settlement.service';
import type { ExceptionRuleContext } from '../types';

const SCOPE = new CbamScopeService();
const RULE = new CbamEmbeddedCarbonRule(SCOPE);

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '7208.10.0000',
    origin: 'CN',
    destination: 'EU',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 10_000,
    currency: 'EUR',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('CbamScopeService', () => {
  it('loads a non-empty dataset', () => {
    expect(SCOPE.isInScope('2523.10.0000')).toBe(true);
    expect(SCOPE.isInScope('7208.10.0000')).toBe(true);
    expect(SCOPE.isInScope('7601.10.0000')).toBe(true);
  });
  it('is not in scope for apparel', () => {
    expect(SCOPE.isInScope('6109.10.0004')).toBe(false);
  });
  it('returns default emissions for in-scope HTS', () => {
    const e = SCOPE.defaultEmissions('7208.10.0000');
    expect(e?.direct).toBeGreaterThan(0);
    expect(e?.indirect).toBeGreaterThan(0);
  });
  it('reports sector for scope HTS', () => {
    expect(SCOPE.sectorFor('7208.10.0000')).toBe('iron_steel');
    expect(SCOPE.sectorFor('7601.10.0000')).toBe('aluminum');
    expect(SCOPE.sectorFor('3102.10.0000')).toBe('fertilizers');
  });
  it('free allocation share decreases over years', () => {
    expect(SCOPE.freeAllocationShare(2026)).toBeGreaterThan(
      SCOPE.freeAllocationShare(2030),
    );
    expect(SCOPE.freeAllocationShare(2033)).toBe(0);
  });
});

describe('CbamEmbeddedCarbonRule', () => {
  it('applies to in-scope HTS into EU', () => {
    expect(RULE.isApplicable(ctx({ htsCode: '7208.10.0000' }))).toBe(true);
  });
  it('not applicable for out-of-scope', () => {
    expect(RULE.isApplicable(ctx({ htsCode: '6109.10.0000' }))).toBe(false);
  });
  it('emits provisional cost using default emissions when no exporter declaration', () => {
    const d = RULE.evaluate(
      ctx({ additionalInputs: { eu_cbam_quantity_tonnes: 10 } }),
    );
    expect(d.add).toHaveLength(1);
    const comp = d.add![0];
    expect(comp.identifier).toBe('EU_CBAM_IRON_STEEL');
    expect(comp.description).toContain('EU DEFAULT');
    // Should be a numeric literal (precomputed cost)
    expect(Number(comp.formula)).toBeGreaterThan(0);
  });
  it('uses declared emissions when exporter declaration attached', () => {
    const d = RULE.evaluate(
      ctx({
        additionalInputs: {
          eu_cbam_quantity_tonnes: 10,
          eu_cbam_direct_emissions: 0.1,
          eu_cbam_indirect_emissions: 0.05,
          eu_cbam_exporter_declaration_attached: true,
        },
      }),
    );
    expect(d.add![0].description).toContain('verified exporter declaration');
  });
  it('cost scales with quantity', () => {
    const d1 = RULE.evaluate(
      ctx({ additionalInputs: { eu_cbam_quantity_tonnes: 1 } }),
    );
    const d2 = RULE.evaluate(
      ctx({ additionalInputs: { eu_cbam_quantity_tonnes: 10 } }),
    );
    const cost1 = Number(d1.add![0].formula);
    const cost2 = Number(d2.add![0].formula);
    expect(cost2).toBeCloseTo(cost1 * 10, 4);
  });
});

describe('CbamQuarterlySettlementService', () => {
  it('toQuarter buckets correctly', () => {
    expect(toQuarter(new Date('2026-01-15'))).toBe('2026-Q1');
    expect(toQuarter(new Date('2026-05-26'))).toBe('2026-Q2');
    expect(toQuarter(new Date('2026-12-31'))).toBe('2026-Q4');
  });

  it('aggregates by quarter and sector', async () => {
    const svc = new CbamQuarterlySettlementService();
    await svc.record({
      quoteId: 'q1', htsCode: '7208.10.0000', sector: 'iron_steel',
      defaultApplied: true, cbamCertificates: 10, provisionalCostEur: 800,
      observedAt: new Date('2026-05-15'),
    });
    await svc.record({
      quoteId: 'q2', htsCode: '7601.10.0000', sector: 'aluminum',
      defaultApplied: false, cbamCertificates: 5, provisionalCostEur: 400,
      observedAt: new Date('2026-05-16'),
    });
    await svc.record({
      quoteId: 'q3', htsCode: '7208.10.0000', sector: 'iron_steel',
      defaultApplied: true, cbamCertificates: 7, provisionalCostEur: 560,
      observedAt: new Date('2026-08-10'),
    });

    const all = await svc.summary();
    expect(all).toHaveLength(2);

    const q2 = (await svc.summary('2026-Q2'))[0];
    expect(q2.quoteCount).toBe(2);
    expect(q2.totalCertificates).toBeCloseTo(15);
    expect(q2.totalCostEur).toBeCloseTo(1200);
    expect(q2.sectors['iron_steel'].quoteCount).toBe(1);
    expect(q2.sectors['aluminum'].quoteCount).toBe(1);

    const q3 = (await svc.summary('2026-Q3'))[0];
    expect(q3.quoteCount).toBe(1);
  });
});
