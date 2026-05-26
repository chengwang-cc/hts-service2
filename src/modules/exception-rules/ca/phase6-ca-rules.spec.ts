import { CaSurtaxCnEvRule } from './surtax-cn-ev.rule';
import { CaSurtaxCnSteelAluminumRule } from './surtax-cn-steel-aluminum.rule';
import { CaCountermeasureUs232Rule } from './countermeasure-us-232.rule';
import { CaCusmaQualifyingRule } from './cusma-qualifying.rule';
import type { ExceptionRuleContext, TariffFormulaComponent } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8703.80.0000',
    origin: 'CN',
    destination: 'CA',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 40_000,
    currency: 'CAD',
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
    formula: 'value * 0.06',
    requiredVariables: [],
    identifier: 'BASE_AD_VALOREM',
    programFamily: 'base',
    appliesWhen: { kind: 'always' },
    sourceCitation: { source: 'CA customs tariff column' },
    confidence: 1,
  };
}

describe('CaSurtaxCnEvRule', () => {
  const rule = new CaSurtaxCnEvRule();

  it('applies to CN-origin EV from 2024-10-01', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('not applicable before effective date', () => {
    expect(rule.isApplicable(ctx({ asOfDate: new Date('2024-09-30') }))).toBe(false);
  });

  it('not applicable for VN origin', () => {
    expect(rule.isApplicable(ctx({ origin: 'VN' }))).toBe(false);
  });

  it('not applicable for non-EV passenger vehicle', () => {
    expect(rule.isApplicable(ctx({ htsCode: '8703.23.0000' }))).toBe(false);
  });

  it('emits 100% surtax', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].formula).toBe('value * 1.00');
    expect(d.add![0].identifier).toBe('CA_SURTAX_CN_EV_100');
  });
});

describe('CaSurtaxCnSteelAluminumRule', () => {
  const rule = new CaSurtaxCnSteelAluminumRule();

  it('applies to CN-origin steel from 2024-10-22', () => {
    expect(rule.isApplicable(ctx({ htsCode: '7208.10.0000' }))).toBe(true);
  });

  it('applies to CN-origin aluminum (Ch 76)', () => {
    expect(rule.isApplicable(ctx({ htsCode: '7601.10.0000' }))).toBe(true);
  });

  it('emits 25% with aluminum identifier', () => {
    const d = rule.evaluate(ctx({ htsCode: '7601.10.0000' }));
    expect(d.add![0].formula).toBe('value * 0.25');
    expect(d.add![0].identifier).toBe('CA_SURTAX_CN_ALUMINUM_25');
  });

  it('not applicable for VN origin', () => {
    expect(rule.isApplicable(ctx({ htsCode: '7208.10.0000', origin: 'VN' }))).toBe(false);
  });
});

describe('CaCountermeasureUs232Rule', () => {
  const rule = new CaCountermeasureUs232Rule();

  it('applies to scoped US-origin steel from effective date', () => {
    expect(
      rule.isApplicable(ctx({ origin: 'US', htsCode: '7208.10.0000' })),
    ).toBe(true);
  });

  it('not applicable for CUSMA-qualifying US goods', () => {
    expect(
      rule.isApplicable(
        ctx({
          origin: 'US',
          htsCode: '7208.10.0000',
          additionalInputs: { cusma_qualifying: true },
        }),
      ),
    ).toBe(false);
  });

  it('emits configured rate from scope CSV', () => {
    const d = rule.evaluate(ctx({ origin: 'US', htsCode: '2208.30.0000' }));
    expect(d.add![0].formula).toBe('value * 0.25');
    expect(d.add![0].identifier).toContain('CA_COUNTERMEASURE_US_WHISKY');
  });

  it('emits no component for HS not in scope CSV', () => {
    const d = rule.evaluate(ctx({ origin: 'US', htsCode: '6109.10.0000' }));
    expect(d.add).toBeUndefined();
  });
});

describe('CaCusmaQualifyingRule', () => {
  const rule = new CaCusmaQualifyingRule();

  it('applies for US origin with cusma_qualifying flag', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', additionalInputs: { cusma_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('not applicable for non-USMCA origin', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', additionalInputs: { cusma_qualifying: true } }),
      ),
    ).toBe(false);
  });

  it('replaces base with 0', () => {
    const d = rule.evaluate(
      ctx({
        origin: 'US',
        pendingComponents: [baseRow()],
        additionalInputs: { cusma_qualifying: true },
      }),
    );
    expect(d.replace![0].with.formula).toBe('0');
  });
});
