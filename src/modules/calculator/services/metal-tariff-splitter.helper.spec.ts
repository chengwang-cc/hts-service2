import {
  explodeMetalComponent,
  shouldAttemptMetalSplit,
  splitMetalFormula,
} from './metal-tariff-splitter.helper';

describe('splitMetalFormula', () => {
  it('splits an aluminum + steel additive formula into two rows', () => {
    const result = splitMetalFormula(
      '(aluminum_value * 0.25) + (steel_value * 0.25)',
    );
    expect(result.didSplit).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.metal).sort()).toEqual(['aluminum', 'steel']);
    expect(result.rows.every((r) => r.rate === 0.25)).toBe(true);
  });

  it('handles three-metal additive formulas', () => {
    const result = splitMetalFormula(
      'aluminum_value * 0.1 + steel_value * 0.25 + copper_value * 0.5',
    );
    expect(result.didSplit).toBe(true);
    expect(result.rows).toHaveLength(3);
    const rates = new Map(result.rows.map((r) => [r.metal, r.rate]));
    expect(rates.get('aluminum')).toBe(0.1);
    expect(rates.get('steel')).toBe(0.25);
    expect(rates.get('copper')).toBe(0.5);
  });

  it('handles commutative `0.25 * aluminum_value` form', () => {
    const result = splitMetalFormula(
      '0.25 * aluminum_value + 0.25 * steel_value',
    );
    expect(result.didSplit).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it('does NOT split a single-metal formula', () => {
    expect(splitMetalFormula('aluminum_value * 0.25').didSplit).toBe(false);
  });

  it('does NOT split a non-metal additive formula', () => {
    expect(
      splitMetalFormula('value * 0.05 + weight * 0.1').didSplit,
    ).toBe(false);
  });

  it('does NOT split when terms mix metal and non-metal variables', () => {
    expect(
      splitMetalFormula('aluminum_value * 0.25 + value * 0.05').didSplit,
    ).toBe(false);
  });

  it('does NOT split when the same metal appears twice (ambiguous)', () => {
    expect(
      splitMetalFormula('aluminum_value * 0.25 + aluminum_value * 0.1').didSplit,
    ).toBe(false);
  });

  it('returns didSplit=false for empty/undefined input', () => {
    expect(splitMetalFormula(undefined).didSplit).toBe(false);
    expect(splitMetalFormula('').didSplit).toBe(false);
    expect(splitMetalFormula('   ').didSplit).toBe(false);
  });

  it('handles whitespace variants', () => {
    const r = splitMetalFormula('aluminum_value*0.1+steel_value*0.25');
    expect(r.didSplit).toBe(true);
    expect(r.rows).toHaveLength(2);
  });
});

describe('explodeMetalComponent', () => {
  function baseComponent() {
    return {
      componentType: 'section_232' as const,
      formula: 'aluminum_value * 0.25 + steel_value * 0.25',
      identifier: 'SECTION_232_METAL',
      description: 'Section 232 metal duty',
      requiredVariables: [],
      appliesWhen: { kind: 'always' as const },
      sourceCitation: {
        source: 'CBP Section 232 derivative articles',
        url: 'https://www.cbp.gov/',
        confidence: 0.95,
        parserMethod: 'extra_tax_table',
        rowIdentifier: 'SECTION_232_METAL',
      },
      confidence: 0.95,
    };
  }

  it('produces one component per metal, each with its own identifier', () => {
    const components = explodeMetalComponent(baseComponent());
    expect(components).toHaveLength(2);
    expect(components.map((c) => c.identifier).sort()).toEqual([
      'SECTION_232_METAL_ALUMINUM',
      'SECTION_232_METAL_STEEL',
    ]);
    expect(components.every((c) => c.componentType === 'section_232')).toBe(true);
  });

  it('rewrites the formula per metal so evaluation only references that metal\'s variable', () => {
    const components = explodeMetalComponent(baseComponent());
    for (const c of components) {
      // Each exploded formula references exactly one metal variable.
      const refs = ['aluminum_value', 'steel_value', 'copper_value'].filter((v) =>
        c.formula.includes(v),
      );
      expect(refs).toHaveLength(1);
    }
  });

  it('preserves the source citation and appliesWhen on each split row', () => {
    const components = explodeMetalComponent(baseComponent());
    for (const c of components) {
      expect(c.sourceCitation.source).toBe('CBP Section 232 derivative articles');
      expect(c.appliesWhen.kind).toBe('always');
      // Each row gets a citation rowIdentifier that disambiguates by metal.
      expect(c.sourceCitation.rowIdentifier).toMatch(/(aluminum|steel|copper)$/);
    }
  });

  it('rewrites requiredVariables to the single metal-variable that row uses', () => {
    const components = explodeMetalComponent(baseComponent());
    for (const c of components) {
      expect(c.requiredVariables).toHaveLength(1);
      expect(['aluminum_value', 'steel_value', 'copper_value']).toContain(
        c.requiredVariables[0].name,
      );
    }
  });

  it('returns the original component unchanged when the formula is not splittable', () => {
    const parent = { ...baseComponent(), formula: 'value * 0.05' };
    const components = explodeMetalComponent(parent);
    expect(components).toEqual([parent]);
  });
});

describe('shouldAttemptMetalSplit', () => {
  it('returns true for HS chapter 76 (aluminum)', () => {
    expect(shouldAttemptMetalSplit({ htsNumber: '7616.99.51' })).toBe(true);
  });
  it('returns true for HS chapter 73 (iron/steel articles)', () => {
    expect(shouldAttemptMetalSplit({ htsNumber: '7326.20.00' })).toBe(true);
  });
  it('returns true for any formula referencing a metal variable', () => {
    expect(
      shouldAttemptMetalSplit({ htsNumber: '6109.10.00.04', formula: 'aluminum_value * 0.25' }),
    ).toBe(true);
  });
  it('returns false for an apparel HS with a non-metal formula', () => {
    expect(
      shouldAttemptMetalSplit({ htsNumber: '6109.10.00.04', formula: 'value * 0.165' }),
    ).toBe(false);
  });
});
