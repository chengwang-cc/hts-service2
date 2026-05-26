import { VnVatRule } from './vat.rule';
import { VnCptppQualifyingRule } from './cptpp-qualifying.rule';
import { VnRcepQualifyingRule } from './rcep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'VN',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 1_000_000,
    currency: 'VND',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('VnVatRule', () => {
  const rule = new VnVatRule();

  it('applies for VN destination', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('emits 10% standard rate as post_tax component', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('VN_VAT_IMPORT');
    expect(d.data?.rate).toBe(0.10);
  });
});

describe('VN FTA-qualifying rules', () => {
  it('cptpp applies for JP origin with flag', () => {
    const rule = new VnCptppQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { cptpp_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('cptpp does NOT apply for non-CPTPP origin (US)', () => {
    const rule = new VnCptppQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', additionalInputs: { cptpp_qualifying: true } }),
      ),
    ).toBe(false);
  });

  it('rcep applies for KR origin with flag', () => {
    const rule = new VnRcepQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'KR', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(true);
  });
});
