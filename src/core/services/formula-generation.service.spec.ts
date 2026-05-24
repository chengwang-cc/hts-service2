import { FormulaGenerationService } from './formula-generation.service';

class StubOpenAiService {
  response() {
    throw new Error('AI should not be called in deterministic parser tests');
  }
}

describe('FormulaGenerationService deterministic construction', () => {
  let service: FormulaGenerationService;

  beforeEach(() => {
    service = new FormulaGenerationService(new StubOpenAiService() as any);
  });

  it('keeps dozen-specific duties dimensioned instead of using generic quantity', () => {
    const result = service.generateFormulaByPattern('2.8 cents/doz.');

    expect(result).toEqual({
      formula: 'quantity_dozen * 0.028',
      variables: ['quantity_dozen'],
      confidence: 0.9,
    });
  });

  it('keeps pair-specific duties dimensioned', () => {
    const result = service.generateFormulaByPattern('90 cents/pr.');

    expect(result).toEqual({
      formula: 'quantity_pair * 0.9',
      variables: ['quantity_pair'],
      confidence: 0.9,
    });
  });

  it('keeps volume-specific duties dimensioned', () => {
    const result = service.generateFormulaByPattern('$1.50/liter');

    expect(result).toEqual({
      formula: 'volume_liter * 1.5',
      variables: ['volume_liter'],
      confidence: 0.9,
    });
  });

  it('rejects implicit numeric denominators without a source unit', () => {
    const result = service.generateFormulaByPattern('89.6 cents/1000');

    expect(result).toBeNull();
  });

  it('maps implicit numeric denominators only when the source unit is known', () => {
    const result = service.generateFormulaByPattern(
      '89.6 cents/1000',
      'dozen',
    );

    expect(result).toEqual({
      formula: 'quantity_dozen * 0.000896',
      variables: ['quantity_dozen'],
      confidence: 0.9,
    });
  });

  it('rejects unknown specific-duty units instead of falling back to quantity', () => {
    const result = service.generateFormulaByPattern('$1.00/mysteryunit');

    expect(result).toBeNull();
  });
});
