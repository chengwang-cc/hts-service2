/**
 * Componentized tariff types used by TariffFormulaResolver,
 * TariffRateBatchService, and CalculationService.
 *
 * The shape mirrors what ai-service `/v2/tariff/formulas` and `/v2/tariff/rates`
 * returned so existing UI clients can be cut over with minimal changes.
 */

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

export interface FormulaVariable {
  name: string;
  type: string;
  unit?: string;
  description?: string;
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
  /** Canonical source phrasing if available */
  rateText?: string;
  /** Variables the formula needs to evaluate (allowlist for scope) */
  requiredVariables: FormulaVariable[];
  /** Human-readable identifier (e.g. tax code, htsNumber) */
  identifier?: string;
  /** Human-readable description for UIs */
  description?: string;
  /** When this component is allowed to apply at calc time */
  appliesWhen: TariffApplyCondition;
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
  formulas: Array<{
    componentType: TariffComponentType;
    tariffType: string;
    tariffTypeDescription: string;
    formula: string;
    formulaVariables: FormulaVariable[];
    chapter99HtsCode?: string | null;
    confidence: number;
  }>;
}

export interface BatchRateLineResult {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string;
  blocked: boolean;
  blockReason: string | null;
  message: string;
  /** Top-level total duty = sum of all evaluated component amounts */
  totalDuty: number;
  /** Per-component breakdown with evaluated amounts */
  breakdown: Array<{
    componentType: TariffComponentType;
    tariffType: string;
    tariffTypeDescription: string;
    amount: number;
    formula: string;
    formulaVariables: FormulaVariable[];
    chapter99HtsCode?: string | null;
    error: string | null;
  }>;
}
