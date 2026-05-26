import {
  FormulaVariable,
  ResolveFormulaResult,
  SourceCitationRef,
  TariffFormulaComponent,
} from '../../calculator/services/tariff-types';

/**
 * TariffJurisdictionAdapter
 *
 * Each destination jurisdiction implements this interface (US, GB, EU, HK, ...).
 * The adapter owns:
 *   - source ingestion for its tariff feed
 *   - classification (HS/HTS/CN/TARIC code lookup)
 *   - measure / formula resolution
 *   - per-line landed-cost calculation
 *   - source citations
 */

export interface DestinationContext {
  country: string;
  memberState?: string;
}

export interface IngestionJobContext {
  jobId: string;
  triggeredBy: string;
  importHistoryId?: string;
}

export interface IngestionResult {
  snapshotId: string;
  rowCount: number;
  rejectedCount: number;
  warnings: string[];
}

export interface ClassificationInput {
  description: string;
  name?: string;
  category?: string;
  materials?: Array<{ material: string; percent: number }>;
  imageUrl?: string;
  existingHsCode?: string;
  countryOfOrigin?: string;
}

export interface ClassificationCandidate {
  hs6: string;
  destinationCode: string;
  confidence: number;
  rationale?: string;
  rank: number;
}

export interface MeasureLookupInput {
  classificationCode: string;
  countryOfOrigin: string;
  entryDate?: string;
  certificate?: { agreement: string; claimed: boolean };
  selectedChapter99Headings?: string[];
}

export interface TariffMeasure {
  componentType: TariffFormulaComponent['componentType'];
  formula: string;
  rateText?: string;
  requiredVariables: FormulaVariable[];
  identifier?: string;
  appliesWhen: TariffFormulaComponent['appliesWhen'];
  sourceCitation: SourceCitationRef;
  confidence: number;
}

export interface LandedCostLineInput {
  classificationCode: string;
  countryOfOrigin: string;
  declaredValue: number;
  currency: string;
  weightKg?: number;
  quantity?: number;
  /**
   * Broadened from `Record<string, number>` (Phase 2+) so exception
   * rules can pass country ISO codes, exporter names, and qualifying
   * flags through the adapter boundary. Adapters that only care about
   * numeric variables can ignore the others.
   */
  additionalInputs?: Record<string, number | string | boolean>;
}

export interface ShipmentContext {
  destinationCountry: string;
  destinationMemberState?: string;
  /** Sub-national region (US state, CA province, etc). */
  destinationRegion?: string;
  entryDate?: string;
  incoterm?: string;
  shippingAmount?: number;
  insuranceAmount?: number;
  buyerType?: 'consumer' | 'business';
  buyerTaxId?: string;
  sellerIossNumber?: string;
  sellerIsMarketplace?: boolean;
  sellerHasDestinationTaxRegistration?: boolean;
  shipFromCountry?: string;
}

export interface LineLandedCostResult {
  classification: { hs6: string; destinationCode: string };
  baseDuty: number;
  /** Additional duties from Chapter 99 / Section 301 / 232 / IEEPA / etc. */
  additionalTariffs: number;
  /**
   * Canonical alias for `additionalTariffs`. Calculator-v2 contract uses
   * `additionalDuties` so the same vocabulary lines up with the new totals
   * vocabulary. Adapters that don't compute this can populate it from
   * `additionalTariffs`.
   */
  additionalDuties?: number;
  fees: number;
  taxes: number;
  /**
   * Customs duty total: `baseDuty + additionalDuties`. MUST NOT include fees
   * or taxes. Older shape used `totalDuty` to mean "duty + fees" — that
   * conflation is fixed in calculator-v2. Adapters now compute customs duty
   * only; fees and taxes are reported separately and rolled up into
   * `borderPayable`.
   */
  totalDuty: number;
  /** Explicit canonical name for `totalDuty`; same value, no MPF/HMF mixed in. */
  totalCustomsDuty?: number;
  /**
   * Border-payable amount: `totalCustomsDuty + fees + taxes`. This is what a
   * broker remits at clearance. Excludes goods value, shipping, and insurance.
   */
  borderPayable?: number;
  /** Total landed cost: goods + shipping + insurance + borderPayable. */
  landedCost: number;
  /** Allocated shipping for this line (when known). */
  shippingAllocated?: number;
  /** Allocated insurance for this line (when known). */
  insuranceAllocated?: number;
  components: Array<{
    componentType: TariffFormulaComponent['componentType'];
    amount: number;
    formula: string;
    identifier?: string;
  }>;
  warnings: string[];
  citations: SourceCitationRef[];
}

// ────────────────────────────────────────────────────────────────────────
// Phase A — Unified rich calculation contract
//
// Every adapter ultimately produces the same shape so the calculator-v2
// UI can render identical panels for every destination. Adapters that
// haven't migrated their `calculate()` method to the new shape can be
// adapted via `lineLandedCostResultToRich()` in calculator-v2-quote.types.
// ────────────────────────────────────────────────────────────────────────

export interface CalculatorTotals {
  /** Sum of declared values (goods only), in destination currency. */
  goodsValue: number;
  /** Customs value used for duty calculation. For most jurisdictions this equals goodsValue. */
  customsValue: number;
  /** Sum of base-duty components. */
  baseDuty: number;
  /** Sum of additional-duty components (Chapter 99 / 301 / 232 / IEEPA / etc.). */
  additionalDuties: number;
  /** baseDuty + additionalDuties. No fees, no taxes. */
  totalCustomsDuty: number;
  /** MPF / HMF / declaration-style fees. */
  fees: number;
  /** True taxes (VAT / GST / HST / Business Tax / IOSS). */
  taxes: number;
  /** totalCustomsDuty + fees + taxes. The amount remitted at clearance. */
  borderPayable: number;
  /** Freight cost allocated to this line/quote. */
  shipping: number;
  /** Insurance allocated to this line/quote. */
  insurance: number;
  /** goodsValue + shipping + insurance + borderPayable. */
  landedCost: number;
}

export interface JurisdictionFacts {
  /** Human label for the tariff schedule used (e.g. "USITC HTS 2026 Rev 8"). */
  schemaName: string;
  /** ISO date of the schema snapshot's effective date. */
  schemaEffectiveDate: string;
  /** Country currency code (USD, EUR, KRW, …). */
  currency: string;
  /** Free-text per-destination caveats / informational notes. */
  notes?: string[];
  /** De minimis / low-value-shipment treatment for this destination. */
  deMinimis?: {
    appliesTo: 'duty' | 'duty_and_tax' | 'tax_only';
    threshold: number;
    currency: string;
    qualified: boolean;
    note: string;
  };
  /** Consumption tax (VAT / GST / HST / Business Tax) rules. */
  vatRules?: {
    appliesAt: 'border' | 'reverse_charge' | 'ioss' | 'lvig_ovr' | 'exempt';
    standardRate: number;
    reducedRate?: number;
    note: string;
  };
  /** Documentation likely required for the chosen origin × trade agreement. */
  documentationRequirements?: Array<{
    code: string;
    label: string;
    requiredFor: 'preferential_rate' | 'duty_free' | 'low_value' | 'compliance';
  }>;
  /** Trade agreements eligible for the (origin, destination) pair. */
  tradeAgreements?: Array<{
    code: string;
    label: string;
    requiresCertificate: boolean;
    eligible: boolean;
    eligibilityReason?: string;
  }>;
}

export interface RichCalculationResult {
  classification: {
    hs6: string;
    effectiveCode: string;
    source: string;
  };
  components: TariffFormulaComponent[];
  totals: CalculatorTotals;
  sources: SourceCitationRef[];
  confidence: {
    score: number;
    label: 'high' | 'medium' | 'low' | 'review';
    reasons: string[];
  };
  warnings: string[];
  assumptions: string[];
  jurisdictionFacts: JurisdictionFacts;
}

export interface TariffJurisdictionAdapter {
  readonly jurisdictionCode: string;

  supports(destination: DestinationContext): boolean;

  ingestLatest(jobContext: IngestionJobContext): Promise<IngestionResult>;

  classifyCode(input: ClassificationInput): Promise<ClassificationCandidate[]>;

  getMeasures(input: MeasureLookupInput): Promise<TariffMeasure[]>;

  calculate(
    line: LandedCostLineInput,
    context: ShipmentContext,
  ): Promise<LineLandedCostResult>;

  getRequiredInputs(classification: string): Promise<FormulaVariable[]>;

  getSourceCitations(input: MeasureLookupInput): Promise<SourceCitationRef[]>;

  /**
   * Resolve a code/country to the same shape the US calculator returns.
   * Convenience for code paths that pre-date the adapter interface.
   */
  resolveFormula?(input: MeasureLookupInput): Promise<ResolveFormulaResult>;

  /**
   * Optional rich calculation entry point. Adapters that opt in return the
   * full `RichCalculationResult` directly; adapters that don't get adapted
   * via `lineLandedCostResultToRich()` in CalculatorV2QuoteService.
   *
   * Phase A introduces this as optional so all 10 existing adapters can be
   * driven through CalculatorV2QuoteService without per-adapter migration.
   */
  calculateRich?(
    line: LandedCostLineInput,
    context: ShipmentContext,
  ): Promise<RichCalculationResult>;
}

export const TARIFF_ADAPTERS = Symbol('TARIFF_ADAPTERS');
