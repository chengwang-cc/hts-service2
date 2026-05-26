/**
 * Metal-tariff splitter.
 *
 * Section 232 steel/aluminum/copper duties for HS chapters 72-76 are
 * sometimes published as a single component with an additive formula:
 *
 *   (aluminum_value * 0.25) + (steel_value * 0.25)
 *
 * Showing that as one row in the calculator breakdown obscures the per-
 * metal contribution that a broker needs to see. This helper detects the
 * pattern and synthesizes one logical row per metal so the UI can render
 * each material's duty separately.
 *
 * The pattern hts-web2 used (the legacy U.S.-only calculator) is the
 * reference; we mirror it here so calculator-v2 doesn't regress on a
 * UX strength of the older surface.
 *
 * Out of scope: non-additive formulas, multiplicative combinations,
 * formulas that reference other variables alongside metals. Those fall
 * through unchanged.
 */

import type {
  FormulaVariable,
  TariffApplyCondition,
  TariffFormulaComponent,
  SourceCitationRef,
} from './tariff-types';

export type MetalKey = 'aluminum' | 'steel' | 'copper';

const METAL_VAR: Record<MetalKey, string> = {
  aluminum: 'aluminum_value',
  steel: 'steel_value',
  copper: 'copper_value',
};

const METAL_LABEL: Record<MetalKey, string> = {
  aluminum: 'Aluminum content',
  steel: 'Steel content',
  copper: 'Copper content',
};

/** Section 232 chapter prefixes that emit metal-bearing components. */
const METAL_CHAPTERS = new Set(['72', '73', '74', '75', '76']);

export interface SplitMetalRow {
  /** Which metal this row represents. */
  metal: MetalKey;
  /** The single-metal formula extracted from the additive original. */
  formula: string;
  /** The decimal rate (0.25 for 25%, etc.). */
  rate: number;
  /** Variable name to feed into evaluation (`aluminum_value`, etc.). */
  variableName: string;
}

export interface SplitMetalResult {
  /** True when the component split into ≥ 2 metal rows. */
  didSplit: boolean;
  /** The per-metal rows, if split. */
  rows: SplitMetalRow[];
}

/**
 * Inspect a formula text and, if it's an additive sum of single-metal
 * ad-valorem terms (e.g. `aluminum_value * 0.25 + steel_value * 0.25`),
 * return one row per metal. Whitespace and parentheses around each term
 * are tolerated.
 *
 * Returns `didSplit: false` for any other shape — non-additive formulas,
 * mixed metal+non-metal variables, specific rates, compound rates.
 */
export function splitMetalFormula(formulaText: string | undefined): SplitMetalResult {
  const out: SplitMetalResult = { didSplit: false, rows: [] };
  if (!formulaText) return out;

  // Strip outer whitespace and a single wrapping pair of parens.
  let trimmed = formulaText.trim();
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    // Only strip when the outer parens are balanced.
    const inner = trimmed.slice(1, -1).trim();
    if (isBalanced(inner)) trimmed = inner;
    else break;
  }

  // Split on top-level `+` only (avoid splitting inside parens).
  const terms = splitTopLevelPlus(trimmed);
  if (terms.length < 2) return out;

  const rows: SplitMetalRow[] = [];
  const seen = new Set<MetalKey>();
  for (const rawTerm of terms) {
    const term = stripParens(rawTerm).trim();
    const parsed = parseMetalTerm(term);
    if (!parsed) return out;
    if (seen.has(parsed.metal)) return out;
    seen.add(parsed.metal);
    rows.push(parsed);
  }

  if (rows.length < 2) return out;
  return { didSplit: true, rows };
}

/**
 * Build per-metal `TariffFormulaComponent`s from a parent component whose
 * formula was an additive sum of metal terms. Used by the resolver / batch
 * service to emit one display row per metal while preserving the parent
 * citation, identifier, and confidence.
 */
export function explodeMetalComponent(
  parent: TariffFormulaComponent,
): TariffFormulaComponent[] {
  const split = splitMetalFormula(parent.formula);
  if (!split.didSplit) return [parent];

  const baseCitation: SourceCitationRef = parent.sourceCitation;
  const applies: TariffApplyCondition = parent.appliesWhen;

  return split.rows.map((row) => {
    const requiredVariables: FormulaVariable[] = [
      {
        name: row.variableName,
        type: 'number',
        dimension: 'money',
        description: `${METAL_LABEL[row.metal]} value`,
      },
    ];
    return {
      ...parent,
      formula: row.formula,
      rateText: `${(row.rate * 100).toFixed(2)}% ${METAL_LABEL[row.metal]}`,
      identifier: parent.identifier
        ? `${parent.identifier}_${row.metal.toUpperCase()}`
        : `${row.metal.toUpperCase()}_AD_VALOREM`,
      description: parent.description
        ? `${parent.description} — ${METAL_LABEL[row.metal]}`
        : METAL_LABEL[row.metal],
      requiredVariables,
      sourceCitation: {
        ...baseCitation,
        rowIdentifier: baseCitation.rowIdentifier
          ? `${baseCitation.rowIdentifier}|${row.metal}`
          : row.metal,
      },
      appliesWhen: applies,
    };
  });
}

/**
 * Quick heuristic check: should the resolver attempt to split? True when
 * either (a) the HS chapter is one of the Section 232 metal chapters
 * (72-76), or (b) the formula references at least one metal variable.
 */
export function shouldAttemptMetalSplit(args: {
  htsNumber?: string;
  formula?: string;
}): boolean {
  const chapter = (args.htsNumber || '').replace(/\D/g, '').slice(0, 2);
  if (METAL_CHAPTERS.has(chapter)) return true;
  const formula = args.formula || '';
  return Object.values(METAL_VAR).some((v) => formula.includes(v));
}

// ── internals ────────────────────────────────────────────────────────────

/**
 * Parse a single term of the form `<metal_value> * <decimal>`, optionally
 * with surrounding whitespace and parens. Returns the row if matched, null
 * otherwise.
 */
function parseMetalTerm(term: string): SplitMetalRow | null {
  // Accept ` (aluminum_value * 0.25) `, ` aluminum_value*0.25 `, etc.
  // Also accept `0.25 * aluminum_value` (commutative).
  const cleaned = stripParens(term).replace(/\s+/g, '');
  for (const metal of Object.keys(METAL_VAR) as MetalKey[]) {
    const v = METAL_VAR[metal];
    const r1 = new RegExp(`^${v}\\*([0-9]*\\.?[0-9]+)$`);
    const r2 = new RegExp(`^([0-9]*\\.?[0-9]+)\\*${v}$`);
    const m = cleaned.match(r1) ?? cleaned.match(r2);
    if (m) {
      const rate = Number(m[1]);
      if (!Number.isFinite(rate)) return null;
      return {
        metal,
        formula: `${v} * ${rate}`,
        rate,
        variableName: v,
      };
    }
  }
  return null;
}

function stripParens(value: string): string {
  let s = value.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    const inner = s.slice(1, -1).trim();
    if (isBalanced(inner)) s = inner;
    else break;
  }
  return s;
}

function isBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function splitTopLevelPlus(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === '+' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}
