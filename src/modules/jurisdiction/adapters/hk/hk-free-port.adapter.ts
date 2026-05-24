import { Injectable } from '@nestjs/common';
import {
  ClassificationCandidate,
  ClassificationInput,
  DestinationContext,
  IngestionJobContext,
  IngestionResult,
  LandedCostLineInput,
  LineLandedCostResult,
  MeasureLookupInput,
  ShipmentContext,
  TariffJurisdictionAdapter,
  TariffMeasure,
} from '../../interfaces/tariff-jurisdiction-adapter.interface';
import {
  FormulaVariable,
  ResolveFormulaResult,
  SourceCitationRef,
} from '../../../calculator/services/tariff-types';
import { HkDutiableCommodityResolverService } from './services/hk-dutiable-commodity-resolver.service';
import { HkComplianceResolverService } from './services/hk-compliance-resolver.service';

/**
 * HkFreePortAdapter (P5.2)
 *
 * Hong Kong is a free port:
 *   - No general customs tariff on imports/exports.
 *   - No VAT/GST.
 *   - No tariff quota or surcharge for ordinary goods.
 *
 * The only chargeable items are excise duties on dutiable commodities
 * (liquor, tobacco, hydrocarbon oil, methyl alcohol), surfaced as
 * placeholder components that the operator fills in via FeeRuleEntity
 * rows. Compliance warnings are returned in `controls`.
 */
@Injectable()
export class HkFreePortAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'HK';

  constructor(
    private readonly dutiable: HkDutiableCommodityResolverService,
    private readonly compliance: HkComplianceResolverService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'HK';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    // No source ingestion for HK — the free-port rule is hard-coded; the
    // excise rate table is maintained manually via /admin/jurisdictions/HK/rules.
    return {
      snapshotId: 'hk-free-port-static',
      rowCount: 0,
      rejectedCount: 0,
      warnings: ['HK has no general tariff schedule; rates are admin-maintained'],
    };
  }

  async classifyCode(
    _input: ClassificationInput,
  ): Promise<ClassificationCandidate[]> {
    // HK uses the same 8-digit HS code internally; delegated to the
    // shared classification module via ClassifyService at the
    // landed-cost orchestration layer.
    return [];
  }

  async getMeasures(input: MeasureLookupInput): Promise<TariffMeasure[]> {
    const components = this.dutiable.buildComponents(input.classificationCode);
    return components.map((c) => ({
      componentType: c.componentType,
      formula: c.formula,
      rateText: c.rateText,
      requiredVariables: c.requiredVariables,
      identifier: c.identifier,
      appliesWhen: c.appliesWhen,
      sourceCitation: c.sourceCitation,
      confidence: c.confidence,
    }));
  }

  async calculate(
    line: LandedCostLineInput,
    _context: ShipmentContext,
  ): Promise<LineLandedCostResult> {
    const components = this.dutiable.buildComponents(line.classificationCode);
    const controls = this.compliance.resolve(line.classificationCode);

    // Free-port goods: zero duty / fees / taxes. Excise components are
    // present but evaluate to 0 until the FeeRuleEntity-driven engine
    // applies real rates (P4.2). We surface them here so quote consumers
    // see the line item is dutiable.
    const totalDuty = 0;
    const landedCost = line.declaredValue;

    return {
      classification: {
        hs6: (line.classificationCode || '').replace(/\D/g, '').slice(0, 6),
        destinationCode: line.classificationCode,
      },
      baseDuty: 0,
      additionalTariffs: 0,
      fees: 0,
      taxes: 0,
      totalDuty,
      landedCost,
      components: components.map((c) => ({
        componentType: c.componentType,
        amount: 0,
        formula: c.formula,
        identifier: c.identifier,
      })),
      warnings: controls.map((w) => `${w.severity.toUpperCase()}:${w.type}:${w.description}`),
      citations: components.map((c) => c.sourceCitation),
    };
  }

  async getRequiredInputs(classification: string): Promise<FormulaVariable[]> {
    const c = this.dutiable.classify(classification);
    return c.requiredVariables;
  }

  async getSourceCitations(input: MeasureLookupInput): Promise<SourceCitationRef[]> {
    const measures = await this.getMeasures(input);
    return measures.map((m) => m.sourceCitation);
  }

  async resolveFormula(input: MeasureLookupInput): Promise<ResolveFormulaResult> {
    const measures = await this.getMeasures(input);
    return {
      htsNumber: input.classificationCode,
      effectiveHtsCode: input.classificationCode,
      components: measures.map((m) => ({
        componentType: m.componentType,
        formula: m.formula,
        rateText: m.rateText,
        identifier: m.identifier,
        description:
          m.componentType === 'base'
            ? 'Hong Kong free-port'
            : 'HK excise placeholder',
        requiredVariables: m.requiredVariables,
        appliesWhen: m.appliesWhen,
        confidence: m.confidence,
        sourceCitation: m.sourceCitation,
      })),
      allRequiredVariables: this.uniqueVars(
        measures.flatMap((m) => m.requiredVariables),
      ),
      warnings: [],
      citations: measures.map((m) => m.sourceCitation),
      blocked: false,
      message: '',
    };
  }

  private uniqueVars(vars: FormulaVariable[]): FormulaVariable[] {
    const seen = new Set<string>();
    const out: FormulaVariable[] = [];
    for (const v of vars) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      out.push(v);
    }
    return out;
  }
}
