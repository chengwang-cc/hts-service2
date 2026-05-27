/**
 * Componentized tariff types used by TariffFormulaResolver,
 * TariffRateBatchService, and CalculationService.
 *
 * The shape mirrors what ai-service `/v2/tariff/formulas` and `/v2/tariff/rates`
 * returned so existing UI clients can be cut over with minimal changes.
 */

import type { TariffConfidenceSummary } from './tariff-confidence.service';

export type TariffComponentType =
  | 'base'
  | 'special'
  | 'non_ntr'
  | 'chapter_98'
  | 'chapter_99'
  | 'section_301'
  | 'section_232'
  | 'section_122'
  | 'mpf'
  | 'hmf'
  | 'post_tax';

/**
 * Calculator-runtime classification of a component's policy family.
 *
 * `componentType` describes the calculation stage (base/special/extra/post).
 * `programFamily` is the independent legal/policy axis the user sees in the
 * UI — Section 301 vs Section 232 vs IEEPA reciprocal vs quota vs MTB, etc.
 *
 * Unknown extras land in `other_chapter_99` rather than silently being
 * collapsed into `section_301`.
 */
export type ProgramFamily =
  | 'base'
  | 'special'
  | 'non_ntr'
  | 'chapter_98'
  | 'section_301'
  | 'section_232'
  | 'section_201'
  | 'section_421'
  | 'section_122'
  | 'ieepa'
  | 'reciprocal'
  | 'quota'
  | 'mtb'
  | 'temporary_duty_suspension'
  | 'replacement_duty'
  | 'exclusion'
  | 'mpf'
  | 'hmf'
  | 'tax'
  | 'other_chapter_99';

export interface FormulaVariable {
  name: string;
  type: string;
  unit?: string;
  dimension?: 'money' | 'weight' | 'quantity' | 'volume' | 'area' | 'length';
  description?: string;
  /**
   * Rich input metadata for variables surfaced by exception rules (Phase 2).
   * Optional + backward-compatible: existing resolver-emitted variables omit
   * these fields.
   */
  required?: boolean;
  label?: string;
  helpRef?: string;
  allowedValues?: string[] | string;
  /** Origin marker: 'resolver' (default) or 'exception_rule'. */
  origin?: 'resolver' | 'exception_rule';
  /** When `origin === 'exception_rule'`, the rule id that declared this input. */
  ruleId?: string;
  /**
   * 2026-05-27: pre-fill value the FE should seed when first rendering
   * the form. Used to default FTA-qualifying flags (USMCA, CUSMA,
   * KORUS, CPTPP, RCEP, etc.) to true when the user's origin is in
   * the agreement's partner set. User can override.
   */
  defaultValue?: boolean | number | string;
}

export interface SourceCitationRef {
  /** Free-text source label (e.g. "USITC HTS 2026 Rev 8") */
  source: string;
  /** Optional URL pointing to the source */
  url?: string;
  /** The row identifier in the source (HTS number, footnote id, ch99 row, etc.) */
  rowIdentifier?: string;
  /** Effective date for this citation */
  effectiveDate?: string;
  /** Confidence 0..1 produced by the parser / resolver */
  confidence?: number;
  /** Parser method (deterministic | knowledgebase | ai | manual) */
  parserMethod?: string;
}

export type TariffApplyCondition =
  | { kind: 'always' }
  | { kind: 'country_in'; countries: string[] }
  | { kind: 'country_not_in'; countries: string[] }
  | { kind: 'requires_chapter99_selection'; heading: string }
  | { kind: 'requires_certificate'; agreement: string };

export interface TariffFormulaComponent {
  componentType: TariffComponentType;
  /** mathjs-compatible expression */
  formula: string;
  /** Canonical expression used for semantic comparisons */
  formulaCanonical?: string;
  /** Parser/compiler AST for audit and semantic comparisons */
  formulaAst?: Record<string, any>;
  /** Stable hash derived from canonical formula + variable set */
  formulaSemanticHash?: string;
  /** Source variable dimensions keyed by variable name */
  unitDimensions?: Record<string, string>;
  /** Canonical source phrasing if available */
  rateText?: string;
  /** Variables the formula needs to evaluate (allowlist for scope) */
  requiredVariables: FormulaVariable[];
  /** Amount-level constraints such as MPF min/max and rounding policy */
  constraints?: {
    minAmount?: number | null;
    maxAmount?: number | null;
    rounding?: 'component_2dp' | 'defer';
  };
  /** Human-readable identifier (e.g. tax code, htsNumber) */
  identifier?: string;
  /**
   * Chapter 99 HTS code (e.g. "9903.88.15") this component reports under,
   * when applicable. Populated for Section 301/232/IEEPA/etc. components as
   * well as direct chapter_99 components — not only `componentType === 'chapter_99'`.
   */
  chapter99HtsCode?: string | null;
  /**
   * Policy/legal family on which this component is based. Independent of
   * `componentType` (which is the calc stage). Defaults to mirror componentType
   * when no richer classification is available; unknown chapter-99 derivatives
   * land in `other_chapter_99` instead of being collapsed to `section_301`.
   */
  programFamily?: ProgramFamily;
  /** Free-text legal authority for the program family (Section 301, IEEPA EO 14257, etc.) */
  programAuthority?: string;
  /** Free-text legal reference / Federal Register citation */
  legalReference?: string;
  /** Human-readable description for UIs */
  description?: string;
  /** When this component is allowed to apply at calc time */
  appliesWhen: TariffApplyCondition;
  /** Raw typed condition payload until persisted condition_ast lands */
  conditions?: Record<string, any> | null;
  /** Source citation */
  sourceCitation: SourceCitationRef;
  /** Confidence 0..1 */
  confidence: number;
}

export interface ResolveFormulaInput {
  htsNumber: string;
  countryOfOrigin: string;
  /**
   * REQUIRED. During P0 the only supported value is 'US'.
   * Reserved for jurisdiction-aware calculation in P1+.
   */
  destinationCountry?: string;
  entryDate?: string;
  htsVersion?: string;
  /** Trade agreement claim (e.g. USMCA, KORUS, GSP) */
  certificate?: { agreement: string; claimed: boolean };
  /**
   * User-selected Chapter 99 heading(s). The resolver uses these to decide
   * which chapter_99 components apply.
   */
  selectedChapter99Headings?: string[];
}

export interface ResolveFormulaResult {
  htsNumber: string;
  /** Normalized full HTS code at the depth used by the lookup */
  effectiveHtsCode?: string;
  /** All componentized formulas relevant to this code/country/date */
  components: TariffFormulaComponent[];
  /** Aggregated set of variables that any component needs */
  allRequiredVariables: FormulaVariable[];
  /** Headings selected by policy logic rather than caller input */
  systemSelectedChapter99Headings?: string[];
  /** Resolver-level warnings (missing data, fallback used, etc.) */
  warnings: string[];
  /** Citations distinct from components (e.g. version snapshot) */
  citations: SourceCitationRef[];
  /** True when ai-service-style block should be reported (e.g. no rate) */
  blocked: boolean;
  blockReason?: string | null;
  /** Resolver-level message for the UI */
  message: string;
}

export interface FormulaEvaluationVariables {
  value?: number;
  weight?: number;
  quantity?: number;
  duty?: number;
  total?: number;
  /** Additional, type-coerced inputs allowlisted by the formula's variables */
  additionalInputs?: Record<string, number>;
}

export interface BatchRateRequest {
  htsCode: string;
  country: string;
  /**
   * 2026-05-27: optional destination override. When omitted the
   * formula service defaults to 'US' for back-compat (the legacy
   * call sites never set this). Set explicitly so rule-declared
   * inputs (CUSMA flag for CA, KORUS for KR, CPTPP for AU/NZ/...
   * etc.) surface on the FE form for non-US destinations too.
   */
  destination?: string;
  inputs?: Record<string, number>;
  entryDate?: string;
  htsVersion?: string;
  certificate?: { agreement: string; claimed: boolean };
  selectedChapter99Headings?: string[];
}

export interface BatchFormulaLineResult {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string | null;
  blocked: boolean;
  blockReason: string | null;
  message: string;
  systemSelectedChapter99Headings?: string[];
  formulas: Array<{
    componentType: TariffComponentType;
    tariffType: string;
    tariffTypeDescription: string;
    formula: string;
    formulaVariables: FormulaVariable[];
    chapter99HtsCode?: string | null;
    /** Policy family (Section 301, IEEPA, MPF, etc.). */
    programFamily?: ProgramFamily;
    /** Free-text legal authority for the program family. */
    programAuthority?: string;
    /** Free-text legal reference / Federal Register citation. */
    legalReference?: string;
    /** Source phrasing for the rate (e.g. "16.5%"). */
    rateText?: string;
    /** Canonical formula used for semantic comparison. */
    formulaCanonical?: string;
    /** Stable hash derived from canonical formula + variable set. */
    formulaSemanticHash?: string;
    /** Stage gate (calculation order). */
    appliesWhen?: TariffApplyCondition;
    /** Raw condition AST/JSON for audit. */
    conditions?: Record<string, any> | null;
    /** Amount-level constraints (MPF min/max, rounding). */
    constraints?: TariffFormulaComponent['constraints'];
    /** Underlying source citation for the rate row. */
    sourceCitation?: SourceCitationRef;
    /** Human identifier (taxCode / row id). */
    identifier?: string;
    confidence: number;
  }>;
  /**
   * P2.T5 — additional inputs declared by applicable exception rules at
   * the requested (htsCode, country, destination). Surfaced to the form
   * so users can supply rule-required data (e.g. aluminum smelt/cast
   * countries) before submitting a quote. Empty array when no rule is
   * applicable.
   */
  additionalInputs?: FormulaVariable[];
}

export interface BatchRateLineResult {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string;
  blocked: boolean;
  blockReason: string | null;
  message: string;
  systemSelectedChapter99Headings?: string[];
  /** Top-level customs duty total, excluding separately reported fees/taxes. */
  totalDuty: number;
  /** MPF/HMF/declaration-style fees evaluated after duty. */
  fees?: number;
  /** True taxes evaluated after duty/fees. */
  taxes?: number;
  /** Structured totals; preferred shape for new clients. */
  totals?: {
    duty: number;
    fees: number;
    taxes: number;
    payable: number;
  };
  /** Backward-compatible flat confidence score derived from cards/evidence. */
  confidence?: number;
  /** Preferred numeric confidence score for clients adopting object confidence. */
  confidenceScore?: number;
  /** Explainable confidence detail for reviewers and dashboards. */
  confidenceDetails?: TariffConfidenceSummary;
  /** Per-component breakdown with evaluated amounts */
  breakdown: Array<{
    componentType: TariffComponentType;
    tariffType: string;
    tariffTypeDescription: string;
    amount: number;
    formula: string;
    formulaVariables: FormulaVariable[];
    chapter99HtsCode?: string | null;
    /** Policy family (Section 301, IEEPA, MPF, etc.). */
    programFamily?: ProgramFamily;
    /** Free-text legal authority for the program family. */
    programAuthority?: string;
    /** Free-text legal reference / Federal Register citation. */
    legalReference?: string;
    /** Source phrasing for the rate (e.g. "16.5%"). */
    rateText?: string;
    /** Canonical formula used for semantic comparison. */
    formulaCanonical?: string;
    /** Stable hash derived from canonical formula + variable set. */
    formulaSemanticHash?: string;
    /** Stage gate (when this component applies). */
    appliesWhen?: TariffApplyCondition;
    /** Raw condition AST/JSON for audit. */
    conditions?: Record<string, any> | null;
    /** Amount-level constraints (MPF min/max, rounding). */
    constraints?: TariffFormulaComponent['constraints'];
    /** Underlying source citation for the rate row. */
    sourceCitation?: SourceCitationRef;
    /** Human identifier (taxCode / row id). */
    identifier?: string;
    /** Component confidence 0..1. */
    confidence?: number;
    error: string | null;
  }>;
  /** De-duplicated list of source citations across all components. */
  sources?: SourceCitationRef[];
}
