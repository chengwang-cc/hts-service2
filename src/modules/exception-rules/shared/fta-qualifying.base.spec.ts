import { KrKorusQualifyingRule } from '../kr/korus-qualifying.rule';
import { AuChaftaQualifyingRule } from '../au/chafta-qualifying.rule';
import { NzNzChinaQualifyingRule } from '../nz/nz-china-qualifying.rule';
import { CaCusmaQualifyingRule } from '../ca/cusma-qualifying.rule';
import type { ExceptionRuleContext, TariffFormulaComponent } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '6109.10.0000',
    origin: 'US',
    destination: 'KR',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 1000,
    currency: 'KRW',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

function baseRow(): TariffFormulaComponent {
  return {
    componentType: 'base',
    formula: 'value * 0.13',
    requiredVariables: [],
    identifier: 'BASE_AD_VALOREM',
    programFamily: 'base',
    appliesWhen: { kind: 'always' },
    sourceCitation: { source: 'KR HSK column' },
    confidence: 1,
  };
}

describe('FtaQualifyingRuleBase — concrete implementations', () => {
  it('KORUS — applies for US→KR with korus_qualifying=true', () => {
    const rule = new KrKorusQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', destination: 'KR', additionalInputs: { korus_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('KORUS — does not apply for CN origin', () => {
    const rule = new KrKorusQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', destination: 'KR', additionalInputs: { korus_qualifying: true } }),
      ),
    ).toBe(false);
  });

  it('KORUS — replaces base with 0', () => {
    const rule = new KrKorusQualifyingRule();
    const d = rule.evaluate(
      ctx({
        origin: 'US',
        destination: 'KR',
        pendingComponents: [baseRow()],
        additionalInputs: { korus_qualifying: true },
      }),
    );
    expect(d.replace![0].with.formula).toBe('0');
    expect(d.replace![0].with.identifier).toBe('KORUS_QUALIFYING');
  });

  it('ChAFTA — applies for CN→AU', () => {
    const rule = new AuChaftaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', destination: 'AU', additionalInputs: { chafta_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('NZ-China — applies for CN→NZ with nz_china_qualifying=true', () => {
    const rule = new NzNzChinaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', destination: 'NZ', additionalInputs: { nz_china_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('CUSMA — applies for US→CA and MX→CA', () => {
    const rule = new CaCusmaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', destination: 'CA', additionalInputs: { cusma_qualifying: true } }),
      ),
    ).toBe(true);
    expect(
      rule.isApplicable(
        ctx({ origin: 'MX', destination: 'CA', additionalInputs: { cusma_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('declaredInputs returns the right flag name per agreement', () => {
    const korus = new KrKorusQualifyingRule();
    expect(korus.declaredInputs()[0].name).toBe('korus_qualifying');
    const chafta = new AuChaftaQualifyingRule();
    expect(chafta.declaredInputs()[0].name).toBe('chafta_qualifying');
    const cusma = new CaCusmaQualifyingRule();
    expect(cusma.declaredInputs()[0].name).toBe('cusma_qualifying');
  });
});
