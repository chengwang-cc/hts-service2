import { FormulaSemanticsService } from './formula-semantics.service';

describe('FormulaSemanticsService', () => {
  let service: FormulaSemanticsService;

  beforeEach(() => {
    service = new FormulaSemanticsService();
  });

  it('normalizes commutative additive formulas to the same canonical form', () => {
    const left = service.normalizeForSemanticComparison(
      'value * 0.05 + weight * 0.1',
    );
    const right = service.normalizeForSemanticComparison(
      'weight * 0.1 + value * 0.05',
    );

    expect(left).toBe(right);
  });

  it('reports undeclared variables in semantic analysis', () => {
    const result = service.analyze('steel_value * 0.25', [
      { name: 'value', type: 'number', dimension: 'money' },
    ]);

    expect(result.validationErrors).toContain(
      'Undeclared variable: steel_value',
    );
  });

  it('returns validation errors instead of throwing for malformed formulas', () => {
    const result = service.analyze('value *', [
      { name: 'value', type: 'number', dimension: 'money' },
    ]);

    expect(result.formulaAst).toEqual({ kind: 'raw', expression: 'value *' });
    expect(result.canonicalFormula).toBe('value*');
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });
});
