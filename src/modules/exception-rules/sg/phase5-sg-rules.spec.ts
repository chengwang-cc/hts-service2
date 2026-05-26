import { SgExciseRule } from './excise.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '2208.30.0000',
    origin: 'GB',
    destination: 'SG',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 5000,
    currency: 'SGD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('SgExciseRule', () => {
  const rule = new SgExciseRule();

  it('applies to spirits (HS 22.08)', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('does NOT apply to apparel (SG is a free port)', () => {
    expect(rule.isApplicable(ctx({ htsCode: '6109.10.0000' }))).toBe(false);
  });

  it('emits SGD 88/Lal for spirits', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { sg_excise_units: 5 } }),
    );
    expect(d.add![0].formula).toBe(`${5 * 88}`);
    expect(d.add![0].identifier).toBe('SG_EXCISE_SPIRITS');
  });

  it('emits ad valorem for motor vehicles', () => {
    const d = rule.evaluate(ctx({ htsCode: '8703.23.0000' }));
    expect(d.add![0].formula).toBe('value * 0.2');
    expect(d.add![0].identifier).toBe('SG_EXCISE_VEHICLES');
  });

  it('emits per-kg tobacco for HS 24.02', () => {
    const d = rule.evaluate(
      ctx({ htsCode: '2402.20.0000', additionalInputs: { sg_excise_units: 1 } }),
    );
    expect(d.add![0].formula).toBe(`${1 * 491.4}`);
  });
});
