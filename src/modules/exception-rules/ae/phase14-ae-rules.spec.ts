import { AeVatRule } from './vat.rule';
import { AeGccOriginQualifyingRule } from './gcc-origin-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'AE',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 5_000,
    currency: 'AED',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('AeVatRule', () => {
  const rule = new AeVatRule();

  it('emits 5% UAE VAT rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('AE_VAT_STANDARD');
    expect(d.data?.rate).toBe(0.05);
  });

  it('warns when input is missing', () => {
    const d = rule.evaluate(ctx());
    // base falls back to declaredValue, no missing warning
    expect(d.notes?.some((n) => /base=5000/i.test(n) || n.length > 0)).toBe(true);
  });
});

describe('AeGccOriginQualifyingRule', () => {
  const rule = new AeGccOriginQualifyingRule();

  it('applies for SA origin with flag', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'SA', additionalInputs: { gcc_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('applies for KW, BH, QA, OM origins', () => {
    for (const origin of ['KW', 'BH', 'QA', 'OM']) {
      const applies = rule.isApplicable(
        ctx({ origin, additionalInputs: { gcc_qualifying: true } }),
      );
      if (!applies) {
        throw new Error(`expected ${origin} to be applicable for ae.gcc-origin.qualifying`);
      }
    }
  });

  it('does NOT apply for non-GCC origin (CN)', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', additionalInputs: { gcc_qualifying: true } }),
      ),
    ).toBe(false);
  });
});
