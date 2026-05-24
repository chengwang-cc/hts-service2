import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { LandedCostQuoteEntity } from '../entities/landed-cost-quote.entity';
import { LandedCostLineEntity } from '../entities/landed-cost-line.entity';
import { AdapterRegistry } from '../../jurisdiction/services/adapter-registry.service';
import {
  JurisdictionService,
  EuMemberStateRequiredError,
  UnsupportedJurisdictionError,
} from '../../jurisdiction/services/jurisdiction.service';
import { LandedCostQuoteRequestDto } from '../dto/quote-request.dto';
import { CurrencyConversionService } from './currency-conversion.service';
import { IncompleteCodeFallbackService } from './incomplete-code-fallback.service';
import { ClassifyService } from '../../classification/services/classify.service';
import { CatalogService } from '../../catalog/services/catalog.service';

export interface LandedCostQuoteResponse {
  quoteId: string;
  status: string;
  confidence: number;
  destination: { country: string; memberState?: string };
  currency: string;
  expiresAt: string;
  totals: {
    goods: number;
    shipping: number;
    insurance: number;
    duty: number;
    tax: number;
    fees: number;
    landedCost: number;
  };
  lines: Array<{
    sku?: string;
    classification: {
      hs6: string;
      destinationCode: string;
      source: string;
    };
    duties: Array<{ type: string; amount: number; formula: string }>;
    taxes: Array<{ type: string; amount: number }>;
    fees: Array<{ type: string; amount: number }>;
    controls: Array<{ type: string; severity: string; description?: string }>;
    warnings: string[];
    sourceCitations: Array<Record<string, any>>;
    requiredInputs?: string[];
  }>;
  assumptions: string[];
  missingInputs: string[];
  warnings: string[];
}

@Injectable()
export class LandedCostService {
  private readonly logger = new Logger(LandedCostService.name);
  private readonly defaultQuoteTtlSeconds = 24 * 60 * 60; // 24h

  constructor(
    @InjectRepository(LandedCostQuoteEntity)
    private readonly quoteRepo: Repository<LandedCostQuoteEntity>,
    @InjectRepository(LandedCostLineEntity)
    private readonly lineRepo: Repository<LandedCostLineEntity>,
    private readonly jurisdictions: JurisdictionService,
    private readonly adapters: AdapterRegistry,
    private readonly fx: CurrencyConversionService,
    private readonly fallback: IncompleteCodeFallbackService,
    private readonly classify: ClassifyService,
    private readonly catalog: CatalogService,
  ) {}

  async createQuote(args: {
    organizationId: string;
    apiKeyId?: string;
    idempotencyKey?: string;
    request: LandedCostQuoteRequestDto;
  }): Promise<LandedCostQuoteResponse> {
    const { organizationId, request } = args;
    const fingerprint = this.computeFingerprint(request);

    // Idempotency check
    if (args.idempotencyKey) {
      const existing = await this.quoteRepo.findOne({
        where: { organizationId, idempotencyKey: args.idempotencyKey },
      });
      if (existing) {
        if (existing.requestFingerprint && existing.requestFingerprint !== fingerprint) {
          const e: any = new Error('IDEMPOTENCY_FINGERPRINT_MISMATCH');
          e.code = 'IDEMPOTENCY_FINGERPRINT_MISMATCH';
          e.status = 409;
          throw e;
        }
        return existing.responseJson as LandedCostQuoteResponse;
      }
    }

    // Resolve destination jurisdiction (throws for EU without memberState).
    let destination: {
      country: string;
      memberState?: string;
      calculationCurrency: string;
    };
    try {
      const dest = await this.jurisdictions.resolveDestination({
        country: request.destination.country,
        memberState: request.destination.memberState,
      });
      destination = {
        country: dest.parentCode === 'EU' ? 'EU' : dest.code,
        memberState: dest.parentCode === 'EU' ? dest.code : undefined,
        calculationCurrency: dest.currencyCode,
      };
    } catch (e: any) {
      if (e instanceof EuMemberStateRequiredError) {
        const err: any = new Error(e.message);
        err.code = e.code;
        err.status = 400;
        throw err;
      }
      if (e instanceof UnsupportedJurisdictionError) {
        const err: any = new Error(e.message);
        err.code = e.code;
        err.status = 400;
        throw err;
      }
      throw e;
    }

    // Pick the adapter for the destination. EU member states route to
    // the EU adapter even though it's registered under 'EU' (see
    // AdapterRegistry.pickForDestination iteration fallback).
    const adapter = this.adapters.pickForDestination({
      country: destination.memberState || destination.country,
      memberState: destination.memberState,
    });

    const lines: LandedCostQuoteResponse['lines'] = [];
    const warnings: string[] = [];
    const assumptions: string[] = [];
    const missingInputs: string[] = [];
    let totalGoods = 0;
    let totalDuty = 0;
    let totalAdditional = 0;
    let totalFees = 0;
    let totalTaxes = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;
    let exchangeRateSnapshotId: string | null = null;

    const requestCurrency = (request.currency || 'USD').toUpperCase();
    const calculationCurrency = (
      destination.calculationCurrency || requestCurrency
    ).toUpperCase();
    const rawLineGoods = request.items.map(
      (item) => item.unitValue * item.quantity,
    );
    const rawGoodsTotal = rawLineGoods.reduce((sum, value) => sum + value, 0);

    const convertToCalculationCurrency = async (
      amount: number,
      fromCurrency: string,
      label: string,
    ): Promise<number> => {
      const converted = await this.fx.convert({
        from: fromCurrency,
        to: calculationCurrency,
        amount,
        effectiveDate: request.entryDate,
      });
      if (converted.snapshotId && !exchangeRateSnapshotId) {
        exchangeRateSnapshotId = converted.snapshotId;
      }
      if (converted.warning) {
        warnings.push(`${label}:${converted.warning}`);
      }
      return converted.amount;
    };

    const convertFromCalculationCurrency = async (
      amount: number,
      label: string,
    ): Promise<number> => {
      const converted = await this.fx.convert({
        from: calculationCurrency,
        to: requestCurrency,
        amount,
        effectiveDate: request.entryDate,
      });
      if (converted.snapshotId && !exchangeRateSnapshotId) {
        exchangeRateSnapshotId = converted.snapshotId;
      }
      if (converted.warning) {
        warnings.push(`${label}:${converted.warning}`);
      }
      return converted.amount;
    };

    for (let itemIndex = 0; itemIndex < request.items.length; itemIndex++) {
      const item = request.items[itemIndex];
      let hsCode = item.hsCode || item.destinationCode;
      let classificationSource: 'provided' | 'catalog' | 'auto' | 'fallback' =
        hsCode ? 'provided' : 'auto';

      // Catalog fallback by productId / sku
      if (!hsCode && (item.productId || item.sku)) {
        if (item.productId) {
          const cls = await this.catalog.findFreshClassification(
            item.productId,
            destination.memberState || destination.country,
          );
          if (cls) {
            hsCode = cls.destinationCode;
            classificationSource = 'catalog';
          }
        }
        if (!hsCode && item.sku) {
          const hit = await this.catalog.findVariantBySku(
            organizationId,
            item.sku,
          );
          if (hit?.product?.defaultHsCode) {
            hsCode = hit.product.defaultHsCode;
            classificationSource = 'catalog';
          }
        }
      }

      // Classify-if-missing
      if (!hsCode && request.fallbackPolicy?.classifyIfMissing) {
        const c = await this.classify.classify(organizationId, {
          description: item.description,
          category: item.category,
          countryOfOrigin: item.countryOfOrigin,
          destinationCountry: destination.memberState || destination.country,
          productId: item.productId,
        });
        if (c.recommended.destinationCode) {
          hsCode = c.recommended.destinationCode;
          classificationSource = 'auto';
          warnings.push(
            `AUTO_CLASSIFIED sku=${item.sku ?? '?'} -> ${hsCode} (confidence ${c.recommended.confidence})`,
          );
        }
      }

      // 6-digit incomplete fallback
      let confidencePenalty = 0;
      if (hsCode && hsCode.replace(/\D/g, '').length === 6) {
        const mode = request.fallbackPolicy?.tariffSelectionMode || 'preferred';
        const f = await this.fallback.selectDeepCode({
          hs6: hsCode,
          destinationCountry: destination.memberState || destination.country,
          mode,
        });
        if (f.htsNumber) {
          hsCode = f.htsNumber;
          classificationSource = 'fallback';
          confidencePenalty = f.confidencePenalty;
        }
        if (f.warning) warnings.push(f.warning);
      }

      if (!hsCode) {
        missingInputs.push(`item[${item.sku ?? '?'}].hsCode`);
        lines.push({
          sku: item.sku,
          classification: { hs6: '', destinationCode: '', source: 'none' },
          duties: [],
          taxes: [],
          fees: [],
          controls: [],
          warnings: ['NO_HS_CODE'],
          sourceCitations: [],
        });
        continue;
      }

      try {
        const rawGoods = rawLineGoods[itemIndex] ?? 0;
        const allocationShare =
          rawGoodsTotal > 0 ? rawGoods / rawGoodsTotal : 1 / request.items.length;
        const rawShippingAllocation =
          (request.shipping?.amount ?? 0) * allocationShare;
        const rawInsuranceAllocation =
          (request.insurance?.amount ?? 0) * allocationShare;
        const declaredValue = await convertToCalculationCurrency(
          rawGoods,
          requestCurrency,
          `item[${item.sku ?? itemIndex}].value`,
        );
        const shippingAmount = request.shipping
          ? await convertToCalculationCurrency(
              rawShippingAllocation,
              request.shipping.currency,
              `item[${item.sku ?? itemIndex}].shipping`,
            )
          : 0;
        const insuranceAmount = request.insurance
          ? await convertToCalculationCurrency(
              rawInsuranceAllocation,
              request.insurance.currency,
              `item[${item.sku ?? itemIndex}].insurance`,
            )
          : 0;

        const result = await adapter.calculate(
          {
            classificationCode: hsCode,
            countryOfOrigin: item.countryOfOrigin,
            declaredValue,
            currency: calculationCurrency,
            weightKg:
              item.weightKg !== undefined
                ? item.weightKg * item.quantity
                : undefined,
            quantity: item.quantity,
            additionalInputs: this.flattenAdditionalInputs(item.additionalInputs),
          },
          {
            destinationCountry: destination.country,
            destinationMemberState: destination.memberState,
            destinationRegion: request.destination.region,
            entryDate: request.entryDate,
            incoterm: request.calculationMethod,
            shippingAmount,
            insuranceAmount,
            buyerType: request.buyer?.type,
            buyerTaxId: request.buyer?.taxId,
            sellerIossNumber: request.seller?.iossNumber,
            sellerIsMarketplace: request.seller?.isMarketplace,
            sellerHasDestinationTaxRegistration:
              this.hasSellerTaxRegistrationForDestination(request, destination),
            shipFromCountry: request.origin?.shipFromCountry || request.origin?.country,
          },
        );

        const goods = rawGoods;
        const baseDuty = await convertFromCalculationCurrency(
          result.baseDuty,
          `item[${item.sku ?? itemIndex}].baseDuty`,
        );
        const additionalTariffs = await convertFromCalculationCurrency(
          result.additionalTariffs,
          `item[${item.sku ?? itemIndex}].additionalTariffs`,
        );
        const fees = await convertFromCalculationCurrency(
          result.fees,
          `item[${item.sku ?? itemIndex}].fees`,
        );
        const taxes = await convertFromCalculationCurrency(
          result.taxes,
          `item[${item.sku ?? itemIndex}].taxes`,
        );
        const convertedComponents = await Promise.all(
          result.components.map(async (component) => ({
            ...component,
            amount: await convertFromCalculationCurrency(
              component.amount,
              `item[${item.sku ?? itemIndex}].component.${component.identifier ?? component.componentType}`,
            ),
          })),
        );

        totalGoods += goods;
        totalDuty += baseDuty;
        totalAdditional += additionalTariffs;
        totalFees += fees;
        totalTaxes += taxes;
        const conf = Math.max(0, 1 - confidencePenalty);
        confidenceSum += conf;
        confidenceCount++;

        lines.push({
          sku: item.sku,
          classification: {
            hs6: result.classification.hs6,
            destinationCode: result.classification.destinationCode,
            source: classificationSource,
          },
          duties: convertedComponents
            .filter((c) =>
              ['base', 'special', 'non_ntr', 'chapter_99', 'section_301', 'section_232', 'section_122'].includes(
                c.componentType,
              ),
            )
            .map((c) => ({
              type: c.componentType,
              amount: c.amount,
              formula: c.formula,
            })),
          taxes: convertedComponents
            .filter((c) => c.componentType === 'post_tax')
            .map((c) => ({ type: c.componentType, amount: c.amount })),
          fees: convertedComponents
            .filter((c) => c.componentType === 'mpf' || c.componentType === 'hmf')
            .map((c) => ({ type: c.componentType, amount: c.amount })),
          controls: [],
          warnings: result.warnings,
          sourceCitations: result.citations.map((c) => ({ ...c })),
        });
      } catch (e: any) {
        warnings.push(
          `calculate_failed sku=${item.sku ?? '?'} hsCode=${hsCode}: ${e?.message}`,
        );
        lines.push({
          sku: item.sku,
          classification: {
            hs6: hsCode.replace(/\D/g, '').slice(0, 6),
            destinationCode: hsCode,
            source: classificationSource,
          },
          duties: [],
          taxes: [],
          fees: [],
          controls: [],
          warnings: [`CALCULATE_FAILED: ${e?.message}`],
          sourceCitations: [],
        });
      }
    }

    const shipping = request.shipping
      ? await this.convertMoneyToRequestCurrency(
          request.shipping.amount,
          request.shipping.currency,
          requestCurrency,
          request.entryDate,
          warnings,
          'shipping',
        )
      : 0;
    const insurance = request.insurance
      ? await this.convertMoneyToRequestCurrency(
          request.insurance.amount,
          request.insurance.currency,
          requestCurrency,
          request.entryDate,
          warnings,
          'insurance',
        )
      : 0;
    const totalDutyCombined = totalDuty + totalAdditional;
    const landed =
      totalGoods + shipping + insurance + totalDutyCombined + totalFees + totalTaxes;
    const expiresAt = new Date(Date.now() + this.defaultQuoteTtlSeconds * 1000);
    const round = (n: number) => Math.round(n * 100) / 100;
    const totals = {
      goods: round(totalGoods),
      shipping: round(shipping),
      insurance: round(insurance),
      duty: round(totalDutyCombined),
      tax: round(totalTaxes),
      fees: round(totalFees),
      landedCost: round(landed),
    };
    const confidence = confidenceCount > 0 ? round(confidenceSum / confidenceCount) : 0;

    // Persist quote + line rows
    const quote = this.quoteRepo.create({
      organizationId,
      apiKeyId: args.apiKeyId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      status: missingInputs.length > 0 ? 'requires_review' : 'calculated',
      requestJson: request as any,
      responseJson: {} as any,
      htsSnapshotIds: null,
      taxRuleSnapshotIds: null,
      feeRuleSnapshotIds: null,
      lowValueRuleSnapshotIds: null,
      exchangeRateSnapshotId,
      formulaIds: null,
      confidence,
      expiresAt,
      totals: totals as any,
      requestFingerprint: fingerprint,
    });
    const saved = await this.quoteRepo.save(quote);

    const lineRows = lines.map((l, i) =>
      this.lineRepo.create({
        quoteId: saved.id,
        lineNumber: i + 1,
        sku: l.sku ?? null,
        hsCode: l.classification.destinationCode || null,
        destinationCode: l.classification.destinationCode || null,
        countryOfOrigin: request.items[i].countryOfOrigin,
        declaredValue: request.items[i].unitValue * request.items[i].quantity,
        weightKg:
          request.items[i].weightKg !== undefined
            ? request.items[i].weightKg * request.items[i].quantity
            : null,
        quantity: request.items[i].quantity,
        baseDuty: l.duties
          .filter((d) => ['base', 'special', 'non_ntr'].includes(d.type))
          .reduce((s, d) => s + d.amount, 0),
        additionalTariffs: l.duties
          .filter((d) => !['base', 'special', 'non_ntr'].includes(d.type))
          .reduce((s, d) => s + d.amount, 0),
        fees: l.fees.reduce((s, f) => s + f.amount, 0),
        taxes: l.taxes.reduce((s, t) => s + t.amount, 0),
        totalDuty:
          l.duties.reduce((s, d) => s + d.amount, 0) +
          l.fees.reduce((s, f) => s + f.amount, 0),
        landedCost:
          request.items[i].unitValue * request.items[i].quantity +
          l.duties.reduce((s, d) => s + d.amount, 0) +
          l.fees.reduce((s, f) => s + f.amount, 0) +
          l.taxes.reduce((s, t) => s + t.amount, 0),
        dutyBreakdown: l.duties as any,
        taxBreakdown: l.taxes as any,
        feeBreakdown: l.fees as any,
        controls: l.controls as any,
        warnings: l.warnings,
        sourceCitations: l.sourceCitations as any,
        classificationSource: l.classification.source,
      }),
    );
    if (lineRows.length > 0) await this.lineRepo.save(lineRows);

    const response: LandedCostQuoteResponse = {
      quoteId: saved.id,
      status: saved.status,
      confidence,
      destination: {
        country: destination.country,
        memberState: destination.memberState,
      },
      currency: requestCurrency,
      expiresAt: expiresAt.toISOString(),
      totals,
      lines,
      assumptions,
      missingInputs,
      warnings,
    };

    saved.responseJson = response as any;
    await this.quoteRepo.save(saved);
    return response;
  }

  async getQuote(
    organizationId: string,
    id: string,
  ): Promise<LandedCostQuoteEntity | null> {
    const row = await this.quoteRepo.findOne({ where: { id } });
    if (!row || row.organizationId !== organizationId) return null;
    return row;
  }

  async confirm(
    organizationId: string,
    id: string,
  ): Promise<LandedCostQuoteEntity> {
    const row = await this.getQuote(organizationId, id);
    if (!row) {
      const e: any = new Error('Quote not found');
      e.status = 404;
      throw e;
    }
    if (row.status === 'expired') {
      const e: any = new Error('Quote is expired');
      e.code = 'QUOTE_EXPIRED';
      e.status = 409;
      throw e;
    }
    row.status = 'confirmed';
    row.confirmedAt = new Date();
    return this.quoteRepo.save(row);
  }

  async recalculate(
    organizationId: string,
    id: string,
  ): Promise<LandedCostQuoteResponse> {
    const row = await this.getQuote(organizationId, id);
    if (!row) {
      const e: any = new Error('Quote not found');
      e.status = 404;
      throw e;
    }
    return this.createQuote({
      organizationId,
      request: row.requestJson as any,
    });
  }

  async expireStale(): Promise<number> {
    const now = new Date();
    const res = await this.quoteRepo
      .createQueryBuilder()
      .update(LandedCostQuoteEntity)
      .set({ status: 'expired' })
      .where('status = :s', { s: 'calculated' })
      .andWhere('expiresAt < :now', { now })
      .execute();
    return res.affected ?? 0;
  }

  private flattenAdditionalInputs(
    inputs?: Record<string, any>,
  ): Record<string, number> | undefined {
    if (!inputs) return undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }

  private async convertMoneyToRequestCurrency(
    amount: number,
    fromCurrency: string,
    requestCurrency: string,
    effectiveDate: string | undefined,
    warnings: string[],
    label: string,
  ): Promise<number> {
    const converted = await this.fx.convert({
      from: fromCurrency,
      to: requestCurrency,
      amount,
      effectiveDate,
    });
    if (converted.warning) {
      warnings.push(`${label}:${converted.warning}`);
    }
    return converted.amount;
  }

  private hasSellerTaxRegistrationForDestination(
    request: LandedCostQuoteRequestDto,
    destination: { country: string; memberState?: string },
  ): boolean {
    const registrations = request.seller?.taxRegistrations || [];
    const destinationCodes = new Set(
      [destination.country, destination.memberState]
        .filter(Boolean)
        .map((code) => String(code).toUpperCase()),
    );
    return registrations.some((registration) => {
      const jurisdiction = (registration.jurisdiction || '').toUpperCase();
      return (
        destinationCodes.has(jurisdiction) &&
        ['VAT', 'GST', 'IOSS', 'TAX'].includes(
          (registration.type || '').toUpperCase(),
        )
      );
    });
  }

  private computeFingerprint(req: LandedCostQuoteRequestDto): string {
    const canonical = this.stableStringify(req);
    return createHash('sha256').update(canonical).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.stableStringify(v)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${this.stableStringify(v)}`)
      .join(',')}}`;
  }
}
