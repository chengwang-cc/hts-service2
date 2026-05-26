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
import { ExceptionRuleRunnerService } from '../exception-rules/exception-rule-runner.service';
import { ExceptionRuleRegistry } from '../exception-rules/exception-rule.registry';
import { RuleStatusService } from '../exception-rules/rule-status.service';
import type { ExceptionRuleRunResult } from '../exception-rules/types';
import { FormulaEvaluationService } from '../calculator/services/formula-evaluation.service';
import type { TariffFormulaComponent } from '../calculator/services/tariff-types';
import { CbamQuarterlySettlementService } from '../exception-rules/eu/cbam-quarterly-settlement.service';
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
    // Phase 1: exception-rule runner. Optional so existing tests that
    // build the service by hand don't have to thread it through; in
    // production the module wires it in. When absent, behavior is
    // identical to the pre-Phase-1 pipeline.
    @Optional() private readonly exceptionRules?: ExceptionRuleRunnerService,
    @Optional() private readonly exceptionRuleRegistry?: ExceptionRuleRegistry,
    @Optional() private readonly ruleStatus?: RuleStatusService,
    // D3 fix (2026-05-27): required to re-evaluate rule-emitted component
    // formulas and rebuild line totals. Optional so unit tests that
    // hand-build the service can omit it; when absent, the runner still
    // updates `result.components` but totals stay stale (logged warn).
    @Optional() private readonly formulaEval?: FormulaEvaluationService,
    // D7 fix (2026-05-27): persist per-line CBAM provisional cost so
    // the quarterly report aggregates across replicas + restarts.
    @Optional() private readonly cbamSettlement?: CbamQuarterlySettlementService,
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
    const exceptionRuns: ExceptionRuleRunResult[] = [];
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

      // P1.T7 — exception-rule runner pass. When no rule fires (the case
      // in Phase 1, which ships with an empty registry), `components`
      // come back unchanged and `firedRules` is empty, so totals don't
      // need recomputation.
      const ruleRun = await this.applyExceptionRules({
        result,
        request,
        lineRequest,
        destinationCode: dest.parentCode === 'EU' ? 'EU' : dest.code,
        memberStateCode: dest.parentCode === 'EU' ? dest.code : undefined,
      });
      exceptionRuns.push(ruleRun);
      if (ruleRun.firedRules.length > 0) {
        result.components = ruleRun.components;
        // D3 fix (2026-05-27): rule firing changed the component list,
        // so the totals computed by the adapter are now stale. Re-
        // evaluate every component's formula and rebuild the line
        // totals so the customer-visible payable matches the audit
        // breakdown.
        this.recomputeLineTotals(result, {
          declaredValue: lineRequest.unitValue * lineRequest.quantity,
          weight: lineRequest.weightKg,
          quantity: lineRequest.quantity,
          additionalInputs: lineRequest.additionalInputs ?? {},
          shipping: lineShipping,
          insurance: lineInsurance,
        });
      }

      lines.push({
        lineNumber: i + 1,
        sku: lineRequest.sku,
        description: lineRequest.description,
        request: lineRequest,
        result,
        // A3 fix (2026-05-26): echo the user's Chapter 99 selection
        // back so the FE can show it without re-deriving from the
        // (often-renamed) component identifiers.
        selectedChapter99Headings:
          lineRequest.selectedChapter99Headings &&
          lineRequest.selectedChapter99Headings.length > 0
            ? [...lineRequest.selectedChapter99Headings]
            : undefined,
      });
    }

    const totals = this.rollUp(lines);
    const sources = this.dedupeSources(lines.flatMap((l) => l.result.sources));
    // D5/G3 fix (2026-05-26): rule notes used to live only in the audit
    // snapshot. Surface user-facing notes ("CBAM default emissions
    // applied", "additionalInputs.X missing", etc.) in quote.warnings so
    // the FE breakdown panel can show them. The runner already collects
    // notes per fired rule under `ruleRun.notes[ruleId]`.
    const ruleNotes = exceptionRuns.flatMap((run) =>
      Object.entries(run.notes ?? {}).flatMap(([ruleId, notes]) =>
        (notes ?? []).filter((note) => isUserFacingNote(note)).map((note) => `[${ruleId}] ${note}`),
      ),
    );
    // F1 fix (2026-05-26): warn when shipping/insurance currencies
    // don't match the quote currency. Today the calculator treats the
    // amount as-is in the quote currency (no FX layer at this seam).
    // Surfacing a warning is the right user-facing contract until a
    // proper FX-aware allocation lands.
    const currencyWarnings = this.checkAuxiliaryCurrencies(request);
    // F2 fix (2026-05-26): the EU CBAM rule emits its provisional cost
    // as a literal EUR amount. When the quote currency isn't EUR the
    // total mixes currencies. Emit a warning so the FE can render the
    // CBAM line with its native-currency badge instead of silently
    // adding EUR to the quote-currency total.
    const cbamMixWarnings = this.checkCbamCurrencyMix(request, exceptionRuns);
    const nativeTaxMixWarnings = this.checkNativeCurrencyTaxMix(
      request,
      exceptionRuns,
    );
    const warnings = this.uniqueStrings([
      ...lines.flatMap((l) => l.result.warnings),
      ...ruleNotes,
      ...currencyWarnings,
      ...cbamMixWarnings,
      ...nativeTaxMixWarnings,
    ]);
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
    // Phase 1: thread exception-rule run results into the audit snapshot
    // so historical replay sees the exact rule-fire picture.
    const fxRecordId = await this.maybeRecordFx(quote, request);
    const ruleStatusSnapshot = await this.buildRuleStatusSnapshot();
    const auditSnapshot = this.audit?.recordAndLog(quote, fxRecordId, {
      exceptionRuleRuns: exceptionRuns,
      ruleStatusSnapshot,
    });

    // D7 fix (2026-05-27): for every line where the CBAM rule fired,
    // persist the per-line provisional contribution so the quarterly
    // report has real data.
    //
    // C1 fix (2026-05-26): the call used to be fire-and-forget (`void`),
    // which made persistence failures invisible to anyone reading the
    // quote response. Now we await: individual row failures are still
    // caught + logged inside the method (best-effort per row), but the
    // outer await guarantees the quarterly settlement row is written
    // before the response leaves the controller.
    await this.recordCbamProvisionalsForQuote(quote, exceptionRuns);

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

  /**
   * F1 fix (2026-05-26): produce user-facing warnings when the quote's
   * shipping or insurance currency differs from the quote currency.
   *
   * The calculator does NOT currently apply an FX conversion at this
   * seam — the auxiliary amounts flow through as-if they were in the
   * quote currency. Warning the user lets them fix the request or
   * accept the rough-pass calculation; staying silent is the failure
   * mode the deep code review called out.
   */
  private checkAuxiliaryCurrencies(
    request: CalculatorV2QuoteRequest,
  ): string[] {
    const quoteCurrency = (request.currency || '').toUpperCase();
    const out: string[] = [];
    const shippingCcy = request.shipping?.currency?.toUpperCase();
    if (
      shippingCcy &&
      shippingCcy !== quoteCurrency &&
      (request.shipping?.amount ?? 0) > 0
    ) {
      out.push(
        `shipping currency ${shippingCcy} differs from quote currency ${quoteCurrency}; treated as ${quoteCurrency} without FX conversion.`,
      );
    }
    const insuranceCcy = request.insurance?.currency?.toUpperCase();
    if (
      insuranceCcy &&
      insuranceCcy !== quoteCurrency &&
      (request.insurance?.amount ?? 0) > 0
    ) {
      out.push(
        `insurance currency ${insuranceCcy} differs from quote currency ${quoteCurrency}; treated as ${quoteCurrency} without FX conversion.`,
      );
    }
    return out;
  }

  /**
   * F2 fix (2026-05-26): emit a warning when CBAM fired in a quote
   * whose currency isn't EUR. The CBAM rule emits its provisional cost
   * as a literal EUR amount (`formula: "${eurAmount}"`), so adding it
   * into a non-EUR `totals.taxes` produces a currency-mixed total.
   *
   * The right long-term fix is per-component currency tagging + FX at
   * rollup; this warning keeps users informed in the meantime.
   */
  private checkCbamCurrencyMix(
    request: CalculatorV2QuoteRequest,
    exceptionRuns: ExceptionRuleRunResult[],
  ): string[] {
    const quoteCurrency = (request.currency || '').toUpperCase();
    if (quoteCurrency === 'EUR') return [];
    const cbamFired = exceptionRuns.some((run) =>
      run.firedRules.includes('eu.cbam.embedded-carbon'),
    );
    if (!cbamFired) return [];
    return [
      `CBAM provisional cost is denominated in EUR and is summed into totals.taxes (${quoteCurrency}) without FX conversion; the CBAM line is correct in EUR but the rolled-up taxes total mixes currencies.`,
    ];
  }

  /**
   * Wave 1+ (2026-05-26): emit a warning for every native-currency tax
   * rule the quote fires whose native currency differs from the quote
   * currency. Extends the CBAM F2 pattern to cover all 11 new
   * destinations' primary tax programs.
   *
   * Each entry: rule ID → native currency. Add new entries as future
   * native-currency tax rules ship. The "full FX layer" follow-up
   * (technical reference §10.1) will eventually replace these warnings
   * with proper component-level currency tagging.
   */
  private checkNativeCurrencyTaxMix(
    request: CalculatorV2QuoteRequest,
    exceptionRuns: ExceptionRuleRunResult[],
  ): string[] {
    const NATIVE_CCY_BY_RULE: Record<string, string> = {
      'jp.consumption-tax.standard': 'JPY',
      'mx.iva.standard': 'MXN',
      'cn.vat.import': 'CNY',
      'in.gst.igst-import': 'INR',
      'vn.vat.import': 'VND',
      'ph.vat.import': 'PHP',
      'id.ppn.import': 'IDR',
      'my.sales-tax.import': 'MYR',
      'th.vat.import': 'THB',
      'ae.vat.standard': 'AED',
      'br.ii.import-duty': 'BRL',
      'br.icms.state-rate': 'BRL',
    };
    const quoteCurrency = (request.currency || '').toUpperCase();
    const out: string[] = [];
    for (const run of exceptionRuns) {
      for (const ruleId of run.firedRules) {
        const native = NATIVE_CCY_BY_RULE[ruleId];
        if (!native) continue;
        if (native === quoteCurrency) continue;
        out.push(
          `${ruleId} amounts are denominated in ${native}; rolled into totals.taxes (${quoteCurrency}) without FX conversion.`,
        );
      }
    }
    return out;
  }

  private averageConfidence(lines: CalculatorV2QuoteLine[]): number {
    if (lines.length === 0) return 0;
    // G1/G2 fix (2026-05-26): guard against NaN propagation from a
    // single misbehaving adapter, and clamp the rolled-up score into
    // [0, 1]. A NaN in any line's score used to turn the whole quote's
    // confidence into NaN (rendered as `null` in JSON); a future
    // adapter overshooting 1.0 would have produced an out-of-range
    // score the FE couldn't render. Both are now safe.
    const sum = lines.reduce((acc, l) => {
      const s = l.result.confidence?.score;
      return acc + (typeof s === 'number' && Number.isFinite(s) ? s : 0);
    }, 0);
    const avg = sum / lines.length;
    const clamped = Math.max(0, Math.min(1, avg));
    return Math.round(clamped * 100) / 100;
  }

  /**
   * P1.T7 — run the exception-rule pipeline for one line.
   *
   * Returns an empty/passthrough run when the runner isn't wired (unit
   * tests build the service by hand) or when no rule is registered for
   * the destination. Failures inside the runner are logged but never
   * block the calculator response.
   */
  private async applyExceptionRules(args: {
    result: RichCalculationResult;
    request: CalculatorV2QuoteRequest;
    lineRequest: CalculatorV2LineRequest;
    destinationCode: string;
    memberStateCode?: string;
  }): Promise<ExceptionRuleRunResult> {
    const passthrough: ExceptionRuleRunResult = {
      components: args.result.components.slice(),
      firedRules: [],
      skippedByConflict: [],
      notes: {},
    };
    if (!this.exceptionRules) return passthrough;
    try {
      return await this.exceptionRules.run({
        htsCode: args.result.classification.effectiveCode,
        origin: (
          args.lineRequest.countryOfOrigin ||
          args.request.origin.country ||
          ''
        ).toUpperCase(),
        destination: args.destinationCode,
        destinationMemberState: args.memberStateCode,
        asOfDate: args.request.entryDate
          ? new Date(args.request.entryDate)
          : new Date(),
        declaredValue: args.lineRequest.unitValue * args.lineRequest.quantity,
        currency: args.request.currency,
        additionalInputs: args.lineRequest.additionalInputs ?? {},
        baseComponents: args.result.components,
      });
    } catch (e: any) {
      this.logger.warn(`exception-rule runner failed: ${e?.message ?? e}`);
      return passthrough;
    }
  }

  /**
   * P1.T8 helper — snapshot the enabled/disabled state of every
   * registered rule at quote time. Empty when no rules are registered.
   * Best-effort: a DB hiccup falls back to an empty map rather than
   * blocking the quote.
   */
  /**
   * D3 fix (2026-05-27): re-evaluate every component's formula and
   * rebuild the line's `totals` from scratch. Called after the
   * exception-rule runner mutates `result.components` so the customer-
   * visible payable matches the audit breakdown.
   *
   * componentType → totals bucket (matches the TariffComponentType
   * union in calculator/services/tariff-types.ts):
   *   base / special / non_ntr                          → baseDuty
   *   chapter_98 / chapter_99 / section_301 /
   *     section_232 / section_122                       → additionalDuties
   *   mpf / hmf                                         → fees
   *   post_tax                                          → taxes
   *   (any unrecognized componentType — defensive)      → additionalDuties
   *
   * B1 fix (2026-05-26): the prior comment mentioned a "tax" bucket
   * that doesn't exist in the union. Jurisdiction taxes (CBAM, AU LCT,
   * AU WET, KR special excise, etc.) all emit `post_tax` and land in
   * `totals.taxes`. The default branch is a safety net for future
   * additions — if a rule emits a never-before-seen componentType,
   * it lands in additionalDuties rather than disappearing.
   *
   * After bucket sums:
   *   totalCustomsDuty = baseDuty + additionalDuties
   *   borderPayable    = totalCustomsDuty + fees + taxes
   *   landedCost       = goodsValue + shipping + insurance + borderPayable
   *
   * Best-effort: if `formulaEval` is unavailable (test seam) or a
   * specific formula fails to parse, we log + skip that component
   * rather than blowing up the quote. The adjustment is bounded — at
   * worst the customer sees stale-totals + correct-breakdown, matching
   * pre-Sprint-1 behavior.
   */
  private recomputeLineTotals(
    result: RichCalculationResult,
    inputs: {
      declaredValue: number;
      weight?: number;
      quantity?: number;
      additionalInputs: Record<string, number | string | boolean>;
      shipping: number;
      insurance: number;
    },
  ): void {
    if (!this.formulaEval) {
      this.logger.warn(
        'recomputeLineTotals: FormulaEvaluationService unavailable; totals will be stale',
      );
      return;
    }

    const scope: Record<string, unknown> = {
      value: inputs.declaredValue,
      weight: inputs.weight ?? 0,
      quantity: inputs.quantity ?? 1,
      duty: 0,
      total: 0,
      // Phase-2+ exception-rule variables (aluminum_value, steel_value,
      // smelt-country flags, exporter_name, CBAM emissions, etc.).
      ...inputs.additionalInputs,
    };

    let baseDuty = 0;
    let additionalDuties = 0;
    let fees = 0;
    let taxes = 0;

    for (const c of result.components as TariffFormulaComponent[]) {
      const amount = this.evaluateComponentAmount(c, scope);
      if (!Number.isFinite(amount)) continue;
      switch (c.componentType) {
        case 'base':
        case 'special':
        case 'non_ntr':
          baseDuty += amount;
          break;
        case 'mpf':
        case 'hmf':
          fees += amount;
          break;
        case 'post_tax':
          // 'post_tax' is the generic bucket for jurisdiction taxes
          // (LCT, WET, KR special excise, CBAM provisional, etc.).
          taxes += amount;
          break;
        case 'chapter_98':
        case 'chapter_99':
        case 'section_301':
        case 'section_232':
        case 'section_122':
          additionalDuties += amount;
          break;
        default:
          // Defensive: if a rule ever emits a componentType not in the
          // union, log it so we can update the bucket map. The amount
          // still contributes — defaulting to additionalDuties is safer
          // than silently dropping it.
          this.logger.warn(
            `recomputeLineTotals: unknown componentType "${(c as any).componentType}" on identifier ${c.identifier ?? '?'}; bucketing into additionalDuties`,
          );
          additionalDuties += amount;
          break;
      }
    }

    const totalCustomsDuty = round2(baseDuty + additionalDuties);
    const fees2 = round2(fees);
    const taxes2 = round2(taxes);
    const baseDuty2 = round2(baseDuty);
    const additionalDuties2 = round2(additionalDuties);
    const borderPayable = round2(totalCustomsDuty + fees2 + taxes2);
    const goodsValue = result.totals.goodsValue;
    const shipping = round2(inputs.shipping);
    const insurance = round2(inputs.insurance);

    result.totals = {
      ...result.totals,
      baseDuty: baseDuty2,
      additionalDuties: additionalDuties2,
      totalCustomsDuty,
      fees: fees2,
      taxes: taxes2,
      borderPayable,
      shipping,
      insurance,
      landedCost: round2(goodsValue + shipping + insurance + borderPayable),
    };
  }

  /**
   * D7 fix (2026-05-27): iterate every line whose `firedRules` includes
   * `eu.cbam.embedded-carbon`, extract the CBAM component from the
   * line's components, parse its precomputed cost (the rule emits a
   * numeric literal in `formula`), and persist it via
   * `CbamQuarterlySettlementService.record()`. Errors are logged but
   * never propagate.
   */
  private async recordCbamProvisionalsForQuote(
    quote: CalculatorV2QuoteResult,
    exceptionRuns: ExceptionRuleRunResult[],
  ): Promise<void> {
    if (!this.cbamSettlement) return;
    for (let i = 0; i < quote.lines.length; i++) {
      const run = exceptionRuns[i];
      if (!run || !run.firedRules.includes('eu.cbam.embedded-carbon')) continue;
      const line = quote.lines[i];

      // C2/C3 fix (2026-05-26): prefer the rule's structured `data`
      // payload over regex-parsing notes / identifier suffixes. The
      // CBAM rule now publishes sector / certificates / defaultApplied
      // / provisionalCostEur as typed fields under
      // `run.data['eu.cbam.embedded-carbon']`. Legacy regex paths kept
      // as a fallback for rule versions that haven't migrated yet.
      const ruleData = (run.data?.['eu.cbam.embedded-carbon'] ?? {}) as Record<
        string,
        unknown
      >;
      const structuredSector =
        typeof ruleData.sector === 'string' ? (ruleData.sector as string) : null;
      const structuredCertificates =
        typeof ruleData.cbamCertificates === 'number'
          ? (ruleData.cbamCertificates as number)
          : null;
      const structuredCostEur =
        typeof ruleData.provisionalCostEur === 'number'
          ? (ruleData.provisionalCostEur as number)
          : null;
      const structuredDefaultApplied =
        typeof ruleData.defaultApplied === 'boolean'
          ? (ruleData.defaultApplied as boolean)
          : null;

      // Locate the CBAM component for the legacy paths + the formula
      // cost fallback when structuredCostEur is null.
      const cbamComponent = (
        line.result.components as TariffFormulaComponent[]
      ).find((c) => (c.identifier ?? '').startsWith('EU_CBAM_'));

      const provisionalCostEur =
        structuredCostEur ??
        (cbamComponent ? Number(cbamComponent.formula) : NaN);
      if (!Number.isFinite(provisionalCostEur)) continue;

      const sector =
        structuredSector ??
        (cbamComponent
          ? (cbamComponent.identifier ?? 'EU_CBAM_UNKNOWN')
              .replace(/^EU_CBAM_/, '')
              .toLowerCase()
          : 'unknown');

      let cbamCertificates: number;
      if (structuredCertificates !== null) {
        cbamCertificates = structuredCertificates;
      } else {
        const noteMatch = (run.notes['eu.cbam.embedded-carbon'] ?? [])
          .join(' ')
          .match(/certificates=([0-9.]+)/);
        cbamCertificates = noteMatch ? Number(noteMatch[1]) : 0;
      }

      const defaultApplied =
        structuredDefaultApplied ??
        /defaultApplied=true/.test(
          (run.notes['eu.cbam.embedded-carbon'] ?? []).join(' '),
        );

      try {
        await this.cbamSettlement.record({
          quoteId: quote.quoteId,
          htsCode: line.result.classification.effectiveCode,
          sector,
          defaultApplied,
          cbamCertificates,
          provisionalCostEur,
          observedAt: new Date(quote.generatedAt),
        });
      } catch (e: any) {
        this.logger.warn(`cbam.record failed: ${e?.message ?? e}`);
      }
    }
  }

  /**
   * Evaluate a single component's formula against the line scope.
   * Returns NaN when the evaluator can't resolve the formula — caller
   * skips it.
   */
  private evaluateComponentAmount(
    c: TariffFormulaComponent,
    scope: Record<string, unknown>,
  ): number {
    if (!this.formulaEval) return NaN;
    if (!c.formula) return 0;
    try {
      const { amount } = this.formulaEval.evaluateWithConstraints(
        c.formula,
        scope,
        c.constraints ?? { rounding: 'component_2dp' },
      );
      return amount;
    } catch (e: any) {
      this.logger.warn(
        `recomputeLineTotals: failed to evaluate "${c.formula}" (id=${c.identifier ?? '?'}): ${e?.message ?? e}`,
      );
      return NaN;
    }
  }

  private async buildRuleStatusSnapshot(): Promise<Record<string, boolean>> {
    if (!this.exceptionRuleRegistry) return {};
    const rules = this.exceptionRuleRegistry.all();
    if (rules.length === 0) return {};
    if (!this.ruleStatus) {
      // Rules ship enabled by default; without the status service we
      // can only report that default.
      const fallback: Record<string, boolean> = {};
      for (const r of rules) fallback[r.id] = true;
      return fallback;
    }
    try {
      return await this.ruleStatus.bulkStatus(rules.map((r) => r.id));
    } catch {
      return {};
    }
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

/**
 * D5/G3 (2026-05-26): determine whether a rule note should be surfaced
 * to the user via quote.warnings, vs kept in the audit-only payload.
 *
 * Telemetry-flavored notes (`category=X units=N`, `russia-or-unknown
 * branch: …`, `list 1 matched 9903.88.01`) are internal — they say
 * which code path ran but carry no actionable signal. User-facing notes
 * (defaults applied, missing/invalid inputs) DO matter.
 *
 * We use a denylist of common telemetry shapes so adding a new
 * user-facing note in a rule (just a sentence) gets surfaced by default
 * without per-rule plumbing.
 */
function isUserFacingNote(note: string): boolean {
  if (!note || typeof note !== 'string') return false;
  const trimmed = note.trim();
  if (trimmed.length === 0) return false;
  // Hide pure key=value telemetry strings, branch markers, and
  // "matched X" lines. These are useful for audit but not for the
  // border-payable summary.
  if (/^[a-z0-9_-]+(=[\w.-]+\s?)+$/i.test(trimmed)) return false;
  if (/branch:?\s/.test(trimmed)) return false;
  if (/^list\s+\w+\s+matched\b/i.test(trimmed)) return false;
  if (/^no AD\/CVD order/i.test(trimmed)) return false;
  if (/^usmca qualifying preferential/i.test(trimmed)) return false;
  return true;
}
