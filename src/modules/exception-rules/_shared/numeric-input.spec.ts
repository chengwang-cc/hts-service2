import {
  parseNumericInput,
  parseNumericInputWithNote,
} from './numeric-input';

describe('parseNumericInput (A1 type guards)', () => {
  it('accepts a finite number', () => {
    expect(parseNumericInput(5)).toEqual({ ok: true, value: 5 });
    expect(parseNumericInput(0)).toEqual({ ok: true, value: 0 });
    expect(parseNumericInput(-1.5, { min: -10 })).toEqual({ ok: true, value: -1.5 });
  });

  it('parses numeric strings + trims commas and trailing %', () => {
    expect(parseNumericInput('5')).toEqual({ ok: true, value: 5 });
    expect(parseNumericInput(' 1,000 ')).toEqual({ ok: true, value: 1000 });
    expect(parseNumericInput('45%')).toEqual({ ok: true, value: 45 });
    expect(parseNumericInput('2,500.50')).toEqual({ ok: true, value: 2500.5 });
  });

  it('rejects booleans by default', () => {
    const result = parseNumericInput(true);
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('boolean-rejected');
  });

  it('honors allowBoolean when explicitly set', () => {
    expect(parseNumericInput(true, { allowBoolean: true })).toEqual({ ok: true, value: 1 });
    expect(parseNumericInput(false, { allowBoolean: true })).toEqual({ ok: true, value: 0 });
  });

  it('returns missing when value is undefined/null with no default', () => {
    expect(parseNumericInput(undefined).ok).toBe(false);
    expect(parseNumericInput(null).ok).toBe(false);
  });

  it('returns the default when missing', () => {
    expect(parseNumericInput(undefined, { defaultIfMissing: 7 })).toEqual({ ok: true, value: 7 });
    expect(parseNumericInput('', { defaultIfMissing: 0 })).toEqual({ ok: true, value: 0 });
  });

  it('rejects non-numeric strings', () => {
    const result = parseNumericInput('fifty');
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('not-a-number');
  });

  it('rejects NaN-coerced inputs', () => {
    expect(parseNumericInput({} as any).ok).toBe(false);
    expect(parseNumericInput([1, 2] as any).ok).toBe(false);
  });

  it('honors min/max bounds', () => {
    expect(parseNumericInput(50, { min: 0, max: 100 }).ok).toBe(true);
    expect(parseNumericInput(101, { min: 0, max: 100 }).ok).toBe(false);
    expect(parseNumericInput(-1, { min: 0, max: 100 }).ok).toBe(false);
  });
});

describe('parseNumericInputWithNote', () => {
  it('returns [value, null] on success', () => {
    expect(parseNumericInputWithNote('x', 5)).toEqual([5, null]);
  });

  it('returns [fallback, note] on missing', () => {
    const [v, note] = parseNumericInputWithNote('x', undefined, { fallback: 0 });
    expect(v).toBe(0);
    expect(note).toMatch(/x.*missing/);
  });

  it('returns [fallback, note] on boolean', () => {
    const [v, note] = parseNumericInputWithNote('x', true, { fallback: 0 });
    expect(v).toBe(0);
    expect(note).toMatch(/x.*boolean/);
  });

  it('returns [fallback, note] on garbage string', () => {
    const [v, note] = parseNumericInputWithNote('x', 'oops', { fallback: 0 });
    expect(v).toBe(0);
    expect(note).toMatch(/x.*not numeric/);
  });

  it('still surfaces defaults when defaultIfMissing is set', () => {
    const [v, note] = parseNumericInputWithNote('x', undefined, {
      defaultIfMissing: 42,
    });
    expect(v).toBe(42);
    expect(note).toBeNull();
  });
});
