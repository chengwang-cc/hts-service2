import { ThVatRule } from './vat.rule';
import { ThRcepQualifyingRule } from './rcep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'TH',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 50_000,
    currency: 'THB',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('ThVatRule', () => {
  const rule = new ThVatRule();

  it('emits 7% standard VAT rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('TH_VAT_IMPORT');
    expect(d.data?.rate).toBe(0.07);
  });
});

describe('ThRcepQualifyingRule', () => {
  const rule = new ThRcepQualifyingRule();

  it('applies for JP origin with flag', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(true);
  });
});
