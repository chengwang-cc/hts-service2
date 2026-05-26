import { KrSpecialExciseTaxRule } from './special-excise-tax.rule';
import { KrEducationTaxRule } from './education-tax.rule';
import type { ExceptionRuleContext, TariffFormulaComponent } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8703.23.0000',
    origin: 'JP',
    destination: 'KR',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 50_000_000,
    currency: 'KRW',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('KrSpecialExciseTaxRule', () => {
  const rule = new KrSpecialExciseTaxRule();

  it('applies to passenger vehicle (HS 87.03)', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('emits 5% for cars', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].formula).toBe('value * 0.05');
    expect(d.add![0].identifier).toBe('KR_ICTAX_CARS');
  });

  it('emits 20% for jewelry (HS 71.13)', () => {
    const d = rule.evaluate(ctx({ htsCode: '7113.19.0000' }));
    expect(d.add![0].formula).toBe('value * 0.2');
  });

  it('not applicable for apparel', () => {
    expect(rule.isApplicable(ctx({ htsCode: '6109.10.0000' }))).toBe(false);
  });
});

describe('KrEducationTaxRule', () => {
  const rule = new KrEducationTaxRule();

  function specialExciseComponent(): TariffFormulaComponent {
    return {
      componentType: 'post_tax',
      formula: 'value * 0.05',
      requiredVariables: [{ name: 'value', type: 'number' }],
      identifier: 'KR_ICTAX_CARS',
      programFamily: 'tax',
      appliesWhen: { kind: 'always' },
      sourceCitation: { source: 'KR NTS' },
      confidence: 1,
    };
  }

  it('not applicable when no special excise has fired', () => {
    expect(rule.isApplicable(ctx())).toBe(false);
  });

  it('applicable when a special excise component is pending', () => {
    expect(
      rule.isApplicable(
        ctx({ pendingComponents: [specialExciseComponent()] }),
      ),
    ).toBe(true);
  });

  it('emits 30% derivative of the special-excise formula', () => {
    const d = rule.evaluate(
      ctx({ pendingComponents: [specialExciseComponent()] }),
    );
    expect(d.add).toHaveLength(1);
    expect(d.add![0].formula).toBe('(value * 0.05) * 0.30');
    expect(d.add![0].identifier).toBe('KR_EDUCATION_TAX_KR_ICTAX_CARS');
  });
});
