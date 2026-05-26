import { SteelScopeService } from './helpers/steel-scope.service';
import { Section232SteelMeltPourRule } from './section232-steel-melt-pour.rule';
import type { ExceptionRuleContext, TariffFormulaComponent } from '../types';

const SCOPE = new SteelScopeService();
const RULE = new Section232SteelMeltPourRule(SCOPE);

function ctx(overrides: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '7326.20.0020',
    origin: 'CN',
    destination: 'US',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 2000,
    currency: 'USD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...overrides,
  };
}

function splitterRow(): TariffFormulaComponent {
  return {
    componentType: 'chapter_99',
    formula: 'steel_value * 0.25',
    requiredVariables: [],
    identifier: 'S232_STEEL',
    programFamily: 'section_232',
    chapter99HtsCode: '9903.80.01',
    appliesWhen: { kind: 'always' },
    sourceCitation: { source: 'legacy splitter' },
    confidence: 1,
  };
}

describe('Section232SteelMeltPourRule', () => {
  it('applicable for in-scope steel HTS into US', () => {
    expect(RULE.isApplicable(ctx())).toBe(true);
  });

  it('not applicable for non-US destination', () => {
    expect(RULE.isApplicable(ctx({ destination: 'CA' }))).toBe(false);
  });

  it('not applicable for out-of-scope HTS', () => {
    expect(RULE.isApplicable(ctx({ htsCode: '6109.10.0004' }))).toBe(false);
  });

  it('emits standard 25% with Chapter 99 9903.80.01', () => {
    const decision = RULE.evaluate(
      ctx({
        additionalInputs: {
          steel_melt_country: 'CN',
          steel_pour_country: 'CN',
          steel_pct: 100,
        },
      }),
    );
    expect(decision.add).toHaveLength(1);
    expect(decision.add![0].chapter99HtsCode).toBe('9903.80.01');
    expect(decision.add![0].formula).toBe('steel_value * 0.25');
  });

  it('removes splitter steel row when present', () => {
    const splitter = splitterRow();
    const decision = RULE.evaluate(
      ctx({
        pendingComponents: [splitter],
        additionalInputs: {
          steel_melt_country: 'CN',
          steel_pour_country: 'CN',
          steel_pct: 100,
        },
      }),
    );
    expect(decision.removeKeys).toEqual(['section_232|9903.80.01|S232_STEEL']);
  });

  it('defers to steel-russia when melt is RU', () => {
    const decision = RULE.evaluate(
      ctx({
        additionalInputs: {
          steel_melt_country: 'RU',
          steel_pour_country: 'CN',
        },
      }),
    );
    expect(decision).toEqual({});
  });

  it('defers to steel-russia when pour is RU', () => {
    const decision = RULE.evaluate(
      ctx({
        additionalInputs: {
          steel_melt_country: 'CN',
          steel_pour_country: 'RU',
        },
      }),
    );
    expect(decision).toEqual({});
  });

  it('defers to KR-quota when origin/melt/pour all KR', () => {
    const decision = RULE.evaluate(
      ctx({
        origin: 'KR',
        additionalInputs: {
          steel_melt_country: 'KR',
          steel_pour_country: 'KR',
        },
      }),
    );
    expect(decision).toEqual({});
  });

  it('still fires for KR origin when KR isn\'t both melt+pour', () => {
    const decision = RULE.evaluate(
      ctx({
        origin: 'KR',
        additionalInputs: {
          steel_melt_country: 'KR',
          steel_pour_country: 'CN',
        },
      }),
    );
    expect(decision.add).toBeDefined();
    expect(decision.add![0].chapter99HtsCode).toBe('9903.80.01');
  });

  it('declares melt + pour + pct inputs', () => {
    const inputs = RULE.declaredInputs();
    expect(inputs.map((i) => i.name)).toEqual([
      'steel_melt_country',
      'steel_pour_country',
      'steel_pct',
    ]);
  });
});
