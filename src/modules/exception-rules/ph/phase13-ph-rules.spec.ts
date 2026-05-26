import { PhVatRule } from './vat.rule';
import { PhRcepQualifyingRule } from './rcep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'PH',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 50_000,
    currency: 'PHP',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('PhVatRule', () => {
  const rule = new PhVatRule();

  it('emits 12% standard rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('PH_VAT_IMPORT');
    expect(d.data?.rate).toBe(0.12);
  });
});

describe('PhRcepQualifyingRule', () => {
  const rule = new PhRcepQualifyingRule();

  it('applies for JP origin with flag', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('does not apply for non-RCEP origin (US)', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(false);
  });
});
