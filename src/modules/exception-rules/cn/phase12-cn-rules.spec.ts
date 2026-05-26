import { CnVatRule } from './vat.rule';
import { CnRcepQualifyingRule } from './rcep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'US',
    destination: 'CN',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 10_000,
    currency: 'CNY',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('CnVatRule', () => {
  const rule = new CnVatRule();

  it('emits 13% standard rate for general goods', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.data?.rate).toBe(0.13);
  });

  it('emits 9% reduced rate for food/agri (Ch01-24)', () => {
    const d = rule.evaluate(ctx({ htsCode: '0401.10.0000' }));
    expect(d.data?.rate).toBe(0.09);
  });

  it('emits 9% reduced rate for printed books (Ch49)', () => {
    const d = rule.evaluate(ctx({ htsCode: '4901.10.0000' }));
    expect(d.data?.rate).toBe(0.09);
  });
});

describe('CnRcepQualifyingRule', () => {
  const rule = new CnRcepQualifyingRule();

  it('applies for JP origin with flag', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('does not apply for non-RCEP origin (US not in RCEP)', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(false);
  });
});
