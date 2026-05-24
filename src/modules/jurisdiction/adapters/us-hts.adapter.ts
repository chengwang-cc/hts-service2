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
      identifier: b.chapter99HtsCode || undefined,
    }));

    let baseDuty = 0;
    let additionalTariffs = 0;
    let fees = 0;
    const taxes = 0;
    for (const b of row.breakdown) {
      if (b.componentType === 'base' || b.componentType === 'special' || b.componentType === 'non_ntr') {
        baseDuty += b.amount;
      } else if (b.componentType === 'mpf' || b.componentType === 'hmf') {
        fees += b.amount;
      } else if (b.componentType === 'post_tax') {
        // taxes are jurisdictional (US has none in calculator today)
        fees += b.amount;
      } else {
        additionalTariffs += b.amount;
      }
    }

    const totalDuty = baseDuty + additionalTariffs + fees + taxes;
    const landedCost = line.declaredValue + totalDuty;

    return {
      classification: {
        hs6: line.classificationCode.slice(0, 6),
        destinationCode: row.effectiveHtsCode || line.classificationCode,
      },
      baseDuty,
      additionalTariffs,
      fees,
      taxes,
      totalDuty,
      landedCost,
      components,
      warnings: row.blocked ? [row.blockReason || row.message] : [],
      citations: [],
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
