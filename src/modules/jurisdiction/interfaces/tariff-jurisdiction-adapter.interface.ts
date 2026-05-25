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
  additionalInputs?: Record<string, number>;
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
}

export const TARIFF_ADAPTERS = Symbol('TARIFF_ADAPTERS');
