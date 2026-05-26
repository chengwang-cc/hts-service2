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
import { SgTariffLookupService } from './services/sg-tariff-lookup.service';
import { SgGstResolverService } from './services/sg-gst-resolver.service';

/**
 * SgCustomsAdapter (Singapore)
 *
 * Singapore is a free port. The adapter:
 *   - Returns duty = 0 for everything except liquor / tobacco / motor
 *     vehicles / petroleum (the only 4 dutiable categories).
 *   - Always emits a Singapore-specific warning so users understand why
 *     the duty number is 0 (a calculator that just silently zeroes is
 *     confusing on first impression).
 *   - Computes GST 9% on the duty-paid CIF value when LVIG ≤ SGD 400
 *     does NOT apply; for LVIG-eligible shipments, GST is collected at
 *     point-of-sale by the offshore registered supplier and the adapter
 *     emits a clear warning instead of charging GST again.
 */
@Injectable()
export class SgCustomsAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'SG';

  constructor(
    private readonly tariff: SgTariffLookupService,
    private readonly gst: SgGstResolverService,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'SG';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    return {
      snapshotId: 'sg-seed-table',
      rowCount: 0,
      rejectedCount: 0,
      warnings: [
        'SG adapter: Singapore is a free port; duty applies only to liquor, tobacco, motor vehicles, and petroleum.',
      ],
    };
  }

  async classifyCode(_input: ClassificationInput): Promise<ClassificationCandidate[]> {
    return [];
  }

  async getMeasures(input: MeasureLookupInput): Promise<TariffMeasure[]> {
    const base = this.tariff.lookupBase(input.classificationCode);
    return [
      {
        componentType: base.componentType,
        formula: base.formula,
        rateText: base.rateText,
        requiredVariables: base.requiredVariables,
        identifier: base.identifier,
        appliesWhen: base.appliesWhen,
        sourceCitation: base.sourceCitation,
        confidence: base.confidence,
      },
    ];
  }

  async calculate(
    line: LandedCostLineInput,
    context: ShipmentContext,
  ): Promise<LineLandedCostResult> {
    const warnings: string[] = [];
    const citations: SourceCitationRef[] = [];

    const baseComponent = this.tariff.lookupBase(line.classificationCode);

    let baseDuty = 0;
    const evaluated: Array<{ component: TariffFormulaComponent; amount: number }> = [];
    try {
      const amount = this.evaluator.evaluate(baseComponent.formula, {
        value: line.declaredValue,
        weight: line.weightKg ?? 0,
        quantity: line.quantity ?? 0,
        additionalInputs: line.additionalInputs || {},
        declaredVariables: baseComponent.requiredVariables.map((v) => v.name),
      });
      baseDuty = amount;
      evaluated.push({ component: baseComponent, amount });
    } catch (e: any) {
      warnings.push(`duty_eval_failed:${e?.message}`);
    }

    if (!this.tariff.isDutiable(line.classificationCode)) {
      warnings.push(
        'SG_FREE_PORT: Singapore is a free port; no general customs duty applies (only liquor, tobacco, motor vehicles, petroleum carry duty).',
      );
    }

    // GST handling — skip when LVIG/OVR threshold applies.
    const isLvig = this.gst.isLvigOvr(line.declaredValue);
    let gstAmount = 0;
    const taxComponents: TariffFormulaComponent[] = [];

    if (isLvig) {
      warnings.push(
        `SG_LVIG_OVR: shipment ≤ SGD ${this.gst.lvigThreshold()} — GST is collected at point-of-sale under the OVR scheme; not assessed at the border.`,
      );
    } else {
      const dutyPaidValue =
        line.declaredValue +
        baseDuty +
        (context.shippingAmount ?? 0) +
        (context.insuranceAmount ?? 0);
      const v = this.gst.compute(dutyPaidValue);
      gstAmount = v.amount;
      taxComponents.push({
        componentType: 'post_tax',
        formula: `(value + duty + shipping + insurance) * ${v.rate}`,
        rateText: `GST ${(v.rate * 100).toFixed(0)}%`,
        identifier: 'SG_GST',
        description: 'Singapore GST 9%',
        requiredVariables: [
          { name: 'value', type: 'number', description: 'Declared value (SGD)' },
        ],
        appliesWhen: { kind: 'always' },
        confidence: 0.95,
        sourceCitation: {
          source: 'IRAS / Singapore GST Act',
          url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)',
          confidence: 0.95,
          parserMethod: 'sg_gst_rule',
          rowIdentifier: 'SG_GST_STANDARD',
        },
      });
    }

    const additionalTariffs = 0;
    const fees = 0;
    const totalDuty = baseDuty + additionalTariffs;
    const borderPayable = totalDuty + fees + gstAmount;
    const shippingAllocated = context.shippingAmount ?? 0;
    const insuranceAllocated = context.insuranceAmount ?? 0;
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
    return [{ name: 'value', type: 'number', description: 'Declared value (SGD)' }];
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
        description: 'Singapore tariff line',
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
