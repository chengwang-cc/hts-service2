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
import { EuTaricIngestionService } from './services/eu-taric-ingestion.service';
import { EuVatRuleResolverService } from './services/eu-vat-rule-resolver.service';
import { EuIossResolverService } from './services/eu-ioss-resolver.service';
import { ViesValidationService } from './services/vies-validation.service';

@Injectable()
export class EuTaricAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'EU';

  constructor(
    private readonly taric: EuTaricIngestionService,
    private readonly vat: EuVatRuleResolverService,
    private readonly ioss: EuIossResolverService,
    private readonly vies: ViesValidationService,
    private readonly evaluator: FormulaEvaluationService,
  ) {}

  supports(destination: DestinationContext): boolean {
    const c = (destination.country || '').toUpperCase();
    if (c === 'EU') return !!destination.memberState;
    // EU member states resolved directly (e.g. country='DE').
    return [
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
      'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
    ].includes(c);
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    return {
      snapshotId: 'eu-taric-seed-table',
      rowCount: 0,
      rejectedCount: 0,
      warnings: [
        'EU adapter uses a seeded CCT mini-table; full TARIC ingestion is a P6 follow-up',
      ],
    };
  }

  async classifyCode(_input: ClassificationInput): Promise<ClassificationCandidate[]> {
    return [];
  }

  async getMeasures(input: MeasureLookupInput): Promise<TariffMeasure[]> {
    const { components } = await this.taric.fetchComponents(
      input.classificationCode,
      input.countryOfOrigin,
    );
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
    const memberState = this.resolveMemberState(context);
    if (!memberState) {
      return this.blocked(line, 'EU_REQUIRES_MEMBER_STATE');
    }

    const warnings: string[] = [];
    const citations: SourceCitationRef[] = [];

    const { components, warnings: taricWarnings } = await this.taric.fetchComponents(
      line.classificationCode,
      line.countryOfOrigin,
    );
    warnings.push(...taricWarnings);

    const baseVariables = {
      value: line.declaredValue,
      weight: line.weightKg ?? 0,
      quantity: line.quantity ?? 0,
    };

    let baseDuty = 0;
    const evaluated: Array<{ component: TariffFormulaComponent; amount: number }> = [];
    for (const c of components) {
      try {
        const amount = this.evaluator.evaluate(c.formula, {
          ...baseVariables,
          additionalInputs: line.additionalInputs || {},
          declaredVariables: c.requiredVariables.map((v) => v.name),
        });
        if (c.componentType === 'base' || c.componentType === 'special') {
          baseDuty += amount;
        }
        evaluated.push({ component: c, amount });
        citations.push(c.sourceCitation);
      } catch (e: any) {
        warnings.push(`duty_eval_failed:${e?.message}`);
      }
    }

    // Validate buyer VAT id if present (B2B reverse-charge path).
    if (context.buyerTaxId) {
      const v = this.vies.validate(context.buyerTaxId);
      warnings.push(...v.warnings.map((w) => `vies:${w}`));
    }

    const iossDecision = this.ioss.decide({
      declaredValueEur: line.declaredValue,
      hsCode: line.classificationCode,
      sellerIossNumber: context.sellerIossNumber,
      sellerIsMarketplace: context.sellerIsMarketplace ?? false,
      buyerType: context.buyerType,
      buyerVatId: context.buyerTaxId,
    });

    const vatDecision = await this.vat.resolveStandard(
      memberState,
      context.entryDate,
    );

    const vatBase =
      line.declaredValue +
      baseDuty +
      (context.shippingAmount ?? 0) +
      (context.insuranceAmount ?? 0);
    const vatAmount =
      iossDecision.collectionPoint === 'exempt' ||
      iossDecision.collectionPoint === 'reverse_charge'
        ? 0
        : Math.round(vatBase * vatDecision.rate * 100) / 100;

    warnings.push(
      `vat_collection:${iossDecision.collectionPoint}:${iossDecision.reason}`,
      `vat_rate:${memberState}=${(vatDecision.rate * 100).toFixed(1)}% (${vatDecision.source})`,
    );

    const taxes = vatAmount;
    const fees = 0;
    const additionalTariffs = 0;
    const totalDuty = baseDuty + additionalTariffs + fees + taxes;
    const landedCost =
      line.declaredValue +
      (context.shippingAmount ?? 0) +
      (context.insuranceAmount ?? 0) +
      totalDuty;

    const vatComponentArr =
      vatAmount > 0
        ? [
            {
              componentType: 'post_tax' as const,
              amount: vatAmount,
              formula: `(value + duty + shipping + insurance) * ${vatDecision.rate}`,
              identifier: `EU_VAT_${memberState}`,
            },
          ]
        : [];

    return {
      classification: {
        hs6: line.classificationCode.replace(/\D/g, '').slice(0, 6),
        destinationCode: line.classificationCode,
      },
      baseDuty: r(baseDuty),
      additionalTariffs: r(additionalTariffs),
      fees: r(fees),
      taxes: r(taxes),
      totalDuty: r(totalDuty),
      landedCost: r(landedCost),
      components: [
        ...evaluated.map((e) => ({
          componentType: e.component.componentType,
          amount: r(e.amount),
          formula: e.component.formula,
          identifier: e.component.identifier,
        })),
        ...vatComponentArr,
      ],
      warnings,
      citations,
    };
  }

  async getRequiredInputs(_classification: string): Promise<FormulaVariable[]> {
    return [{ name: 'value', type: 'number', description: 'Declared value (EUR)' }];
  }

  async getSourceCitations(input: MeasureLookupInput): Promise<SourceCitationRef[]> {
    const measures = await this.getMeasures(input);
    return measures.map((m) => m.sourceCitation);
  }

  async resolveFormula(input: MeasureLookupInput): Promise<ResolveFormulaResult> {
    const { components, warnings } = await this.taric.fetchComponents(
      input.classificationCode,
      input.countryOfOrigin,
    );
    return {
      htsNumber: input.classificationCode,
      effectiveHtsCode: input.classificationCode,
      components,
      allRequiredVariables: components.flatMap((c) => c.requiredVariables),
      warnings,
      citations: components.map((c) => c.sourceCitation),
      blocked: false,
      message: '',
    };
  }

  private resolveMemberState(context: ShipmentContext): string | null {
    if (context.destinationMemberState) {
      return context.destinationMemberState.toUpperCase();
    }
    // The LandedCostService maps destination='DE' to country='EU' +
    // memberState='DE' already, so we shouldn't ever land here unless a
    // caller invoked the adapter directly.
    const c = (context.destinationCountry || '').toUpperCase();
    if (c && c !== 'EU') return c;
    return null;
  }

  private blocked(line: LandedCostLineInput, reason: string): LineLandedCostResult {
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
      warnings: [reason],
      citations: [],
    };
  }
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}
