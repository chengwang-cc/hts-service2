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
} from '../interfaces/tariff-jurisdiction-adapter.interface';
import { TariffFormulaResolverService } from '../../calculator/services/tariff-formula-resolver.service';
import { TariffRateBatchService } from '../../calculator/services/tariff-rate-batch.service';
import {
  FormulaVariable,
  ResolveFormulaResult,
  SourceCitationRef,
} from '../../calculator/services/tariff-types';

/**
 * UsHtsAdapter
 *
 * Wraps the existing US HTS engine (TariffFormulaResolver +
 * TariffRateBatchService) so that the new AdapterRegistry can dispatch
 * to it for destination='US'.
 */
@Injectable()
export class UsHtsAdapter implements TariffJurisdictionAdapter {
  readonly jurisdictionCode = 'US';

  constructor(
    private readonly resolver: TariffFormulaResolverService,
    private readonly batch: TariffRateBatchService,
  ) {}

  supports(destination: DestinationContext): boolean {
    return (destination.country || '').toUpperCase() === 'US';
  }

  async ingestLatest(_jobContext: IngestionJobContext): Promise<IngestionResult> {
    // The actual USITC ingestion runs from the existing
    // HtsImportJobHandler queue. This adapter does not own the schedule;
    // it just records what's been ingested.
    return {
      snapshotId: 'us-hts-current',
      rowCount: 0,
      rejectedCount: 0,
      warnings: ['US ingestion runs via admin/hts-imports job pipeline'],
    };
  }

  async classifyCode(_input: ClassificationInput): Promise<ClassificationCandidate[]> {
    // Classification is delegated to the classification module in P2; for
    // now return empty so the resolver's "no fallback" path is explicit.
    return [];
  }

  async getMeasures(input: MeasureLookupInput): Promise<TariffMeasure[]> {
    const resolved = await this.resolver.resolve({
      htsNumber: input.classificationCode,
      countryOfOrigin: input.countryOfOrigin,
      destinationCountry: 'US',
      entryDate: input.entryDate,
      certificate: input.certificate,
      selectedChapter99Headings: input.selectedChapter99Headings,
    });

    return resolved.components.map<TariffMeasure>((c) => ({
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
    const result = await this.batch.batchCalculate([
      {
        htsCode: line.classificationCode,
        country: line.countryOfOrigin,
        inputs: {
          value: line.declaredValue,
          weight: line.weightKg ?? 0,
          quantity: line.quantity ?? 0,
          ...(line.additionalInputs || {}),
        },
        entryDate: context.entryDate,
      },
    ]);
    const row = result[0];

    const components = row.breakdown.map((b) => ({
      componentType: b.componentType,
      amount: b.amount,
      formula: b.formula,
      identifier: b.chapter99HtsCode || b.identifier || undefined,
    }));

    let baseDuty = 0;
    let additionalTariffs = 0;
    let fees = 0;
    let taxes = 0;
    for (const b of row.breakdown) {
      if (b.componentType === 'base' || b.componentType === 'special' || b.componentType === 'non_ntr') {
        baseDuty += b.amount;
      } else if (b.componentType === 'mpf' || b.componentType === 'hmf') {
        fees += b.amount;
      } else if (b.componentType === 'post_tax') {
        // US calculator does not currently emit true taxes, but if a card
        // is upgraded to post-duty tax the amount lands in `taxes`, not in
        // `fees`. Previously this was silently bucketed into fees, which
        // distorted both the per-line fees number and the rolled-up totals.
        taxes += b.amount;
      } else {
        additionalTariffs += b.amount;
      }
    }

    // Customs duty total — base + additional only. MPF/HMF and taxes are
    // reported separately. Older code summed everything into `totalDuty`,
    // which is the bug the new calculator-v2 vocabulary fixes.
    const totalCustomsDuty = baseDuty + additionalTariffs;
    const borderPayable = totalCustomsDuty + fees + taxes;
    const shippingAllocated = context.shippingAmount ?? 0;
    const insuranceAllocated = context.insuranceAmount ?? 0;
    const landedCost =
      line.declaredValue + shippingAllocated + insuranceAllocated + borderPayable;

    return {
      classification: {
        hs6: line.classificationCode.slice(0, 6),
        destinationCode: row.effectiveHtsCode || line.classificationCode,
      },
      baseDuty,
      additionalTariffs,
      additionalDuties: additionalTariffs,
      fees,
      taxes,
      totalDuty: totalCustomsDuty,
      totalCustomsDuty,
      borderPayable,
      shippingAllocated,
      insuranceAllocated,
      landedCost,
      components,
      warnings: row.blocked ? [row.blockReason || row.message] : [],
      citations: row.sources ?? [],
    };
  }

  async getRequiredInputs(classification: string): Promise<FormulaVariable[]> {
    const result = await this.resolver.resolve({
      htsNumber: classification,
      countryOfOrigin: 'CN', // arbitrary — we only need the variable set
      destinationCountry: 'US',
    });
    return result.allRequiredVariables;
  }

  async getSourceCitations(
    input: MeasureLookupInput,
  ): Promise<SourceCitationRef[]> {
    const measures = await this.getMeasures(input);
    return measures.map((m) => m.sourceCitation);
  }

  async resolveFormula(
    input: MeasureLookupInput,
  ): Promise<ResolveFormulaResult> {
    return this.resolver.resolve({
      htsNumber: input.classificationCode,
      countryOfOrigin: input.countryOfOrigin,
      destinationCountry: 'US',
      entryDate: input.entryDate,
      certificate: input.certificate,
      selectedChapter99Headings: input.selectedChapter99Headings,
    });
  }
}
