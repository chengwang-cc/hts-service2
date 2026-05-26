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
import { KrTariffLookupService } from './services/kr-tariff-lookup.service';
import { KrVatResolverService } from './services/kr-vat-resolver.service';

/**
 * KrCustomsAdapter (South Korea)
 *
 * Computes Korean import duty + VAT for the calculator-v2 multi-country
 * path. MFN rates come from a seed table (KCS UNI-PASS is the production
 * target); preferential rates engage when the user attests a certificate
 * for KORUS / KAFTA / KNZFTA / KSFTA / RCEP / AKFTA.
 *
 * VAT (10%) is computed on the customs-duty-paid CIF value: declared
 * value + duty + shipping + insurance. Personal-use parcels ≤ KRW 200,000
 * qualify for the de minimis exemption (both duty AND VAT free).
 */
@Injectable()
export class KrCustomsAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'KR';

  constructor(
    private readonly tariff: KrTariffLookupService,
    private readonly vat: KrVatResolverService,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'KR';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    return {
      snapshotId: 'kr-seed-table',
      rowCount: 0,
      rejectedCount: 0,
      warnings: [
        'KR adapter uses a seeded HSK mini-table; full KCS UNI-PASS ingestion is a follow-up',
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

    const isLowValueExempt = this.vat.isLowValueExempt(line.declaredValue);
    let baseDuty = 0;
    const evaluated: Array<{ component: TariffFormulaComponent; amount: number }> = [];

    if (isLowValueExempt) {
      warnings.push(
        `KR_DE_MINIMIS: parcel ≤ KRW ${this.vat.deMinimisThreshold().toLocaleString()} — duty + VAT exempt`,
      );
    } else {
      const active = pref || mfn;
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

    // VAT 10% on duty-paid CIF value (declared + duty + shipping + insurance).
    const dutyPaidValue =
      line.declaredValue +
      baseDuty +
      (context.shippingAmount ?? 0) +
      (context.insuranceAmount ?? 0);

    let vatAmount = 0;
    const taxComponents: TariffFormulaComponent[] = [];
    if (!isLowValueExempt) {
      const v = this.vat.compute(dutyPaidValue);
      vatAmount = v.amount;
      taxComponents.push({
        componentType: 'post_tax',
        formula: `(value + duty + shipping + insurance) * ${v.rate}`,
        rateText: `VAT ${(v.rate * 100).toFixed(0)}%`,
        identifier: 'KR_VAT',
        description: 'Korea VAT 10%',
        requiredVariables: [
          { name: 'value', type: 'number', description: 'Declared value (KRW)' },
        ],
        appliesWhen: { kind: 'always' },
        confidence: 0.95,
        sourceCitation: {
          source: 'National Tax Service (NTS) / Korea VAT Act',
          url: 'https://www.nts.go.kr/english/main.do',
          confidence: 0.95,
          parserMethod: 'kr_vat_rule',
          rowIdentifier: 'KR_VAT_STANDARD',
        },
      });
    }

    const additionalTariffs = 0;
    const fees = 0;
    const totalDuty = baseDuty + additionalTariffs;
    const borderPayable = totalDuty + fees + vatAmount;
    const shippingAllocated = context.shippingAmount ?? 0;
    const insuranceAllocated = context.insuranceAmount ?? 0;
    const landedCost = line.declaredValue + shippingAllocated + insuranceAllocated + borderPayable;

    const dutyComponents = evaluated.map((e) => ({
      componentType: e.component.componentType,
      amount: round(e.amount),
      formula: e.component.formula,
      identifier: e.component.identifier,
    }));
    const taxComponentsOut = taxComponents.map((c) => ({
      componentType: c.componentType,
      amount: round(vatAmount),
      formula: c.formula,
      identifier: c.identifier,
    }));

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
      taxes: round(vatAmount),
      totalDuty: round(totalDuty),
      totalCustomsDuty: round(totalDuty),
      borderPayable: round(borderPayable),
      shippingAllocated: round(shippingAllocated),
      insuranceAllocated: round(insuranceAllocated),
      landedCost: round(landedCost),
      components: [...dutyComponents, ...taxComponentsOut],
      warnings,
      citations,
    };
  }

  async getRequiredInputs(_classification: string): Promise<FormulaVariable[]> {
    return [{ name: 'value', type: 'number', description: 'Declared value (KRW)' }];
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
