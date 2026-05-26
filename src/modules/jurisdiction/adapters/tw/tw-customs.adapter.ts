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
import { TwTariffLookupService } from './services/tw-tariff-lookup.service';
import { TwBusinessTaxResolverService } from './services/tw-business-tax-resolver.service';

/**
 * TwCustomsAdapter (Taiwan / Republic of China)
 *
 * Computes Taiwanese import duty + Business Tax. Key behaviors:
 *   - MFN (Column 1) rate via seed table; 5% default.
 *   - ANZTEC (NZ) and ASTEP (SG) preferential rates supported.
 *   - Business Tax 5% on customs-duty-paid CIF value.
 *   - TWD 2,000 de minimis: exempt from BOTH duty and Business Tax.
 */
@Injectable()
export class TwCustomsAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'TW';

  constructor(
    private readonly tariff: TwTariffLookupService,
    private readonly businessTax: TwBusinessTaxResolverService,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'TW';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    return {
      snapshotId: 'tw-seed-table',
      rowCount: 0,
      rejectedCount: 0,
      warnings: [
        'TW adapter uses a seeded CCC mini-table; full Customs Administration ingestion is a follow-up',
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

    const isDeMinimis = this.businessTax.isDeMinimisExempt(line.declaredValue);
    let baseDuty = 0;
    const evaluated: Array<{ component: TariffFormulaComponent; amount: number }> = [];

    if (isDeMinimis) {
      warnings.push(
        `TW_DE_MINIMIS: parcel ≤ TWD ${this.businessTax.deMinimisThreshold().toLocaleString()} — duty + Business Tax exempt (subject to 6-parcel-per-6-month rule, not modeled here)`,
      );
    } else {
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
    }

    const shippingAllocated = context.shippingAmount ?? 0;
    const insuranceAllocated = context.insuranceAmount ?? 0;
    const dutyPaidValue =
      line.declaredValue + baseDuty + shippingAllocated + insuranceAllocated;

    let btAmount = 0;
    const taxComponents: TariffFormulaComponent[] = [];

    if (!isDeMinimis) {
      const v = this.businessTax.compute(dutyPaidValue);
      btAmount = v.amount;
      taxComponents.push({
        componentType: 'post_tax',
        formula: `(value + duty + shipping + insurance) * ${v.rate}`,
        rateText: `Business Tax ${(v.rate * 100).toFixed(0)}%`,
        identifier: 'TW_BUSINESS_TAX',
        description: 'Taiwan Business Tax 5%',
        requiredVariables: [
          { name: 'value', type: 'number', description: 'Declared value (TWD)' },
        ],
        appliesWhen: { kind: 'always' },
        confidence: 0.9,
        sourceCitation: {
          source: 'Ministry of Finance, ROC',
          url: 'https://web.customs.gov.tw/EN',
          confidence: 0.9,
          parserMethod: 'tw_business_tax_rule',
          rowIdentifier: 'TW_BT_STANDARD',
        },
      });
    }

    const additionalTariffs = 0;
    const fees = 0;
    const totalDuty = baseDuty + additionalTariffs;
    const borderPayable = totalDuty + fees + btAmount;
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
      taxes: round(btAmount),
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
          amount: round(btAmount),
          formula: c.formula,
          identifier: c.identifier,
        })),
      ],
      warnings,
      citations,
    };
  }

  async getRequiredInputs(_classification: string): Promise<FormulaVariable[]> {
    return [{ name: 'value', type: 'number', description: 'Declared value (TWD)' }];
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
