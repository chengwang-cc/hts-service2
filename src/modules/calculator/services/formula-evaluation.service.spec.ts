import {
  FormulaEvaluationService,
  UndeclaredFormulaVariableError,
} from './formula-evaluation.service';

class StubFormulaGenerationService {
  validateFormula(formula: string) {
    if (/eval|function|require/i.test(formula)) {
      return { valid: false, error: 'forbidden', variables: [] };
    }
    return { valid: true, variables: [] };
  }
}

describe('FormulaEvaluationService', () => {
  let svc: FormulaEvaluationService;

  beforeEach(() => {
    svc = new FormulaEvaluationService(
      new StubFormulaGenerationService() as any,
    );
  });

  describe('legacy flat scope (backwards compatibility)', () => {
    it('evaluates value * rate', () => {
      const result = svc.evaluate('value * 0.05', {
        value: 100,
      });
      expect(result).toBe(5);
    });

    it('evaluates duty + value with running totals', () => {
      const result = svc.evaluate('total * 0.01', {
        value: 100,
        duty: 10,
        total: 110,
      });
      expect(result).toBe(1.1);
    });
  });

  describe('structured scope with additionalInputs', () => {
    it('merges declared additional inputs into scope', () => {
      // Section 232 steel: formula references `steel_value`.
      const result = svc.evaluate('steel_value * 0.25', {
        value: 1000,
        weight: 10,
        quantity: 1,
        additionalInputs: { steel_value: 200 },
        declaredVariables: ['steel_value'],
      });
      expect(result).toBe(50);
    });

    it('ignores undeclared additional inputs when not referenced by formula', () => {
      // Formula does NOT reference unrelated_field; passing it should not throw.
      const result = svc.evaluate('value * 0.1', {
        value: 100,
        additionalInputs: { unrelated_field: 999 },
        declaredVariables: ['steel_value'],
      });
      expect(result).toBe(10);
    });

    it('throws UndeclaredFormulaVariableError when formula references an undeclared variable', () => {
      // Formula references mystery_var which is in additionalInputs but
      // is NOT in declaredVariables.
      expect(() =>
        svc.evaluate('mystery_var * 0.25', {
          value: 0,
          additionalInputs: { mystery_var: 100 },
          declaredVariables: ['steel_value'],
        }),
      ).toThrow(UndeclaredFormulaVariableError);
    });

    it('accepts declaredVariables list including the additional input', () => {
      const result = svc.evaluate('aluminum_value * 0.1', {
        value: 0,
        additionalInputs: { aluminum_value: 500 },
        declaredVariables: ['aluminum_value'],
      });
      expect(result).toBe(50);
    });

    it('coerces string-numeric inputs', () => {
      const result = svc.evaluate('value * 0.07', {
        value: 200,
        additionalInputs: { steel_value: '100' as any },
        declaredVariables: ['steel_value'],
      });
      expect(result).toBe(14);
    });

    it('rejects forbidden keywords (eval)', () => {
      expect(() => svc.evaluate('eval(value)', { value: 100 })).toThrow();
    });

    it('applies min/max constraints without losing the unrounded amount', () => {
      const result = svc.evaluateWithConstraints(
        'value * 0.001',
        { value: 100 },
        { minAmount: 27.75, maxAmount: 579.23 },
      );

      expect(result).toEqual({ amount: 27.75, unroundedAmount: 27.75 });
    });
  });
});
