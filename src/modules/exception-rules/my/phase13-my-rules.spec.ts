import { MySalesTaxRule } from './sales-tax.rule';
import { MyCptppQualifyingRule } from './cptpp-qualifying.rule';
import { MyRcepQualifyingRule } from './rcep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'MY',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 5_000,
    currency: 'MYR',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('MySalesTaxRule', () => {
  const rule = new MySalesTaxRule();

  it('emits 10% standard SST rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('MY_SST_IMPORT');
    expect(d.data?.rate).toBe(0.10);
  });
});

describe('MY FTA-qualifying rules', () => {
  it('cptpp applies for JP origin with flag', () => {
    const rule = new MyCptppQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { cptpp_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('rcep applies for KR origin with flag', () => {
    const rule = new MyRcepQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'KR', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(true);
  });
});
