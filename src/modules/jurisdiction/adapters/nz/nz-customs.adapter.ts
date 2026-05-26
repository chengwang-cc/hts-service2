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
  TariffFormulaComponent,
} from '../../../calculator/services/tariff-types';
import { FormulaEvaluationService } from '../../../calculator/services/formula-evaluation.service';
import { NzTariffLookupService } from './services/nz-tariff-lookup.service';
import { NzGstResolverService } from './services/nz-gst-resolver.service';

/**
 * NzCustomsAdapter (New Zealand)
 *
 * Mirrors the AU pattern but with NZ-specific tariff rates and the higher
 * GST rate (15%). GST applies on the landed value (Customs Value for GST):
 * declared + duty + freight + insurance.
 */
@Injectable()
export class NzCustomsAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'NZ';

  constructor(
    private readonly tariff: NzTariffLookupService,
    private readonly gst: NzGstResolverService,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'NZ';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    return {
      snapshotId: 'nz-seed-table',
      rowCount: 0,
      rejectedCount: 0,
      warnings: [
        'NZ adapter uses a seeded Working Tariff mini-table; full NZ Customs ingestion is a follow-up',
      ],
    };
  }

  async classifyCode(_input: ClassificationInput): Promise<ClassificationCandidate[]> {
    return [];
  }

  async getMeasures(input: MeasureLookupInput): Promise<TariffMeasure[]> {
    const mfn = this.tariff.lookupMfn(input.classificationCode);
    const pref = this.tariff.preferentialOverride({
      hsCode: input.classificationCode,
      originCountry: input.countryOfOrigin,
      certificate: input.certificate,
    });
    const components = pref ? [mfn, pref] : [mfn];
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
    context: ShipmentContext,
  ): Promise<LineLandedCostResult> {
    const warnings: string[] = [];
    const citations: SourceCitationRef[] = [];

    const mfn = this.tariff.lookupMfn(line.classificationCode);
    const pref = this.tariff.preferentialOverride({
      hsCode: line.classificationCode,
      originCountry: line.countryOfOrigin,
    });
    const active = pref || mfn;

    let baseDuty = 0;
    const evaluated: Array<{ component: TariffFormulaComponent; amount: number }> = [];
    try {
      const amount = this.evaluator.evaluate(active.formula, {
        value: line.declaredValue,
        weight: line.weightKg ?? 0,
        quantity: line.quantity ?? 0,
        additionalInputs: line.additionalInputs || {},
        declaredVariables: active.requiredVariables.map((v) => v.name),
      });
      baseDuty = amount;
      evaluated.push({ component: active, amount });
    } catch (e: any) {
      warnings.push(`duty_eval_failed:${e?.message}`);
    }

    const shippingAllocated = context.shippingAmount ?? 0;
    const insuranceAllocated = context.insuranceAmount ?? 0;
    const landedValue =
      line.declaredValue + baseDuty + shippingAllocated + insuranceAllocated;

    const isLvig = this.gst.isLvig(line.declaredValue);
    let gstAmount = 0;
    const taxComponents: TariffFormulaComponent[] = [];

    if (isLvig) {
      warnings.push(
        `NZ_LVIG_OST: shipment ≤ NZD ${this.gst.lvigThreshold().toLocaleString()} — GST is collected at point-of-sale under the LVIG / OST scheme; not assessed at the border.`,
      );
    } else {
      const v = this.gst.compute(landedValue);
      gstAmount = v.amount;
      taxComponents.push({
        componentType: 'post_tax',
        formula: `(value + duty + shipping + insurance) * ${v.rate}`,
        rateText: `GST ${(v.rate * 100).toFixed(0)}% on landed value`,
        identifier: 'NZ_GST',
        description: 'NZ GST 15% (on landed value: declared + duty + freight + insurance)',
        requiredVariables: [
          { name: 'value', type: 'number', description: 'Declared value (NZD)' },
        ],
        appliesWhen: { kind: 'always' },
        confidence: 0.95,
        sourceCitation: {
          source: 'Inland Revenue / GST Act 1985',
          url: 'https://www.ird.govt.nz/gst/charging-gst/gst-on-low-value-imported-goods',
          confidence: 0.95,
          parserMethod: 'nz_gst_rule',
          rowIdentifier: 'NZ_GST_LANDED',
        },
      });
    }

    const additionalTariffs = 0;
    const fees = 0;
    const totalDuty = baseDuty + additionalTariffs;
    const borderPayable = totalDuty + fees + gstAmount;
    const landedCost = line.declaredValue + shippingAllocated + insuranceAllocated + borderPayable;

    citations.push(...evaluated.map((e) => e.component.sourceCitation));
    citations.push(...taxComponents.map((c) => c.sourceCitation));

    return {
      classification: {
        hs6: line.classificationCode.replace(/\D/g, '').slice(0, 6),
        destinationCode: line.classificationCode,
      },
      baseDuty: round(baseDuty),
      additionalTariffs: round(additionalTariffs),
      additionalDuties: round(additionalTariffs),
      fees: round(fees),
      taxes: round(gstAmount),
      totalDuty: round(totalDuty),
      totalCustomsDuty: round(totalDuty),
      borderPayable: round(borderPayable),
      shippingAllocated: round(shippingAllocated),
      insuranceAllocated: round(insuranceAllocated),
      landedCost: round(landedCost),
      components: [
        ...evaluated.map((e) => ({
          componentType: e.component.componentType,
          amount: round(e.amount),
          formula: e.component.formula,
          identifier: e.component.identifier,
        })),
        ...taxComponents.map((c) => ({
          componentType: c.componentType,
          amount: round(gstAmount),
          formula: c.formula,
          identifier: c.identifier,
        })),
      ],
      warnings,
      citations,
    };
  }

  async getRequiredInputs(_classification: string): Promise<FormulaVariable[]> {
    return [{ name: 'value', type: 'number', description: 'Declared value (NZD)' }];
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
        description: m.componentType === 'special' ? 'Preferential rate' : 'MFN',
        requiredVariables: m.requiredVariables,
        appliesWhen: m.appliesWhen,
        confidence: m.confidence,
        sourceCitation: m.sourceCitation,
      })),
      allRequiredVariables: measures.flatMap((m) => m.requiredVariables),
      warnings: [],
      citations: measures.map((m) => m.sourceCitation),
      blocked: false,
      message: '',
    };
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
