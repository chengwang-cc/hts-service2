import { InIgstImportRule } from './igst.rule';
import { InRcepQualifyingRule } from './rcep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'IN',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 100_000,
    currency: 'INR',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('InIgstImportRule', () => {
  const rule = new InIgstImportRule();

  it('emits 18% default IGST rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.data?.rate).toBe(0.18);
    expect(d.data?.amount).toBe(18_000);
  });

  it('honors in_igst_rate_override input', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { in_igst_rate_override: 28 } }),
    );
    expect(d.data?.rate as number).toBeCloseTo(0.28, 5);
    expect(d.data?.amount as number).toBeCloseTo(28_000, 3);
  });

  it('rejects boolean override per A1 + defaults to 18%', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { in_igst_rate_override: true as any } }),
    );
    expect(d.data?.rate).toBe(0.18);
    expect(d.notes?.some((n) => /boolean/i.test(n))).toBe(true);
  });
});

describe('InRcepQualifyingRule (ASEAN-India)', () => {
  const rule = new InRcepQualifyingRule();

  it('applies for ASEAN origin (TH)', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'TH', additionalInputs: { asean_india_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('does NOT apply for non-ASEAN origin (CN)', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', additionalInputs: { asean_india_qualifying: true } }),
      ),
    ).toBe(false);
  });
});
