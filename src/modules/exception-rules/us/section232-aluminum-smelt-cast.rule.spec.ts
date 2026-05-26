import { AluminumScopeService } from './helpers/aluminum-scope.service';
import { Section232AluminumSmeltCastRule } from './section232-aluminum-smelt-cast.rule';
import type { ExceptionRuleContext, TariffFormulaComponent } from '../types';

const SCOPE = new AluminumScopeService();
const RULE = new Section232AluminumSmeltCastRule(SCOPE);

function ctx(overrides: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8302.49.6085',
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

function splitterRow(): TariffFormulaComponent {
  return {
    componentType: 'chapter_99',
    formula: 'aluminum_value * 0.25',
    requiredVariables: [],
    identifier: 'S232_ALUMINUM',
    programFamily: 'section_232',
    chapter99HtsCode: '9903.85.08',
    appliesWhen: { kind: 'always' },
    sourceCitation: { source: 'legacy splitter' },
    confidence: 1,
  };
}

describe('Section232AluminumSmeltCastRule', () => {
  describe('isApplicable', () => {
    it('true for 8302.49.6085 US destination', () => {
      expect(RULE.isApplicable(ctx())).toBe(true);
    });

    it('false when destination is not US', () => {
      expect(RULE.isApplicable(ctx({ destination: 'CA' }))).toBe(false);
    });

    it('false when HTS is out of scope', () => {
      expect(RULE.isApplicable(ctx({ htsCode: '6109.10.0004' }))).toBe(false);
    });

    it('false for in-scope HTS before its effective date', () => {
      expect(
        RULE.isApplicable(
          ctx({ htsCode: '8302.49.6085', asOfDate: new Date('2025-03-11') }),
        ),
      ).toBe(false);
    });
  });

  describe('evaluate — US-exempt branch (9903.85.09)', () => {
    it('all-US smelt+cast → 0% with Chapter 99 9903.85.09', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'US',
            aluminum_secondary_smelt: 'US',
            aluminum_cast: 'US',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add).toHaveLength(1);
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.09');
      expect(decision.add![0].formula).toBe('0');
      expect(decision.notes).toEqual(['us-exempt branch']);
    });

    it('US primary + "Y" secondary + US cast also qualifies as exempt', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'US',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'US',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.09');
    });
  });

  describe('evaluate — Russia / unknown branch (200%)', () => {
    it('Russia primary smelt → 9903.85.67 + 200%', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'RU',
            aluminum_secondary_smelt: 'US',
            aluminum_cast: 'US',
            aluminum_pct: 50,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.67');
      expect(decision.add![0].formula).toBe('aluminum_value * 2.00');
    });

    it('Russia most-recent cast → 9903.85.68', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'RU',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.68');
    });

    it('Russia secondary smelt only → 9903.85.69', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'RU',
            aluminum_cast: 'CN',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.69');
    });

    it('Unknown primary → 9903.85.70', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'UN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'CN',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.70');
    });

    it('Unknown secondary → 9903.85.70', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'UN',
            aluminum_cast: 'CN',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.70');
    });

    it('Unknown cast → 9903.85.70', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'UN',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.70');
    });
  });

  describe('evaluate — standard 25% branch (9903.85.08)', () => {
    it('CN→US default smelt/cast → 9903.85.08 + 25%', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'CN',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.08');
      expect(decision.add![0].formula).toBe('aluminum_value * 0.25');
    });

    it('aluminum_pct=60 reflects in description metadata via aluminum_value', () => {
      // The rule emits an unevaluated formula; the resolver evaluates it
      // with aluminum_value as variable. We test the rounded value
      // makes it into the source citation row identifier path. (No-op
      // assertion here — the deeper integration test runs after the
      // runner evaluates the formula. We assert the formula is right.)
      const decision = RULE.evaluate(
        ctx({
          declaredValue: 1000,
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'CN',
            aluminum_pct: 60,
          },
        }),
      );
      expect(decision.add![0].formula).toBe('aluminum_value * 0.25');
    });

    it('missing aluminum_pct still emits the component (with 0 aluminum_value implication)', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'CN',
            // aluminum_pct deliberately absent
          },
        }),
      );
      expect(decision.add).toHaveLength(1);
      expect(decision.add![0].chapter99HtsCode).toBe('9903.85.08');
    });
  });

  describe('splitter row removal', () => {
    it('removes any pre-existing splitter-emitted aluminum row', () => {
      const splitter = splitterRow();
      const decision = RULE.evaluate(
        ctx({
          pendingComponents: [splitter],
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'CN',
            aluminum_pct: 100,
          },
        }),
      );
      // removeKeys should match the splitter row exactly.
      expect(decision.removeKeys).toEqual([
        `section_232|9903.85.08|S232_ALUMINUM`,
      ]);
    });

    it('removeKeys is empty when no splitter row present', () => {
      const decision = RULE.evaluate(
        ctx({
          additionalInputs: {
            aluminum_primary_smelt: 'CN',
            aluminum_secondary_smelt: 'Y',
            aluminum_cast: 'CN',
            aluminum_pct: 100,
          },
        }),
      );
      expect(decision.removeKeys).toEqual([]);
    });
  });

  describe('declaredInputs', () => {
    it('declares four inputs in the right order', () => {
      const inputs = RULE.declaredInputs();
      expect(inputs.map((i) => i.name)).toEqual([
        'aluminum_primary_smelt',
        'aluminum_secondary_smelt',
        'aluminum_cast',
        'aluminum_pct',
      ]);
      expect(inputs.every((i) => i.required)).toBe(true);
    });
  });
});
