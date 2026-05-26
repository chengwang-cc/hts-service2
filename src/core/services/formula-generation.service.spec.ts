import { FormulaGenerationService } from './formula-generation.service';
import { FORMULA_PARSER_FIXTURES } from './formula-parser.fixtures';

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
    const result = service.generateFormulaByPattern('89.6 cents/1000', 'dozen');

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

  it('blocks manual-review rates from batch AI fallback', async () => {
    await expect(
      service.generateFormulaBatch([
        { rateText: '5%' },
        { rateText: 'See note 2 to this chapter' },
      ]),
    ).rejects.toThrow(/requires manual review/i);
  });

  it.each(FORMULA_PARSER_FIXTURES)(
    'matches parser fixture: $name',
    (fixture) => {
      const result = service.generateFormulaByPattern(
        fixture.rateText,
        fixture.unitOfQuantity,
      );

      expect(result).toEqual(fixture.expected);
    },
  );

  it.each([
    [' 2.8  cents / doz. ', 'quantity_dozen * 0.028'],
    ['90 CENTS/PR.', 'quantity_pair * 0.9'],
    ['$ 1.50 / liter', 'volume_liter * 1.5'],
    ['$1.00 / proof liter', 'proof_liter * 1'],
    ['10.5¢/bbl', 'volume_barrel * 0.105'],
    ['$1.13/m3', 'volume_m3 * 1.13'],
    ['39.7¢/t', 'weight_ton * 0.397'],
    ['$1.32/t, including weight of container', 'weight_ton * 1.32'],
    ['68¢/head', 'quantity_each * 0.68'],
    ['33 1/3%', 'value * 0.333333333333'],
  ])('keeps parser mutation stable for %s', (rateText, expectedFormula) => {
    const result = service.generateFormulaByPattern(rateText);

    expect(result?.formula).toBe(expectedFormula);
  });

  it('parses compound liter and proof-liter alcohol rates', () => {
    const result = service.generateFormulaByPattern(
      '4.4¢/liter + 31.4¢/pf. liter',
    );

    expect(result).toEqual({
      formula: 'volume_liter * 0.044 + proof_liter * 0.314',
      variables: ['volume_liter', 'proof_liter'],
      confidence: 0.9,
    });
  });

  it('parses compound fractional ad valorem rates', () => {
    const result = service.generateFormulaByPattern('33 1/3% + 10¢/kg');

    expect(result).toEqual({
      formula: 'value * 0.333333333333 + weight * 0.1',
      variables: ['value', 'weight'],
      confidence: 0.9,
    });
  });
});
