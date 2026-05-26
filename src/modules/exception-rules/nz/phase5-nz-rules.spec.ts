import { NzExciseRule } from './excise.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '2208.30.0000',
    origin: 'GB',
    destination: 'NZ',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 5000,
    currency: 'NZD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('NzExciseRule', () => {
  const rule = new NzExciseRule();

  it('applies to spirits (HS 22.08)', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('emits NZD 60.81/Lal for spirits', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { nz_excise_units: 5 } }),
    );
    expect(d.add![0].formula).toBe(`${5 * 60.81}`);
    expect(d.add![0].identifier).toBe('NZ_EXCISE_SPIRITS');
  });

  it('emits NZD 1.34/stick for cigarettes', () => {
    const d = rule.evaluate(
      ctx({
        htsCode: '2402.20.0000',
        additionalInputs: { nz_excise_units: 200 },
      }),
    );
    expect(d.add![0].formula).toBe(`${200 * 1.34}`);
  });

  it('not applicable to apparel', () => {
    expect(rule.isApplicable(ctx({ htsCode: '6109.10.0000' }))).toBe(false);
  });
});
