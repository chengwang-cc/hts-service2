import { SteelScopeService } from './helpers/steel-scope.service';
import { Section232SteelRussiaRule } from './section232-steel-russia.rule';
import type { ExceptionRuleContext } from '../types';

const SCOPE = new SteelScopeService();
const RULE = new Section232SteelRussiaRule(SCOPE);

function ctx(overrides: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '7326.20.0020',
    origin: 'CN',
    destination: 'US',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 1000,
    currency: 'USD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...overrides,
  };
}

describe('Section232SteelRussiaRule', () => {
  it('applies when melt is RU', () => {
    expect(
      RULE.isApplicable(
        ctx({ additionalInputs: { steel_melt_country: 'RU', steel_pour_country: 'CN' } }),
      ),
    ).toBe(true);
  });

  it('applies when pour is RU', () => {
    expect(
      RULE.isApplicable(
        ctx({ additionalInputs: { steel_melt_country: 'CN', steel_pour_country: 'RU' } }),
      ),
    ).toBe(true);
  });

  it('does not apply when no RU touch', () => {
    expect(
      RULE.isApplicable(
        ctx({ additionalInputs: { steel_melt_country: 'CN', steel_pour_country: 'CN' } }),
      ),
    ).toBe(false);
  });

  it('emits 200% Chapter 99 9903.80.03', () => {
    const decision = RULE.evaluate(
      ctx({ additionalInputs: { steel_melt_country: 'RU', steel_pour_country: 'CN' } }),
    );
    expect(decision.add![0].chapter99HtsCode).toBe('9903.80.03');
    expect(decision.add![0].formula).toBe('steel_value * 2.00');
  });

  it('conflictsWith standard melt/pour rule', () => {
    expect(RULE.conflictsWith).toEqual(['us.section232.steel-melt-pour']);
  });
});
