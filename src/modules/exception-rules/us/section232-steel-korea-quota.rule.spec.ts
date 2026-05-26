import { SteelScopeService } from './helpers/steel-scope.service';
import { Section232SteelKoreaQuotaRule } from './section232-steel-korea-quota.rule';
import type { ExceptionRuleContext } from '../types';

const SCOPE = new SteelScopeService();
const RULE = new Section232SteelKoreaQuotaRule(SCOPE);

function ctx(overrides: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '7326.20.0020',
    origin: 'KR',
    destination: 'US',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 1000,
    currency: 'USD',
    additionalInputs: {
      steel_melt_country: 'KR',
      steel_pour_country: 'KR',
    },
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...overrides,
  };
}

describe('Section232SteelKoreaQuotaRule', () => {
  it('applicable for KR origin with KR melt+pour, in-quota', () => {
    expect(RULE.isApplicable(ctx())).toBe(true);
  });

  it('not applicable when origin is not KR', () => {
    expect(RULE.isApplicable(ctx({ origin: 'CN' }))).toBe(false);
  });

  it('not applicable when melt is not KR', () => {
    expect(
      RULE.isApplicable(
        ctx({ additionalInputs: { steel_melt_country: 'CN', steel_pour_country: 'KR' } }),
      ),
    ).toBe(false);
  });

  it('not applicable when quota exhausted', () => {
    expect(
      RULE.isApplicable(
        ctx({
          additionalInputs: {
            steel_melt_country: 'KR',
            steel_pour_country: 'KR',
            steel_kr_quota_exhausted: true,
          },
        }),
      ),
    ).toBe(false);
  });

  it('emits 0% Chapter 99 9903.80.61 when in quota', () => {
    const decision = RULE.evaluate(ctx());
    expect(decision.add![0].chapter99HtsCode).toBe('9903.80.61');
    expect(decision.add![0].formula).toBe('0');
  });

  it('conflictsWith standard melt/pour rule', () => {
    expect(RULE.conflictsWith).toEqual(['us.section232.steel-melt-pour']);
  });
});
