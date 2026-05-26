import { AuLuxuryCarTaxRule } from './luxury-car-tax.rule';
import { AuWineEqualisationTaxRule } from './wine-equalisation-tax.rule';
import { AuExciseRule } from './excise.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8703.23.0000',
    origin: 'JP',
    destination: 'AU',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 100_000,
    currency: 'AUD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('AuLuxuryCarTaxRule', () => {
  const rule = new AuLuxuryCarTaxRule();

  it('applies to HS 87.03 in AU', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('not applicable for non-vehicle HTS', () => {
    expect(rule.isApplicable(ctx({ htsCode: '6109.10.0000' }))).toBe(false);
  });

  it('not applicable when explicitly flagged ineligible', () => {
    expect(
      rule.isApplicable(ctx({ additionalInputs: { au_lct_eligible: false } })),
    ).toBe(false);
  });

  it('emits formula with FY 2025-26 standard threshold', () => {
    const d = rule.evaluate(ctx({ asOfDate: new Date('2025-08-01') }));
    expect(d.add![0].formula).toBe('(value - 83000) * 0.33');
    expect(d.add![0].constraints?.minAmount).toBe(0);
  });

  it('uses fuel-efficient threshold when flagged', () => {
    const d = rule.evaluate(
      ctx({
        asOfDate: new Date('2025-08-01'),
        additionalInputs: { au_vehicle_fuel_efficient: true },
      }),
    );
    expect(d.add![0].formula).toBe('(value - 94000) * 0.33');
  });
});

describe('AuWineEqualisationTaxRule', () => {
  const rule = new AuWineEqualisationTaxRule();

  it('applies to wine (HS 22.04)', () => {
    expect(rule.isApplicable(ctx({ htsCode: '2204.10.0000' }))).toBe(true);
  });

  it('not applicable to vehicles', () => {
    expect(rule.isApplicable(ctx({ htsCode: '8703.23.0000' }))).toBe(false);
  });

  it('emits 29% on notional wholesale (value × 1.5)', () => {
    const d = rule.evaluate(ctx({ htsCode: '2204.10.0000' }));
    expect(d.add![0].formula).toBe('value * 1.5 * 0.29');
  });
});

describe('AuExciseRule', () => {
  const rule = new AuExciseRule();

  it('applies to beer (HS 22.03)', () => {
    expect(rule.isApplicable(ctx({ htsCode: '2203.00.0000' }))).toBe(true);
  });

  it('applies to tobacco (HS 24.02)', () => {
    expect(rule.isApplicable(ctx({ htsCode: '2402.20.0000' }))).toBe(true);
  });

  it('does not double up on WET-scope wine', () => {
    expect(rule.isApplicable(ctx({ htsCode: '2204.10.0000' }))).toBe(false);
  });

  it('emits beer excise at AUD 56.84/Lal', () => {
    const d = rule.evaluate(
      ctx({ htsCode: '2203.00.0000', additionalInputs: { au_excise_units: 10 } }),
    );
    expect(d.add![0].identifier).toBe('AU_EXCISE_BEER');
    expect(d.add![0].formula).toBe(`${10 * 56.84}`);
  });
});
