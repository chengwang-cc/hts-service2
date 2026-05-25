import { FormulaSemanticsService } from './formula-semantics.service';
import { validateFormulaArtifacts } from './formula-artifact-validator.service';

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

  it('recognizes HTS-specific deterministic unit variables', () => {
    const result = service.analyze(
      'volume_barrel * 0.105 + volume_m3 * 1.13 + weight_ton * 0.397',
    );

    expect(result.validationErrors).toEqual([]);
    expect(
      service.variablesToDimensions([
        { name: 'volume_barrel', type: 'number' },
        { name: 'volume_m3', type: 'number' },
        { name: 'weight_ton', type: 'number' },
      ]),
    ).toEqual({
      volume_barrel: 'volume',
      volume_m3: 'volume',
      weight_ton: 'weight',
    });
  });

  it('returns validation errors instead of throwing for malformed formulas', () => {
    const result = service.analyze('value *', [
      { name: 'value', type: 'number', dimension: 'money' },
    ]);

    expect(result.formulaAst).toEqual({ kind: 'raw', expression: 'value *' });
    expect(result.canonicalFormula).toBe('value*');
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it('rejects raw AST artifacts before they can become authoritative', () => {
    const result = service.analyze('value *', [
      { name: 'value', type: 'number', dimension: 'money' },
    ]);

    const validation = validateFormulaArtifacts(
      {
        formulaText: 'value *',
        formulaAst: result.formulaAst,
        conditionAst: { kind: 'always' },
        unitDimensions: { value: 'money' },
        constraints: {},
        roundingPolicy: { mode: 'component_2dp' },
      },
      { requireRuntimeArtifacts: true },
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'formulaAst: raw formula AST is not authoritative',
    );
  });

  it.each([
    ['value * 0.05 + weight * 0.1 + quantity_dozen * 0.25'],
    ['quantity_dozen * 0.25 + value * 0.05 + weight * 0.1'],
    ['weight * 0.1 + quantity_dozen * 0.25 + value * 0.05'],
  ])('keeps additive semantic equivalence stable for %s', (formula) => {
    const baseline = service.normalizeForSemanticComparison(
      'value * 0.05 + weight * 0.1 + quantity_dozen * 0.25',
    );

    expect(service.normalizeForSemanticComparison(formula)).toBe(baseline);
  });
});
