import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdapterRegistry } from '../jurisdiction/services/adapter-registry.service';
import { JurisdictionService } from '../jurisdiction/services/jurisdiction.service';
import type {
  LandedCostLineInput,
  RichCalculationResult,
  ShipmentContext,
  TariffJurisdictionAdapter,
  CalculatorTotals,
  JurisdictionFacts,
} from '../jurisdiction/interfaces/tariff-jurisdiction-adapter.interface';
import type { SourceCitationRef } from '../calculator/services/tariff-types';
import { JurisdictionFactsService } from './jurisdiction-facts.service';
import { FxRecordService } from './fx-record.service';
import { FxRateProviderService } from './fx-rate-provider.service';
import { CalculatorV2AuditService, AuditSnapshot } from './calculator-v2-audit.service';
import { CalculationHistoryService } from '../public-api/shared/calculation-history.service';
import {
  CalculatorV2CallerContext,
  CalculatorV2LineRequest,
  CalculatorV2QuoteLine,
  CalculatorV2QuoteRequest,
  CalculatorV2QuoteResult,
  lineLandedCostResultToRich,
  scoreToLabel,
} from './calculator-v2-quote.types';

/**
 * CalculatorV2QuoteService
 *
 * Phase A entry point for the unified multi-country calculator. Takes a
 * `CalculatorV2QuoteRequest`, picks the correct jurisdiction adapter for
 * the destination, runs every line through that adapter, rolls up the
 * results into top-level totals, attaches per-destination
 * `jurisdictionFacts`, and returns a `CalculatorV2QuoteResult`.
 *
 * Adapters that implement `calculateRich()` directly are used as-is;
 * adapters that haven't migrated are adapted via `lineLandedCostResultToRich()`.
 *
 * The service is intentionally storage-free — history persistence is a
 * follow-up. This keeps Phase A reviewable as a single concern.
 */
@Injectable()
export class CalculatorV2QuoteService {
  private readonly logger = new Logger(CalculatorV2QuoteService.name);
  private static readonly ENGINE_VERSION = 'hts-native-v2-quote';

  constructor(
    private readonly adapters: AdapterRegistry,
    private readonly jurisdictions: JurisdictionService,
    private readonly facts: JurisdictionFactsService,
    // Phase F audit + FX are best-effort: optional dependencies so tests
    // that build the service by hand don't need to thread them through.
    @Optional() private readonly fxRecord?: FxRecordService,
    @Optional() private readonly audit?: CalculatorV2AuditService,
    @Optional() private readonly fxProvider?: FxRateProviderService,
    @Optional() private readonly history?: CalculationHistoryService,
  ) {}

  async quote(
    request: CalculatorV2QuoteRequest,
    caller: CalculatorV2CallerContext = {},
  ): Promise<CalculatorV2QuoteResult> {
    if (!request.items || request.items.length === 0) {
      throw new Error('CalculatorV2QuoteRequest.items must contain at least one line.');
    }

    const dest = await this.jurisdictions.resolveDestination({
      country: request.destination.country,
      memberState: request.destination.memberState,
    });

    // EU sub-routing: when country='DE' the destination resolves under EU.
    const adapterDestination = {
      country: dest.parentCode === 'EU' ? 'EU' : dest.code,
      memberState: dest.parentCode === 'EU' ? dest.code : undefined,
    };
    const adapter = this.adapters.pickForDestination(adapterDestination);

    // Per-line shipping/insurance allocation: proportional by goods value.
    // Single-line shipments get the full allocation; future multi-line
    // payloads need this split so totals reconcile.
    const totalGoodsValue = request.items.reduce(
      (s, i) => s + i.unitValue * i.quantity,
      0,
    );
    const totalShipping = request.shipping?.amount ?? 0;
    const totalInsurance = request.insurance?.amount ?? 0;

    const lines: CalculatorV2QuoteLine[] = [];
    for (let i = 0; i < request.items.length; i++) {
      const lineRequest = request.items[i];
      const lineGoodsValue = lineRequest.unitValue * lineRequest.quantity;
      const allocationFactor =
        totalGoodsValue > 0 ? lineGoodsValue / totalGoodsValue : 1;
      const lineShipping = totalShipping * allocationFactor;
      const lineInsurance = totalInsurance * allocationFactor;

      const result = await this.calculateLine({
        adapter,
        request,
        lineRequest,
        lineShipping,
        lineInsurance,
        destinationCode: dest.parentCode === 'EU' ? 'EU' : dest.code,
        memberStateCode: dest.parentCode === 'EU' ? dest.code : undefined,
      });

      lines.push({
        lineNumber: i + 1,
        sku: lineRequest.sku,
        description: lineRequest.description,
        request: lineRequest,
        result,
      });
    }

    const totals = this.rollUp(lines);
    const sources = this.dedupeSources(lines.flatMap((l) => l.result.sources));
    const warnings = this.uniqueStrings(
      lines.flatMap((l) => l.result.warnings),
    );
    const assumptions = this.uniqueStrings(
      lines.flatMap((l) => l.result.assumptions),
    );
    const firstFacts = lines[0]?.result.jurisdictionFacts;
    const score = this.averageConfidence(lines);

    const quote: CalculatorV2QuoteResult = {
      quoteId: `quote_${randomUUID()}`,
      engineVersion: CalculatorV2QuoteService.ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      destination: {
        country: dest.parentCode === 'EU' ? 'EU' : dest.code,
        memberState: dest.parentCode === 'EU' ? dest.code : undefined,
      },
      origin: { country: (request.origin.country || '').toUpperCase() },
      currency: request.currency,
      entryDate: request.entryDate,
      lines,
      totals,
      sources,
      jurisdictionFacts: firstFacts!,
      warnings,
      assumptions,
      confidence: {
        score,
        label: scoreToLabel(score),
      },
    };

    // Phase F: record FX (when cross-currency) + audit snapshot. Both are
    // best-effort — failures never block the calculator response.
    const fxRecordId = await this.maybeRecordFx(quote, request);
    const auditSnapshot = this.audit?.recordAndLog(quote, fxRecordId);

    // Persist a CalculationHistory row when we have a caller org. Best-
    // effort: any write failure is logged but never propagated.
    if (this.history && caller.organizationId) {
      void this.persistHistory({
        quote,
        request,
        caller,
        auditSnapshot: auditSnapshot ? { ...auditSnapshot } : undefined,
      });
    }

    return quote;
  }

  private async persistHistory(args: {
    quote: CalculatorV2QuoteResult;
    request: CalculatorV2QuoteRequest;
    caller: CalculatorV2CallerContext;
    auditSnapshot?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.history || !args.caller.organizationId) return;
    try {
      await this.history.write({
        organizationId: args.caller.organizationId,
        userId: args.caller.userId ?? null,
        input: {
          // Flatten the first line into the legacy `inputs` shape so old
          // history consumers keep working; full request goes in `audit`.
          htsNumber: args.quote.lines[0]?.result.classification.effectiveCode ?? '',
          countryOfOrigin: args.request.origin.country,
          declaredValue: args.quote.totals.goodsValue,
          currency: args.request.currency,
          entryDate: args.request.entryDate,
          additionalInputs: args.request as unknown as Record<string, unknown>,
        },
        result: {
          calculationId: args.quote.quoteId,
          quoteId: args.quote.quoteId,
          totals: args.quote.totals,
          breakdown: args.quote.lines.map((l) => l.result),
          warnings: args.quote.warnings,
        },
        source: 'hts_native_v2_quote',
        audit: args.auditSnapshot ?? null,
      });
    } catch (e: any) {
      this.logger.warn(`persistHistory failed: ${e?.message}`);
    }
  }

  /**
   * Snapshot the FX rate used by the destination's jurisdiction when the
   * request currency differs from the destination's local currency.
   *
   * Resolves the rate in this order:
   *   1. `FxRateProviderService.fetchRate()` (real upstream — frankfurter.app
   *      by default). 5-minute cache; 2.5s timeout.
   *   2. If the upstream fails / is unavailable, fall back to `rate=1`
   *      tagged `provider=adapter_inline_fallback`. The audit log still
   *      captures the cross-currency event so the absence of a real rate
   *      is visible after the fact.
   *
   * Returns the recorded FxRecord (or null) so callers can thread the
   * record id into the audit snapshot.
   */
  private async maybeRecordFx(
    quote: CalculatorV2QuoteResult,
    request: CalculatorV2QuoteRequest,
  ): Promise<string | null> {
    if (!this.fxRecord) return null;
    const requestCurrency = (request.currency || '').toUpperCase();
    const destinationCurrency = (quote.jurisdictionFacts?.currency || '').toUpperCase();
    if (!requestCurrency || !destinationCurrency) return null;
    if (requestCurrency === destinationCurrency) return null;

    let rate = 1;
    let provider = 'adapter_inline_fallback';
    if (this.fxProvider) {
      const lookup = await this.fxProvider.fetchRate(
        requestCurrency,
        destinationCurrency,
      );
      if (lookup) {
        rate = lookup.rate;
        provider = lookup.provider;
      } else {
        this.logger.warn(
          `fx provider returned null for ${requestCurrency}->${destinationCurrency}; using fallback rate=1`,
        );
      }
    }

    try {
      const record = await this.fxRecord.record({
        quoteId: quote.quoteId,
        fromCurrency: requestCurrency,
        toCurrency: destinationCurrency,
        rate,
        provider,
      });
      return record?.id ?? null;
    } catch (e: any) {
      this.logger.warn(`maybeRecordFx failed: ${e?.message}`);
      return null;
    }
  }

  private async calculateLine(args: {
    adapter: TariffJurisdictionAdapter;
    request: CalculatorV2QuoteRequest;
    lineRequest: CalculatorV2LineRequest;
    lineShipping: number;
    lineInsurance: number;
    destinationCode: string;
    memberStateCode?: string;
  }): Promise<RichCalculationResult> {
    const { adapter, request, lineRequest } = args;
    const originForLine = (
      lineRequest.countryOfOrigin ||
      request.origin.country ||
      ''
    ).toUpperCase();
    const declaredValue = lineRequest.unitValue * lineRequest.quantity;

    const lineInput: LandedCostLineInput = {
      classificationCode: lineRequest.classificationCode,
      countryOfOrigin: originForLine,
      declaredValue,
      currency: request.currency,
      weightKg: lineRequest.weightKg,
      quantity: lineRequest.quantity,
      additionalInputs: {
        ...(lineRequest.additionalInputs || {}),
        ...(lineRequest.selectedChapter99Headings
          ? { chapter99Headings: 1 } // marker so future tariffs can read selection
          : {}),
      },
    };
    const shipmentContext: ShipmentContext = {
      destinationCountry: args.destinationCode,
      destinationMemberState: args.memberStateCode,
      entryDate: request.entryDate,
      incoterm: request.incoterm,
      shippingAmount: args.lineShipping,
      insuranceAmount: args.lineInsurance,
      buyerType: request.buyerType,
      shipFromCountry: request.origin.shipFromCountry,
    };

    const jurisdictionFacts = this.facts.build({
      destinationCountry: args.destinationCode,
      destinationMemberState: args.memberStateCode,
      originCountry: originForLine,
      goodsValue: declaredValue,
      currency: request.currency,
      entryDate: request.entryDate,
    });

    if (adapter.calculateRich) {
      const rich = await adapter.calculateRich(lineInput, shipmentContext);
      return {
        ...rich,
        jurisdictionFacts: {
          ...jurisdictionFacts,
          ...rich.jurisdictionFacts,
        },
      };
    }

    const legacy = await adapter.calculate(lineInput, shipmentContext);
    return lineLandedCostResultToRich(legacy, {
      requestedHsCode: lineRequest.classificationCode,
      declaredValue,
      shipping: args.lineShipping,
      insurance: args.lineInsurance,
      jurisdictionFacts,
    });
  }

  private rollUp(lines: CalculatorV2QuoteLine[]): CalculatorTotals {
    const sum = (pick: (t: CalculatorTotals) => number) =>
      lines.reduce((acc, l) => acc + pick(l.result.totals), 0);
    return {
      goodsValue: round2(sum((t) => t.goodsValue)),
      customsValue: round2(sum((t) => t.customsValue)),
      baseDuty: round2(sum((t) => t.baseDuty)),
      additionalDuties: round2(sum((t) => t.additionalDuties)),
      totalCustomsDuty: round2(sum((t) => t.totalCustomsDuty)),
      fees: round2(sum((t) => t.fees)),
      taxes: round2(sum((t) => t.taxes)),
      borderPayable: round2(sum((t) => t.borderPayable)),
      shipping: round2(sum((t) => t.shipping)),
      insurance: round2(sum((t) => t.insurance)),
      landedCost: round2(sum((t) => t.landedCost)),
    };
  }

  private dedupeSources(citations: SourceCitationRef[]): SourceCitationRef[] {
    const seen = new Map<string, SourceCitationRef>();
    for (const c of citations) {
      const key = `${c.source}|${c.rowIdentifier ?? ''}|${c.url ?? ''}`;
      if (!seen.has(key)) seen.set(key, c);
    }
    return Array.from(seen.values());
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
  }

  private averageConfidence(lines: CalculatorV2QuoteLine[]): number {
    if (lines.length === 0) return 0;
    const sum = lines.reduce((acc, l) => acc + (l.result.confidence?.score ?? 0), 0);
    return Math.round((sum / lines.length) * 100) / 100;
  }

  /**
   * Exposed for higher-level orchestration (e.g. multi-jurisdiction "ship to
   * any of these" callers) — picks an adapter without running a quote.
   */
  resolveAdapter(destination: { country: string; memberState?: string }): TariffJurisdictionAdapter {
    return this.adapters.pickForDestination(destination);
  }

  /**
   * Exposed for the same higher-level orchestration — builds facts without
   * running a quote. Useful for previews / form-side jurisdictionFacts hints.
   */
  factsFor(args: {
    destinationCountry: string;
    destinationMemberState?: string;
    originCountry: string;
    goodsValue: number;
    currency: string;
    entryDate?: string;
  }): JurisdictionFacts {
    return this.facts.build(args);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
