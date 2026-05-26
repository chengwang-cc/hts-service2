import { TwCommodityTaxRule } from './commodity-tax.rule';
import { TwTobaccoAlcoholTaxRule } from './tobacco-alcohol-tax.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8703.23.0000',
    origin: 'JP',
    destination: 'TW',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 100_000,
    currency: 'TWD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('TwCommodityTaxRule', () => {
  const rule = new TwCommodityTaxRule();

  it('applies to small vehicle (HS 87.03 ≤2000cc)', () => {
    expect(
      rule.isApplicable(ctx({ additionalInputs: { tw_vehicle_displacement_cc: 1800 } })),
    ).toBe(true);
  });

  it('emits 25% for vehicle ≤2000cc', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { tw_vehicle_displacement_cc: 1800 } }),
    );
    expect(d.add![0].formula).toBe('value * 0.25');
  });

  it('emits 30% for vehicle >2000cc', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { tw_vehicle_displacement_cc: 3000 } }),
    );
    expect(d.add![0].formula).toBe('value * 0.3');
  });

  it('emits 15% for EV (HS 8703.80)', () => {
    const d = rule.evaluate(ctx({ htsCode: '8703.80.0000' }));
    expect(d.add![0].formula).toBe('value * 0.15');
  });

  it('applies to refrigerator (HS 84.18)', () => {
    const d = rule.evaluate(ctx({ htsCode: '8418.30.0000' }));
    expect(d.add![0].formula).toBe('value * 0.13');
  });

  it('not applicable to apparel', () => {
    expect(rule.isApplicable(ctx({ htsCode: '6109.10.0000' }))).toBe(false);
  });
});

describe('TwTobaccoAlcoholTaxRule', () => {
  const rule = new TwTobaccoAlcoholTaxRule();

  it('applies to beer (HS 22.03)', () => {
    expect(rule.isApplicable(ctx({ htsCode: '2203.00.0000' }))).toBe(true);
  });

  it('emits NTD 26/L for beer', () => {
    const d = rule.evaluate(
      ctx({
        htsCode: '2203.00.0000',
        additionalInputs: { tw_alcohol_liters: 100 },
      }),
    );
    expect(d.add).toHaveLength(1);
    expect(d.add![0].formula).toBe(`${100 * 26}`);
  });

  it('emits two components for cigarettes (excise + health surcharge)', () => {
    const d = rule.evaluate(
      ctx({
        htsCode: '2402.20.0000',
        additionalInputs: { tw_tobacco_sticks: 1000 },
      }),
    );
    expect(d.add).toHaveLength(2);
    const ids = d.add!.map((c) => c.identifier);
    expect(ids).toContain('TW_TAT_CIGARETTES');
    expect(ids).toContain('TW_HEALTH_WELFARE_TOBACCO');
  });

  it('emits spirits proportional to (liters × degree × 2.5)', () => {
    const d = rule.evaluate(
      ctx({
        htsCode: '2208.20.0000',
        additionalInputs: { tw_alcohol_liters: 10, tw_alcohol_degree: 40 },
      }),
    );
    expect(d.add![0].formula).toBe(`${10 * 40 * 2.5}`);
  });
});
