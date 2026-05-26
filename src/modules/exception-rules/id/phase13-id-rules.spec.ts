import { IdPpnRule } from './ppn.rule';
import { IdRcepQualifyingRule } from './rcep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'ID',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 15_000_000,
    currency: 'IDR',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('IdPpnRule', () => {
  const rule = new IdPpnRule();

  it('emits 11% PPN rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('ID_PPN_IMPORT');
    expect(d.data?.rate).toBe(0.11);
  });
});

describe('IdRcepQualifyingRule', () => {
  const rule = new IdRcepQualifyingRule();

  it('applies for JP origin with flag', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(true);
  });
});
