import {
  Controller,
  Post,
  Body,
  Optional,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import { WidgetKeyGuard } from '../guards/widget-key.guard';
import { CheckoutEstimateDto } from '../dto/checkout-estimate.dto';
import { CheckoutCompleteDto } from '../dto/checkout-complete.dto';
import { CheckoutOrderEntity } from '../entities/checkout-order.entity';
import {
  CalculationService,
  CalculationResult,
} from '../../calculator/services/calculation.service';
import { ShopifyConnector } from '../../connectors/services/shopify.connector';
import { ShopifySessionEntity } from '../../shopify-app/entities/shopify-session.entity';
import { CatalogService } from '../../catalog/services/catalog.service';
import { LandedCostService } from '../../landed-cost/services/landed-cost.service';

interface Money {
  amount: number;
  currency: string;
}

interface CheckoutEstimateResult {
  calculationId: string;
  duties: Money;
  taxes: Money;
  fees: Money;
  totalLandedCost: Money;
  assumptions?: string[];
  warnings?: string[];
  /**
   * @deprecated Use `displayAtCheckout` (true/false) instead. Kept for one
   * release for older checkout extension builds.
   */
  dutyDisplayMode?: string;
  /** Whether the buyer-facing extension should render this result. */
  displayAtCheckout?: boolean;
  /** True when calculation was disabled for the shop and no calc ran. */
  skipped?: boolean;
  reason?: 'calculation_disabled';
}

@SkipJwtAuth()
@Controller('widget/v1')
@UseGuards(WidgetKeyGuard)
export class WidgetApiController {
  private readonly logger = new Logger(WidgetApiController.name);

  constructor(
    private readonly calculationService: CalculationService,
    private readonly shopifyConnector: ShopifyConnector,
    @InjectRepository(CheckoutOrderEntity)
    private readonly checkoutOrderRepository: Repository<CheckoutOrderEntity>,
    @Optional() private readonly catalogService?: CatalogService,
    @Optional() private readonly landedCostService?: LandedCostService,
  ) {}

  /**
   * P3.6 — when the request enables `useQuoteApi`, route the widget call
   * through LandedCostService so the result is a real quote with an id +
   * expiresAt. We keep the legacy per-line CalculationService path as the
   * default to avoid breaking existing widget builds.
   */
  private async runViaLandedCost(args: {
    organizationId: string;
    apiKeyId?: string;
    input: CheckoutEstimateDto;
    currency: string;
  }): Promise<CheckoutEstimateResult & { quoteId: string; expiresAt: string }> {
    const items = args.input.lines
      .filter((l) => l.hsCode?.trim())
      .map((l) => ({
        sku: l.sku,
        description: l.sku || 'line item',
        hsCode: l.hsCode!,
        countryOfOrigin: l.countryOfOrigin || 'US',
        quantity: l.quantity,
        unitValue: l.declaredValue.amount,
        weightKg: l.weightKg,
      }));

    // AUDIT FIX H1 — landed-cost requires at least one line; reject
    // here before constructing an invalid quote request that would
    // fail DTO validation anyway (and surface a nicer error).
    if (items.length === 0) {
      throw new HttpException(
        'No line items with HS codes to calculate',
        HttpStatus.BAD_REQUEST,
      );
    }

    const quote = await this.landedCostService!.createQuote({
      organizationId: args.organizationId,
      apiKeyId: args.apiKeyId,
      request: {
        currency: args.currency,
        destination: { country: 'US' },
        origin: { country: items[0].countryOfOrigin },
        items,
      } as any,
    });

    return {
      calculationId: quote.quoteId,
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
      duties: { amount: quote.totals.duty, currency: args.currency },
      taxes: { amount: quote.totals.tax, currency: args.currency },
      fees: { amount: quote.totals.fees, currency: args.currency },
      totalLandedCost: {
        amount: quote.totals.landedCost,
        currency: args.currency,
      },
      warnings: quote.warnings.length > 0 ? quote.warnings : undefined,
      displayAtCheckout: true,
      dutyDisplayMode: 'ddu',
    };
  }

  /**
   * P2.3 — resolve missing HS code from the catalog: confirmed
   * ClassificationEntity for the product, OR product.defaultHsCode.
   * Returns the resolved code and whether the country-of-origin should
   * inherit the product's default.
   */
  private async resolveMissingHsFromCatalog(
    organizationId: string,
    sku: string | undefined,
    destination: string,
  ): Promise<{ hsCode?: string; countryOfOrigin?: string }> {
    if (!this.catalogService || !sku) return {};
    const hit = await this.catalogService.findVariantBySku(organizationId, sku);
    if (!hit) return {};

    let hsCode: string | undefined;
    const cls = await this.catalogService.findFreshClassification(
      hit.product.id,
      destination,
    );
    if (cls) hsCode = cls.destinationCode;
    if (!hsCode) hsCode = hit.product.defaultHsCode ?? undefined;

    return {
      hsCode,
      countryOfOrigin: hit.product.defaultCountryOfOrigin ?? undefined,
    };
  }

  /**
   * If the request comes from a Shopify session, look up missing HS codes
   * from the merchant's Shopify inventory by SKU.
   */
  private async resolveHsCodesFromShopify(
    session: ShopifySessionEntity,
    lines: Array<{ sku: string; hsCode?: string }>,
  ): Promise<Map<string, string>> {
    const skuToHs = new Map<string, string>();
    if (!session?.accessToken || !session.shop) return skuToHs;

    const skusNeeded = new Set(
      lines.filter((l) => !l.hsCode?.trim() && l.sku?.trim()).map((l) => l.sku.trim()),
    );
    if (skusNeeded.size === 0) return skuToHs;

    try {
      const products = await this.shopifyConnector.importProducts(
        { shopUrl: session.shop, accessToken: session.accessToken },
        { limit: 250, maxPages: 4 },
      );
      for (const p of products) {
        for (const v of p.variants) {
          if (v.sku && skusNeeded.has(v.sku) && v.harmonizedSystemCode) {
            skuToHs.set(v.sku, v.harmonizedSystemCode);
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`SKU→HS lookup failed for ${session.shop}: ${error.message}`);
    }

    return skuToHs;
  }

  @Post('calculate')
  async calculate(
    @Body() input: CheckoutEstimateDto,
    @Req() req: any,
  ): Promise<CheckoutEstimateResult> {
    const organizationId = req.organizationId as string;
    const shopifySession: ShopifySessionEntity | undefined = req.shopifySession;
    const widgetConfig: any = req.widgetConfig;
    const defaultCountryOfOrigin: string | undefined =
      widgetConfig?.defaults?.countryOfOrigin?.toString().trim().toUpperCase();
    const currency = input.lines[0]?.declaredValue?.currency ?? 'USD';
    const warnings: string[] = [];

    // Structured log — never log SKU values, prices, descriptions, or HS codes
    // in plaintext. Aggregate to size/currency/shipTo only.
    this.logger.log(
      `[widget/calculate] org=${organizationId} lines=${input.lines.length} currency=${currency} hasShopifySession=${!!shopifySession} useQuoteApi=${!!input.useQuoteApi}`,
    );

    // P3.6 — route through the LandedCostService when opted in.
    if (input.useQuoteApi && this.landedCostService) {
      try {
        return await this.runViaLandedCost({
          organizationId,
          apiKeyId: req.apiKey?.id,
          input,
          currency,
        });
      } catch (e: any) {
        this.logger.warn(
          `[widget/calculate] landed-cost path failed, falling back to legacy: ${e?.message}`,
        );
      }
    }

    // Short-circuit when the merchant has disabled duty calculation for
    // this shop. No billable work happens and the response carries enough
    // context for the checkout extension to render nothing.
    if (shopifySession && shopifySession.calculateDuty === false) {
      const zero: Money = { amount: 0, currency };
      return {
        calculationId: `SKIPPED-${Date.now()}`,
        duties: zero,
        taxes: zero,
        fees: zero,
        totalLandedCost: { amount: 0, currency },
        skipped: true,
        reason: 'calculation_disabled',
        displayAtCheckout: false,
        dutyDisplayMode: 'disabled',
      };
    }

    let totalDuties = 0;
    let totalTaxes = 0;
    let totalFees = 0;
    let totalDeclaredValue = 0;
    let batchCalculationId = '';

    // Resolve missing HS codes by looking up SKUs in Shopify (if Shopify session)
    if (shopifySession) {
      const skuToHs = await this.resolveHsCodesFromShopify(shopifySession, input.lines);
      this.logger.log(
        `[widget/calculate] sku_lookup matches=${skuToHs.size}`,
      );
      input.lines = input.lines.map((line) => {
        if (!line.hsCode?.trim() && line.sku) {
          const resolved = skuToHs.get(line.sku);
          if (resolved) {
            return { ...line, hsCode: resolved };
          }
        }
        return line;
      });
    }

    // P2.3 — catalog-first fallback: if a line is missing hsCode, try the
    // organization's catalog (Product.defaultHsCode or a confirmed
    // ClassificationEntity) before declaring it un-calculable.
    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      if (line.hsCode?.trim()) continue;
      const resolved = await this.resolveMissingHsFromCatalog(
        organizationId,
        line.sku,
        'US',
      );
      if (resolved.hsCode) {
        input.lines[i] = {
          ...line,
          hsCode: resolved.hsCode,
          countryOfOrigin: line.countryOfOrigin || resolved.countryOfOrigin,
        };
      }
    }

    const linesWithHs = input.lines.filter((line) => line.hsCode?.trim());
    const linesWithoutHs = input.lines.filter((line) => !line.hsCode?.trim());

    if (linesWithoutHs.length > 0) {
      const skus = linesWithoutHs.map((l) => l.sku).join(', ');
      warnings.push(
        `${linesWithoutHs.length} line item(s) skipped (no HS code, no catalog match): ${skus}`,
      );
    }

    if (linesWithHs.length === 0) {
      throw new HttpException(
        'No line items with HS codes to calculate',
        HttpStatus.BAD_REQUEST,
      );
    }

    for (const line of linesWithHs) {
      // Resolve country of origin: line → widget default → warning + skip line.
      // Never silently default to 'CN'.
      const resolvedCoo =
        line.countryOfOrigin?.toUpperCase() || defaultCountryOfOrigin;
      if (!resolvedCoo) {
        warnings.push(
          `Line item (SKU ${line.sku ?? '?'}) skipped: no country of origin and no widget default configured`,
        );
        continue;
      }

      try {
        const result: CalculationResult =
          await this.calculationService.calculate({
            htsNumber: line.hsCode!,
            countryOfOrigin: resolvedCoo,
            declaredValue: line.declaredValue.amount * line.quantity,
            currency: line.declaredValue.currency,
            weightKg: line.weightKg
              ? line.weightKg * line.quantity
              : undefined,
            quantity: line.quantity,
            organizationId,
          });

        if (!batchCalculationId) {
          batchCalculationId = result.calculationId;
        }

        totalDuties += result.totals?.baseDuty ?? result.baseDuty ?? 0;
        totalDuties += result.totals?.additionalTariffs ?? result.additionalTariffs ?? 0;
        totalTaxes += result.totals?.taxes ?? result.totalTaxes ?? 0;
        totalFees += result.totals?.fees ?? result.fees ?? 0;
        totalDeclaredValue += line.declaredValue.amount * line.quantity;
      } catch (error) {
        this.logger.warn(
          `Calculation failed for SKU ${line.sku ?? '?'}: ${(error as Error).message}`,
        );
        warnings.push(
          `Calculation failed for SKU ${line.sku ?? '?'}: ${(error as Error).message}`,
        );
      }
    }

    // Defensive: clamp to non-negative.
    totalDuties = Math.max(0, totalDuties);
    totalTaxes = Math.max(0, totalTaxes);
    totalFees = Math.max(0, totalFees);

    const calculationId = batchCalculationId || `CHECKOUT-${Date.now()}`;
    const totalLandedCost =
      totalDeclaredValue + totalDuties + totalTaxes + totalFees;

    // displayAtCheckout is true only when the merchant has both flags on.
    // If the shop opted out of buyer-facing display we still ran the
    // calculation (we'll need it for reporting / billing) but tell the
    // extension not to render.
    const calculateDuty = shopifySession?.calculateDuty ?? true;
    const displayAtCheckout =
      calculateDuty && (shopifySession?.displayAtCheckout ?? true);

    return {
      calculationId,
      duties: { amount: round2(totalDuties), currency },
      taxes: { amount: round2(totalTaxes), currency },
      fees: { amount: round2(totalFees), currency },
      totalLandedCost: { amount: round2(totalLandedCost), currency },
      warnings: warnings.length > 0 ? warnings : undefined,
      displayAtCheckout,
      dutyDisplayMode: !calculateDuty
        ? 'disabled'
        : shopifySession?.dutyDisplayMode || 'ddu',
    };
  }

  @Post('checkout-complete')
  async checkoutComplete(
    @Body() input: CheckoutCompleteDto,
    @Req() req: any,
  ): Promise<{ success: boolean }> {
    const organizationId = req.organizationId as string;

    const existing = await this.checkoutOrderRepository.findOne({
      where: {
        calculationId: input.calculationId,
        platformOrderId: input.platformOrderId,
      },
    });

    if (existing) {
      return { success: true };
    }

    const order = this.checkoutOrderRepository.create({
      calculationId: input.calculationId,
      platformOrderId: input.platformOrderId,
      platform: input.platform,
      storeConnectionId: input.storeConnectionId ?? null,
      organizationId,
    });

    await this.checkoutOrderRepository.save(order);

    return { success: true };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
