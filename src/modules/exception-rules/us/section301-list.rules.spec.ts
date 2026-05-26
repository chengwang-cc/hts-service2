import { Section301ListLoader } from './helpers/section301-list-loader';
import { Section301List1Rule } from './section301-list1.rule';
import { Section301List2Rule } from './section301-list2.rule';
import { Section301List3Rule } from './section301-list3.rule';
import { Section301List4ARule } from './section301-list4a.rule';
import { Section301ExclusionsRule } from './section301-exclusions.rule';
import type { ExceptionRuleContext, TariffFormulaComponent } from '../types';

const LOADER = new Section301ListLoader();
const R1 = new Section301List1Rule(LOADER);
const R2 = new Section301List2Rule(LOADER);
const R3 = new Section301List3Rule(LOADER);
const R4A = new Section301List4ARule(LOADER);
const REXC = new Section301ExclusionsRule(LOADER);

function ctx(overrides: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8471.30.0100',
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

describe('Section 301 list rules', () => {
  it('List 1 applicable for known List-1 HTS from CN', () => {
    expect(R1.isApplicable(ctx({ htsCode: '8471.30.0100' }))).toBe(true);
  });

  it('List 1 not applicable for VN origin', () => {
    expect(R1.isApplicable(ctx({ htsCode: '8471.30.0100', origin: 'VN' }))).toBe(false);
  });

  it('List 1 not applicable for non-US destination', () => {
    expect(R1.isApplicable(ctx({ htsCode: '8471.30.0100', destination: 'CA' }))).toBe(false);
  });

  it('List 1 evaluates with 25% + 9903.88.01', () => {
    const decision = R1.evaluate(ctx({ htsCode: '8471.30.0100' }));
    expect(decision.add).toHaveLength(1);
    expect(decision.add![0].chapter99HtsCode).toBe('9903.88.01');
    expect(decision.add![0].formula).toBe('value * 0.25');
  });

  it('List 3 picks up 8302.49.6085 (CN) with 25% + 9903.88.03', () => {
    expect(R3.isApplicable(ctx({ htsCode: '8302.49.6085' }))).toBe(true);
    const decision = R3.evaluate(ctx({ htsCode: '8302.49.6085' }));
    expect(decision.add![0].chapter99HtsCode).toBe('9903.88.03');
  });

  it('List 4A applies 7.5% to apparel from CN', () => {
    expect(R4A.isApplicable(ctx({ htsCode: '6109.10.0004' }))).toBe(true);
    const decision = R4A.evaluate(ctx({ htsCode: '6109.10.0004' }));
    expect(decision.add![0].chapter99HtsCode).toBe('9903.88.15');
    expect(decision.add![0].formula).toBe('value * 0.075');
  });

  it('List 2 catches its scaffolded HTS', () => {
    expect(R2.isApplicable(ctx({ htsCode: '8536.20.0040' }))).toBe(true);
  });

  it('rule REMOVES any pre-existing §301 row to avoid double-count', () => {
    const existing: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: 'value * 0.25',
      requiredVariables: [],
      identifier: 'SEED_SECTION_301_CN_LIST1',
      programFamily: 'section_301',
      chapter99HtsCode: '9903.88.01',
      appliesWhen: { kind: 'always' },
      sourceCitation: { source: 'seed' },
      confidence: 1,
    };
    const decision = R1.evaluate(
      ctx({ htsCode: '8471.30.0100', pendingComponents: [existing] }),
    );
    expect(decision.removeKeys).toEqual([
      'section_301|9903.88.01|SEED_SECTION_301_CN_LIST1',
    ]);
  });
});

describe('Section301ExclusionsRule', () => {
  it('applicable when an exclusion exists at asOfDate', () => {
    expect(
      REXC.isApplicable(
        ctx({ htsCode: '8479.89.9499', asOfDate: new Date('2024-06-01') }),
      ),
    ).toBe(true);
  });

  it('not applicable when no exclusion in window', () => {
    expect(
      REXC.isApplicable(
        ctx({ htsCode: '8479.89.9499', asOfDate: new Date('2019-01-01') }),
      ),
    ).toBe(false);
  });

  it('emits a negating component when a §301 row is present', () => {
    const s301Row: TariffFormulaComponent = {
      componentType: 'chapter_99',
      formula: 'value * 0.25',
      requiredVariables: [],
      identifier: 'S301_LIST1_99038801',
      programFamily: 'section_301',
      chapter99HtsCode: '9903.88.01',
      appliesWhen: { kind: 'always' },
      sourceCitation: { source: 'rule' },
      confidence: 1,
    };
    const decision = REXC.evaluate(
      ctx({
        htsCode: '8479.89.9499',
        asOfDate: new Date('2024-06-01'),
        pendingComponents: [s301Row],
      }),
    );
    expect(decision.add).toHaveLength(1);
    expect(decision.add![0].formula).toBe('-(value * 0.25)');
    expect(decision.add![0].programFamily).toBe('exclusion');
  });

  it('emits nothing when no §301 row is present', () => {
    const decision = REXC.evaluate(
      ctx({ htsCode: '8479.89.9499', asOfDate: new Date('2024-06-01') }),
    );
    expect(decision.add).toBeUndefined();
  });
});
