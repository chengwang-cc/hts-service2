import { Injectable, Logger } from '@nestjs/common';
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
import { GbTradeTariffIngestionService } from './services/gb-trade-tariff-ingestion.service';
import { GbMeasureNormalizerService } from './services/gb-measure-normalizer.service';
import { GbVatRuleResolverService } from './services/gb-vat-rule-resolver.service';
import { GbControlsResolverService } from './services/gb-controls-resolver.service';

/**
 * GbTradeTariffAdapter (P5.1)
 *
 * Fetches a commodity from the GOV.UK Trade Tariff API, normalizes its
 * import measures into TariffFormulaComponent rows, applies the UK
 * GBP 135 low-value rule + standard VAT via GbVatRuleResolverService,
 * and returns a LineLandedCostResult. Compliance warnings come from
 * GbControlsResolverService.
 *
 * NB: this adapter does *not* persist snapshots — that's a future
 * ingestion-job concern. We resolve live on each request, which is
 * acceptable for low traffic; production ops should add a daily
 * snapshot job before relying on this adapter at scale.
 */
@Injectable()
export class GbTradeTariffAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'GB';
  private readonly logger = new Logger(GbTradeTariffAdapter.name);

  constructor(
    private readonly ingestion: GbTradeTariffIngestionService,
    private readonly normalizer: GbMeasureNormalizerService,
    private readonly vat: GbVatRuleResolverService,
    private readonly controls: GbControlsResolverService,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'GB';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    // The current implementation resolves on-demand. A snapshot job will
    // replace this with batched fetch + S3 persist + tariff_snapshots row.
    return {
      snapshotId: 'gb-trade-tariff-live',
      rowCount: 0,
      rejectedCount: 0,
      warnings: ['GB adapter currently resolves live; no batch snapshot yet'],
    };
  }

  async classifyCode(
    _input: ClassificationInput,
  ): Promise<ClassificationCandidate[]> {
    // GB classification is delegated to the shared ClassifyService.
    return [];
  }

  async getMeasures(input: MeasureLookupInput): Promise<TariffMeasure[]> {
    const commodity = await this.ingestion.fetchCommodity(input.classificationCode);
    if (!commodity) return [];
    const { components } = this.normalizer.normalize(commodity, input.countryOfOrigin);
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
    const commodity = await this.ingestion.fetchCommodity(line.classificationCode);
    if (!commodity) {
      return this.blockedResult(
        line,
        `GB commodity ${line.classificationCode} not found in GOV.UK Trade Tariff`,
      );
    }

    const { components, warnings: normWarnings } = this.normalizer.normalize(
      commodity,
      line.countryOfOrigin,
    );
    const compliance = this.controls.resolve(commodity);
    const blockingControls = compliance.filter((c) => c.severity === 'block');
    if (blockingControls.length > 0) {
      return this.blockedResult(
        line,
        `Blocked by ${blockingControls.length} GB control(s): ${blockingControls
          .map((c) => c.type)
          .join(', ')}`,
        compliance,
      );
    }

    const baseVariables = {
      value: line.declaredValue,
      weight: line.weightKg ?? 0,
      quantity: line.quantity ?? 0,
    };

    // Evaluate duty components
    const evaluated: Array<{
      component: TariffFormulaComponent;
      amount: number;
    }> = [];
    let runningDuty = 0;
    for (const c of components) {
      try {
        const amount = this.evaluator.evaluate(c.formula, {
          ...baseVariables,
          additionalInputs: line.additionalInputs || {},
          declaredVariables: c.requiredVariables.map((v) => v.name),
        });
        runningDuty += amount;
        evaluated.push({ component: c, amount });
      } catch (e: any) {
        this.logger.warn(`GB component eval failed (${c.identifier}): ${e?.message}`);
      }
    }

    // Apply UK VAT
    const vatDecision = await this.vat.resolve({
      declaredValueGbp: line.declaredValue,
      hsCode: line.classificationCode,
      effectiveDate: context.entryDate || new Date().toISOString().slice(0, 10),
      buyerIsVatRegisteredBusiness: context.buyerType === 'business' && !!context.buyerTaxId,
      sellerHasUkVatRegistration:
        context.sellerHasDestinationTaxRegistration ?? false,
    });
    const vatBase =
      line.declaredValue +
      runningDuty +
      (context.shippingAmount ?? 0) +
      (context.insuranceAmount ?? 0);
    const vatAmount =
      vatDecision.collectionPoint === 'exempt' ||
      vatDecision.collectionPoint === 'reverse_charge'
        ? 0
        : Math.round(vatBase * vatDecision.rate * 100) / 100;

    const baseDuty = evaluated
      .filter((e) => e.component.componentType === 'base')
      .reduce((s, e) => s + e.amount, 0);
    const additionalTariffs = evaluated
      .filter((e) =>
        ['section_301', 'section_232', 'section_122', 'chapter_99', 'special'].includes(
          e.component.componentType,
        ),
      )
      .reduce((s, e) => s + e.amount, 0);
    const fees = 0;
    const taxes = vatAmount;

    const totalDuty = baseDuty + additionalTariffs + fees + taxes;
    const landedCost =
      line.declaredValue +
      (context.shippingAmount ?? 0) +
      (context.insuranceAmount ?? 0) +
      totalDuty;

    const citationRefs: SourceCitationRef[] = components.map((c) => c.sourceCitation);

    return {
      classification: {
        hs6: line.classificationCode.replace(/\D/g, '').slice(0, 6),
        destinationCode: commodity.code || line.classificationCode,
      },
      baseDuty: this.r(baseDuty),
      additionalTariffs: this.r(additionalTariffs),
      fees: this.r(fees),
      taxes: this.r(taxes),
      totalDuty: this.r(totalDuty),
      landedCost: this.r(landedCost),
      components: [
        ...evaluated.map((e) => ({
          componentType: e.component.componentType,
          amount: this.r(e.amount),
          formula: e.component.formula,
          identifier: e.component.identifier,
        })),
        ...(vatAmount > 0
          ? [
              {
                componentType: 'post_tax' as const,
                amount: vatAmount,
                formula: `(value + duty + shipping + insurance) * ${vatDecision.rate}`,
                identifier: 'GB_VAT',
              },
            ]
          : []),
      ],
      warnings: [
        ...normWarnings,
        ...compliance.map((c) => `${c.severity.toUpperCase()}:${c.type}:${c.description}`),
        ...(vatDecision.collectionPoint !== 'border'
          ? [`VAT collection: ${vatDecision.collectionPoint} (${vatDecision.reason})`]
          : []),
      ],
      citations: citationRefs,
    };
  }

  async getRequiredInputs(classification: string): Promise<FormulaVariable[]> {
    const commodity = await this.ingestion.fetchCommodity(classification);
    if (!commodity) return [];
    const { components } = this.normalizer.normalize(commodity, 'XX');
    const seen = new Set<string>();
    const out: FormulaVariable[] = [];
    for (const c of components) {
      for (const v of c.requiredVariables) {
        if (!seen.has(v.name)) {
          seen.add(v.name);
          out.push(v);
        }
      }
    }
    return out;
  }

  async getSourceCitations(input: MeasureLookupInput): Promise<SourceCitationRef[]> {
    const measures = await this.getMeasures(input);
    return measures.map((m) => m.sourceCitation);
  }

  async resolveFormula(input: MeasureLookupInput): Promise<ResolveFormulaResult> {
    const commodity = await this.ingestion.fetchCommodity(input.classificationCode);
    if (!commodity) {
      return {
        htsNumber: input.classificationCode,
        effectiveHtsCode: input.classificationCode,
        components: [],
        allRequiredVariables: [],
        warnings: [],
        citations: [],
        blocked: true,
        blockReason: 'GB_COMMODITY_NOT_FOUND',
        message: `Commodity ${input.classificationCode} not found in GOV.UK Trade Tariff`,
      };
    }
    const { components, warnings } = this.normalizer.normalize(
      commodity,
      input.countryOfOrigin,
    );
    return {
      htsNumber: input.classificationCode,
      effectiveHtsCode: commodity.code,
      components,
      allRequiredVariables: this.uniqueVars(components.flatMap((c) => c.requiredVariables)),
      warnings,
      citations: components.map((c) => c.sourceCitation),
      blocked: false,
      message: '',
    };
  }

  private uniqueVars(vars: FormulaVariable[]): FormulaVariable[] {
    const seen = new Set<string>();
    const out: FormulaVariable[] = [];
    for (const v of vars) {
      if (!seen.has(v.name)) {
        seen.add(v.name);
        out.push(v);
      }
    }
    return out;
  }

  private r(v: number): number {
    return Math.round(v * 100) / 100;
  }

  private blockedResult(
    line: LandedCostLineInput,
    reason: string,
    controls: any[] = [],
  ): LineLandedCostResult {
    return {
      classification: {
        hs6: line.classificationCode.replace(/\D/g, '').slice(0, 6),
        destinationCode: line.classificationCode,
      },
      baseDuty: 0,
      additionalTariffs: 0,
      fees: 0,
      taxes: 0,
      totalDuty: 0,
      landedCost: line.declaredValue,
      components: [],
      warnings: [reason, ...controls.map((c) => `${c.severity.toUpperCase()}:${c.type}:${c.description}`)],
      citations: [],
    };
  }
}
