/**
 * CalculatorV2 quote contract types.
 *
 * Phase A introduces the unified quote shape exposed by POST /v2/quote.
 * The shape mirrors what every adapter returns for `RichCalculationResult`
 * and rolls per-line results up into top-level totals + a single source list.
 */

import type {
  LineLandedCostResult,
  RichCalculationResult,
  CalculatorTotals,
  JurisdictionFacts,
} from '../jurisdiction/interfaces/tariff-jurisdiction-adapter.interface';
import type { SourceCitationRef } from '../calculator/services/tariff-types';

export interface CalculatorV2QuoteRequest {
  destination: { country: string; memberState?: string };
  origin: { country: string; shipFromCountry?: string };
  currency: string;
  entryDate?: string;
  shipping?: { amount: number; currency: string };
  insurance?: { amount: number; currency: string };
  transportMode?: 'ocean' | 'air' | 'truck' | 'rail' | 'mail';
  tradeAgreementCode?: string;
  tradeAgreementCertificate?: boolean;
  incoterm?: string;
  buyerType?: 'consumer' | 'business';
  items: CalculatorV2LineRequest[];
}

/** Per-request caller context (org + user) supplied by the controller. */
export interface CalculatorV2CallerContext {
  organizationId?: string;
  userId?: string;
}

export interface CalculatorV2LineRequest {
  sku?: string;
  description?: string;
  classificationCode: string;
  countryOfOrigin?: string;
  quantity: number;
  unitValue: number;
  weightKg?: number;
  selectedChapter99Headings?: string[];
  /**
   * Per-line rule inputs. Phase 2+ broadened from `Record<string, number>`
   * to `Record<string, number | string | boolean>` so exception rules
   * can read country codes ("RU", "Y"), exporter names, and qualifying
   * flags from the same map alongside numeric variables like
   * `aluminum_pct` or `eu_cbam_quantity_tonnes`.
   *
   * Downstream adapters (`LandedCostLineInput.additionalInputs`) accept
   * the same shape; rules cast specific fields they read.
   */
  additionalInputs?: Record<string, number | string | boolean>;
}

export interface CalculatorV2QuoteLine {
  lineNumber: number;
  sku?: string;
  description?: string;
  request: CalculatorV2LineRequest;
  result: RichCalculationResult;
  /**
   * A3 fix (2026-05-26): echo the Chapter 99 headings the user
   * explicitly selected on this line. The adapter reduces these to a
   * numeric marker on the way down to the resolver; surfacing them
   * here keeps the user's choice visible in the response without
   * coupling the FE to the resolver's internal representation.
   *
   * Empty / undefined when the user didn't pick any.
   */
  selectedChapter99Headings?: string[];
}

export interface CalculatorV2QuoteResult {
  quoteId: string;
  engineVersion: string;
  generatedAt: string;
  destination: { country: string; memberState?: string };
  origin: { country: string };
  currency: string;
  entryDate?: string;
  lines: CalculatorV2QuoteLine[];
  totals: CalculatorTotals;
  sources: SourceCitationRef[];
  jurisdictionFacts: JurisdictionFacts;
  warnings: string[];
  assumptions: string[];
  confidence: { score: number; label: 'high' | 'medium' | 'low' | 'review' };
}

/**
 * Convert a legacy `LineLandedCostResult` (the existing adapter return
 * shape) into a `RichCalculationResult`. Used by CalculatorV2QuoteService
 * for adapters that haven't migrated to `calculateRich()` directly.
 *
 * The conversion is mechanical — all the new fields (totals, confidence,
 * jurisdictionFacts) are derived from data already on the legacy shape.
 * `jurisdictionFacts` is a minimal placeholder; the quote service overlays
 * the real per-destination facts on top via JurisdictionFactsService.
 */
export function lineLandedCostResultToRich(
  legacy: LineLandedCostResult,
  args: {
    requestedHsCode: string;
    declaredValue: number;
    shipping: number;
    insurance: number;
    jurisdictionFacts: JurisdictionFacts;
  },
): RichCalculationResult {
  const baseDuty = legacy.baseDuty;
  const additionalDuties = legacy.additionalDuties ?? legacy.additionalTariffs;
  const totalCustomsDuty = legacy.totalCustomsDuty ?? legacy.totalDuty;
  const fees = legacy.fees;
  const taxes = legacy.taxes;
  const borderPayable = legacy.borderPayable ?? totalCustomsDuty + fees + taxes;
  const shipping = legacy.shippingAllocated ?? args.shipping;
  const insurance = legacy.insuranceAllocated ?? args.insurance;
  const goodsValue = args.declaredValue;
  const customsValue = goodsValue;
  const landedCost = legacy.landedCost ?? goodsValue + shipping + insurance + borderPayable;

  // Map flat amounts back into TariffFormulaComponent-shaped rows so the UI
  // gets a uniform component[] feed. We don't have the original `formula`
  // / `requiredVariables` here, so we synthesize a minimal but compatible
  // shape — sufficient for the cost-allocation + sources panels.
  const components = legacy.components.map((c, idx) => ({
    componentType: c.componentType,
    formula: c.formula,
    requiredVariables: [],
    identifier: c.identifier,
    appliesWhen: { kind: 'always' as const },
    sourceCitation:
      legacy.citations[idx] ?? legacy.citations[0] ?? {
        source: 'jurisdiction_adapter',
        confidence: 0.5,
      },
    confidence: 0.85,
    description: `${c.componentType} (${c.identifier || 'unnamed'})`,
  }));

  // Confidence is derived from the citations average; calculator-v2 will
  // overwrite this with TariffConfidenceService when available.
  const score = legacy.citations.length === 0 ? 0.5 : 0.85;
  const confidence = {
    score,
    label: scoreToLabel(score),
    reasons: legacy.warnings,
  };

  return {
    classification: {
      hs6: legacy.classification.hs6,
      effectiveCode: legacy.classification.destinationCode || args.requestedHsCode,
      source: 'jurisdiction_adapter',
    },
    components,
    totals: {
      goodsValue: round2(goodsValue),
      customsValue: round2(customsValue),
      baseDuty: round2(baseDuty),
      additionalDuties: round2(additionalDuties),
      totalCustomsDuty: round2(totalCustomsDuty),
      fees: round2(fees),
      taxes: round2(taxes),
      borderPayable: round2(borderPayable),
      shipping: round2(shipping),
      insurance: round2(insurance),
      landedCost: round2(landedCost),
    },
    sources: dedupeSources(legacy.citations),
    confidence,
    warnings: legacy.warnings,
    assumptions: [],
    jurisdictionFacts: args.jurisdictionFacts,
  };
}

export function scoreToLabel(
  score: number,
): 'high' | 'medium' | 'low' | 'review' {
  if (score >= 0.9) return 'high';
  if (score >= 0.75) return 'medium';
  if (score >= 0.5) return 'low';
  return 'review';
}

function dedupeSources(citations: SourceCitationRef[]): SourceCitationRef[] {
  const seen = new Map<string, SourceCitationRef>();
  for (const c of citations) {
    const key = `${c.source}|${c.rowIdentifier ?? ''}|${c.url ?? ''}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return Array.from(seen.values());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
