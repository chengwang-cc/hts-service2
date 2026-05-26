import { Injectable } from '@nestjs/common';
import {
  ClassificationCandidate,
  ClassificationInput,
  DestinationContext,
  IngestionJobContext,
  IngestionResult,
  JurisdictionFacts,
  LandedCostLineInput,
  LineLandedCostResult,
  MeasureLookupInput,
  RichCalculationResult,
  ShipmentContext,
  TariffJurisdictionAdapter,
  TariffMeasure,
} from '../../interfaces/tariff-jurisdiction-adapter.interface';
import {
  FormulaVariable,
  ResolveFormulaResult,
  SourceCitationRef,
  TariffFormulaComponent,
} from '../../../calculator/services/tariff-types';

/**
 * StubJurisdictionAdapter (Wave 1+ scaffolding — 2026-05-26).
 *
 * Generic placeholder adapter for the 11 new destinations (JP, MX, CN,
 * IN, VN, PH, ID, MY, TH, AE, BR). Returns a minimal `RichCalculationResult`
 * with:
 *   - zero base duty (placeholder — real adapters will replace this
 *     with per-HTS lookup against the official tariff schedule)
 *   - empty components (the per-country exception-rule packs add the
 *     real tax / FTA / AD/CVD components)
 *   - a clear "stub adapter" warning so users + ops see that the
 *     destination is at SOURCE_VALIDATION state per the rollout sequence
 *
 * Each stub is instantiated with a per-country profile (currency,
 * default tax label, etc.) so it can serve every new destination via
 * the same class. Production adapters under
 * `jurisdiction/adapters/{country}/` will replace this stub one country
 * at a time per the rollout sequence.
 *
 * Why a stub rather than letting `pickForDestination()` throw
 * `UnsupportedJurisdictionError`:
 *   - Calculator quotes can return real-looking responses for new
 *     destinations (good for shadow comparison + UX validation).
 *   - The per-country exception rules (JP consumption tax, MX IVA,
 *     CN VAT, IN IGST, BR ICMS, etc.) fire correctly because they
 *     run AFTER the adapter; the runner doesn't care if the adapter
 *     returns zero base duty.
 *   - Country state machine works as documented: SOURCE_VALIDATION
 *     destinations get the stub adapter; promoting to PRODUCTION
 *     swaps in the real adapter.
 */

export interface StubAdapterProfile {
  /** ISO-2 destination code. */
  jurisdictionCode: string;
  /** Display name shown in jurisdictionFacts.schemaName. */
  displayName: string;
  /** Destination currency (ISO-4217). */
  currency: string;
  /** Free-text customs authority name. */
  authority: string;
  /** Notes shown to operators reading the breakdown. */
  notes?: string[];
}

@Injectable()
export class StubJurisdictionAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode: string;
  private readonly profile: StubAdapterProfile;

  constructor(profile: StubAdapterProfile) {
    this.jurisdictionCode = profile.jurisdictionCode;
    this.profile = profile;
  }

  supports(destination: DestinationContext): boolean {
    return (
      (destination.country || '').toUpperCase() ===
      this.jurisdictionCode.toUpperCase()
    );
  }

  async ingestLatest(_job: IngestionJobContext): Promise<IngestionResult> {
    // Stub: no real ingestion until the per-country adapter ships.
    return {
      snapshotId: `stub-${this.jurisdictionCode}`,
      rowsIngested: 0,
      sourceUrl: 'stub://placeholder',
      effectiveFrom: new Date(),
      checksum: 'stub',
      warnings: [
        `${this.profile.displayName} is on the stub adapter — ingestion deferred until per-country adapter lands.`,
      ],
    } as unknown as IngestionResult;
  }

  async classifyCode(_input: ClassificationInput): Promise<ClassificationCandidate[]> {
    // No live classification under the stub. Return empty; the
    // calculator falls through to its global HS resolver.
    return [];
  }

  async getMeasures(_input: MeasureLookupInput): Promise<TariffMeasure[]> {
    return [];
  }

  async calculate(
    line: LandedCostLineInput,
    context: ShipmentContext,
  ): Promise<LineLandedCostResult> {
    const goodsValue = line.declaredValue ?? 0;
    const shipping = context.shippingAmount ?? 0;
    const insurance = context.insuranceAmount ?? 0;
    return {
      classification: {
        hs6: this.hs6Of(line.classificationCode),
        destinationCode: this.jurisdictionCode,
      },
      baseDuty: 0,
      additionalTariffs: 0,
      additionalDuties: 0,
      totalDuty: 0,
      totalCustomsDuty: 0,
      fees: 0,
      taxes: 0,
      borderPayable: 0,
      shippingAllocated: shipping,
      insuranceAllocated: insurance,
      landedCost: goodsValue + shipping + insurance,
      components: [],
      warnings: [
        `${this.profile.displayName} is using the stub adapter. Base duty is zero; per-country tax + FTA + AD/CVD rules still apply via the exception-rule engine.`,
        ...(this.profile.notes ?? []),
      ],
      citations: [],
    };
  }

  async calculateRich(
    line: LandedCostLineInput,
    context: ShipmentContext,
  ): Promise<RichCalculationResult> {
    const goodsValue = line.declaredValue ?? 0;
    const shipping = context.shippingAmount ?? 0;
    const insurance = context.insuranceAmount ?? 0;
    return {
      classification: {
        hs6: this.hs6Of(line.classificationCode),
        effectiveCode: line.classificationCode,
        source: 'stub://placeholder',
      },
      components: [] as TariffFormulaComponent[],
      totals: {
        goodsValue,
        customsValue: goodsValue,
        baseDuty: 0,
        additionalDuties: 0,
        totalCustomsDuty: 0,
        fees: 0,
        taxes: 0,
        borderPayable: 0,
        shipping,
        insurance,
        landedCost: goodsValue + shipping + insurance,
      },
      sources: [] as SourceCitationRef[],
      confidence: {
        score: 0.4,
        label: 'low',
        reasons: [
          `${this.profile.displayName} destination is on the stub adapter (SOURCE_VALIDATION state).`,
          'Base duty is placeholder zero; per-country exception rules still fire (taxes, FTAs, AD/CVD).',
        ],
      },
      warnings: [
        `${this.profile.displayName} stub adapter — production needs per-country tariff ingestion.`,
        ...(this.profile.notes ?? []),
      ],
      assumptions: [
        `Base customs duty defaulted to 0 for ${this.profile.displayName} pending real adapter.`,
      ],
      jurisdictionFacts: this.factsFor(),
    };
  }

  async getRequiredInputs(_classification: string): Promise<FormulaVariable[]> {
    return [];
  }

  async getSourceCitations(_input: MeasureLookupInput): Promise<SourceCitationRef[]> {
    return [];
  }

  async resolveFormula(_input: MeasureLookupInput): Promise<ResolveFormulaResult> {
    return {
      htsCode: _input.classificationCode,
      effectiveHtsCode: _input.classificationCode,
      formulas: [],
      requiredVariables: [],
      sources: [],
      message: `Stub adapter — no formula resolution available for ${this.profile.displayName}.`,
      confidence: 0.4,
    } as unknown as ResolveFormulaResult;
  }

  private hs6Of(code: string): string {
    return (code || '').replace(/\./g, '').padEnd(6, '0').slice(0, 6);
  }

  private factsFor(): JurisdictionFacts {
    return {
      schemaName: `${this.profile.displayName} (stub adapter — Wave 1+ scaffolding)`,
      schemaEffectiveDate: new Date().toISOString().slice(0, 10),
      currency: this.profile.currency,
      notes: [
        `${this.profile.displayName} stub adapter — production deployment requires real tariff ingestion.`,
        ...(this.profile.notes ?? []),
      ],
    };
  }
}

/**
 * Profiles for the 11 new destinations. Used by the factory in the
 * jurisdiction module to instantiate one stub adapter per country.
 */
export const STUB_PROFILES: StubAdapterProfile[] = [
  { jurisdictionCode: 'JP', displayName: 'Japan', currency: 'JPY', authority: 'Japan Customs' },
  { jurisdictionCode: 'MX', displayName: 'Mexico', currency: 'MXN', authority: 'SAT' },
  { jurisdictionCode: 'CN', displayName: 'China', currency: 'CNY', authority: 'GACC' },
  { jurisdictionCode: 'IN', displayName: 'India', currency: 'INR', authority: 'CBIC' },
  { jurisdictionCode: 'VN', displayName: 'Vietnam', currency: 'VND', authority: 'Vietnam Customs' },
  { jurisdictionCode: 'PH', displayName: 'Philippines', currency: 'PHP', authority: 'BOC' },
  { jurisdictionCode: 'ID', displayName: 'Indonesia', currency: 'IDR', authority: 'Bea Cukai' },
  { jurisdictionCode: 'MY', displayName: 'Malaysia', currency: 'MYR', authority: 'JKDM' },
  { jurisdictionCode: 'TH', displayName: 'Thailand', currency: 'THB', authority: 'Thai Customs' },
  { jurisdictionCode: 'AE', displayName: 'United Arab Emirates', currency: 'AED', authority: 'Federal Customs Authority' },
  { jurisdictionCode: 'BR', displayName: 'Brazil', currency: 'BRL', authority: 'Receita Federal' },
];
