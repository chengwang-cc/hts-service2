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
import { CaTariffLookupService } from './services/ca-tariff-lookup.service';
import { CaGstHstResolverService } from './services/ca-gst-hst-resolver.service';
import { CaLowValueResolverService } from './services/ca-low-value-resolver.service';
import { CaComplianceResolverService } from './services/ca-compliance-resolver.service';

@Injectable()
export class CaCustomsAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'CA';

  constructor(
    private readonly tariff: CaTariffLookupService,
    private readonly tax: CaGstHstResolverService,
    private readonly lowValue: CaLowValueResolverService,
    private readonly compliance: CaComplianceResolverService,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'CA';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    return {
      snapshotId: 'ca-seed-table',
      rowCount: 0,
      rejectedCount: 0,
      warnings: [
        'CA adapter uses a seeded MFN mini-table; full CBSA ingestion is a follow-up',
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

    // Low-value short-circuit.
    const lv = this.lowValue.resolve({
      declaredValueCad: line.declaredValue,
      shipFromCountry: context.shipFromCountry || line.countryOfOrigin,
    });

    // Build duty components.
    const mfn = this.tariff.lookupMfn(line.classificationCode);
    const pref = this.tariff.preferentialOverride({
      hsCode: line.classificationCode,
      originCountry: line.countryOfOrigin,
    });
    const components: TariffFormulaComponent[] = pref ? [mfn, pref] : [mfn];

    // Pick the active duty: preferential beats MFN when a preference applies.
    const baseVariables = {
      value: line.declaredValue,
      weight: line.weightKg ?? 0,
      quantity: line.quantity ?? 0,
    };

    let baseDuty = 0;
    const evaluated: Array<{ component: TariffFormulaComponent; amount: number }> = [];

    if (lv.dutyExempt) {
      warnings.push(`LV:${lv.reason}`);
    } else {
      const active = pref || mfn;
      try {
        const amount = this.evaluator.evaluate(active.formula, {
          ...baseVariables,
          additionalInputs: line.additionalInputs || {},
          declaredVariables: active.requiredVariables.map((v) => v.name),
        });
        baseDuty = amount;
        evaluated.push({ component: active, amount });
      } catch (e: any) {
        warnings.push(`duty_eval_failed:${e?.message}`);
      }
    }

    // GST / HST / PST on duty-paid value.
    const dutyPaid =
      line.declaredValue +
      baseDuty +
      (context.shippingAmount ?? 0) +
      (context.insuranceAmount ?? 0);

    let taxAmount = 0;
    const taxComponents: TariffFormulaComponent[] = [];
    if (!lv.taxExempt) {
      const tx = this.tax.compute(dutyPaid, context.destinationRegion);
      taxAmount = tx.totalTax;
      warnings.push(...tx.warnings);
      for (const c of tx.components) {
        taxComponents.push({
          componentType: 'post_tax',
          formula: `(value + duty + shipping + insurance) * ${c.rate}`,
          rateText: `${c.type} ${(c.rate * 100).toFixed(3)}%`,
          identifier: `CA_${c.type}`,
          description: `Canada ${c.type}`,
          requiredVariables: [
            { name: 'value', type: 'number', description: 'Declared value (CAD)' },
          ],
          appliesWhen: { kind: 'always' },
          confidence: 0.95,
          sourceCitation: {
            source: 'CRA / provincial sales tax',
            url: 'https://www.canada.ca/en/revenue-agency.html',
            confidence: 0.95,
            parserMethod: 'ca_gst_hst_table',
            rowIdentifier: tx.province || 'CA',
          },
        });
      }
    } else {
      warnings.push('LV_TAX_EXEMPT');
    }

    // Compliance controls.
    const controls = this.compliance.resolve(line.classificationCode);
    if (controls.some((c) => c.severity === 'block')) {
      warnings.push(...controls.map((c) => `${c.severity.toUpperCase()}:${c.type}:${c.description}`));
    } else {
      warnings.push(...controls.map((c) => `${c.severity.toUpperCase()}:${c.type}:${c.description}`));
    }

    const additionalTariffs = 0;
    const fees = 0;
    const totalDuty = baseDuty + additionalTariffs + fees + taxAmount;
    const landedCost =
      line.declaredValue +
      (context.shippingAmount ?? 0) +
      (context.insuranceAmount ?? 0) +
      totalDuty;

    citations.push(...components.map((c) => c.sourceCitation));
    citations.push(...taxComponents.map((c) => c.sourceCitation));

    return {
      classification: {
        hs6: line.classificationCode.replace(/\D/g, '').slice(0, 6),
        destinationCode: line.classificationCode,
      },
      baseDuty: r(baseDuty),
      additionalTariffs: r(additionalTariffs),
      fees: r(fees),
      taxes: r(taxAmount),
      totalDuty: r(totalDuty),
      landedCost: r(landedCost),
      components: [
        ...evaluated.map((e) => ({
          componentType: e.component.componentType,
          amount: r(e.amount),
          formula: e.component.formula,
          identifier: e.component.identifier,
        })),
        ...taxComponents.map((c) => {
          // Re-evaluate exact amount on the dutyPaid base to mirror the
          // breakdown that CaGstHstResolverService computed.
          const rate = Number(
            (c.formula.match(/\* (\d+(?:\.\d+)?)/) || [])[1] || 0,
          );
          return {
            componentType: c.componentType,
            amount: r(dutyPaid * rate),
            formula: c.formula,
            identifier: c.identifier,
          };
        }),
      ],
      warnings,
      citations,
    };
  }

  async getRequiredInputs(_classification: string): Promise<FormulaVariable[]> {
    return [{ name: 'value', type: 'number', description: 'Declared value (CAD)' }];
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

function r(v: number): number {
  return Math.round(v * 100) / 100;
}
