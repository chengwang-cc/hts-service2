/**
 * Numeric-input type guards for additionalInputs (A1 follow-up from the
 * 2026-05-27 deep code review).
 *
 * Background. H1 widened `additionalInputs` to
 * `Record<string, number | string | boolean>`. Many rules then call
 * `Number(input ?? default)` without type-guarding the value:
 *   - `Number(true) === 1`  — boolean coerces to 1, masking "the user
 *     never set this"
 *   - `Number("1,000") === NaN` — formatted strings produce NaN
 *
 * Either way the downstream formula evaluates against a number the user
 * didn't intend. This module provides one explicit helper:
 *
 *   - `parseNumericInput(value, opts)` — strict-by-default parser that
 *     rejects booleans and trims a few common string formats (commas,
 *     surrounding whitespace, trailing `%`). Returns the parsed number
 *     OR a `Issue` describing what went wrong, so the caller can emit
 *     a rule-level note rather than silently defaulting.
 */

export interface NumericInputOk {
  ok: true;
  value: number;
}

export interface NumericInputIssue {
  ok: false;
  reason:
    | 'missing'
    | 'boolean-rejected'
    | 'not-a-number'
    | 'out-of-range';
  raw: unknown;
}

export type NumericInputResult = NumericInputOk | NumericInputIssue;

export interface ParseOpts {
  /** Min allowed value (inclusive). */
  min?: number;
  /** Max allowed value (inclusive). */
  max?: number;
  /** Returned when the input is `undefined` or `null`. If left
   *  unspecified, `parseNumericInput` returns `{ok:false, reason:'missing'}`. */
  defaultIfMissing?: number;
  /**
   * Accept booleans? Defaults to `false`. Excise rules in particular
   * never want this — a `true` boolean from the FE is a bug, not a 1.
   */
  allowBoolean?: boolean;
}

/**
 * Strict numeric parser for additionalInputs values. Trims surrounding
 * whitespace, strips internal commas, and tolerates a trailing `%`.
 */
export function parseNumericInput(
  value: unknown,
  opts: ParseOpts = {},
): NumericInputResult {
  if (value === undefined || value === null) {
    if (opts.defaultIfMissing !== undefined) {
      return { ok: true, value: opts.defaultIfMissing };
    }
    return { ok: false, reason: 'missing', raw: value };
  }
  if (typeof value === 'boolean') {
    if (opts.allowBoolean) {
      return { ok: true, value: value ? 1 : 0 };
    }
    return { ok: false, reason: 'boolean-rejected', raw: value };
  }
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const cleaned = value.trim().replace(/,/g, '').replace(/%$/, '');
    if (cleaned === '') {
      if (opts.defaultIfMissing !== undefined) {
        return { ok: true, value: opts.defaultIfMissing };
      }
      return { ok: false, reason: 'missing', raw: value };
    }
    n = Number(cleaned);
  } else {
    return { ok: false, reason: 'not-a-number', raw: value };
  }
  if (!Number.isFinite(n)) {
    return { ok: false, reason: 'not-a-number', raw: value };
  }
  if (opts.min !== undefined && n < opts.min) {
    return { ok: false, reason: 'out-of-range', raw: value };
  }
  if (opts.max !== undefined && n > opts.max) {
    return { ok: false, reason: 'out-of-range', raw: value };
  }
  return { ok: true, value: n };
}

/**
 * Convenience: parse + return a rule-friendly tuple `[value, note?]`.
 * When the input is missing AND no default is supplied, returns the
 * fallback value with a "missing" note so the rule can still produce a
 * result while flagging the issue to the user.
 */
export function parseNumericInputWithNote(
  inputName: string,
  value: unknown,
  opts: ParseOpts & { fallback?: number } = {},
): [number, string | null] {
  const result = parseNumericInput(value, opts);
  if (result.ok) return [result.value, null];
  const fallback = opts.fallback ?? 0;
  switch (result.reason) {
    case 'missing':
      return [
        fallback,
        `additionalInputs.${inputName} missing — defaulted to ${fallback}`,
      ];
    case 'boolean-rejected':
      return [
        fallback,
        `additionalInputs.${inputName} must be a number, got boolean ${JSON.stringify(result.raw)} — defaulted to ${fallback}`,
      ];
    case 'not-a-number':
      return [
        fallback,
        `additionalInputs.${inputName} is not numeric (${JSON.stringify(result.raw)}) — defaulted to ${fallback}`,
      ];
    case 'out-of-range':
      return [
        fallback,
        `additionalInputs.${inputName} out of range (${JSON.stringify(result.raw)}) — defaulted to ${fallback}`,
      ];
  }
}
