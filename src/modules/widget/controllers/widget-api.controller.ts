import {
  Controller,
  Post,
  Body,
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
  ) {}

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
    const currency = input.lines[0]?.declaredValue?.currency ?? 'USD';
    const warnings: string[] = [];

    this.logger.log(`[widget/calculate] input: ${JSON.stringify(input)}`);
    this.logger.log(`[widget/calculate] hasShopifySession: ${!!shopifySession}, shop: ${shopifySession?.shop ?? 'none'}`);

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
      this.logger.log(`[widget/calculate] SKU→HS lookup result: ${JSON.stringify(Array.from(skuToHs.entries()))}`);
      input.lines = input.lines.map((line) => {
        if (!line.hsCode?.trim() && line.sku) {
          const resolved = skuToHs.get(line.sku);
          if (resolved) {
            return { ...line, hsCode: resolved };
          }
        }
        return line;
      });
      this.logger.log(`[widget/calculate] lines after resolution: ${JSON.stringify(input.lines)}`);
    }

    const linesWithHs = input.lines.filter((line) => line.hsCode?.trim());
    const linesWithoutHs = input.lines.filter((line) => !line.hsCode?.trim());

    if (linesWithoutHs.length > 0) {
      const skus = linesWithoutHs.map((l) => l.sku).join(', ');
      warnings.push(
        `${linesWithoutHs.length} line item(s) skipped (no HS code): ${skus}`,
      );
    }

    if (linesWithHs.length === 0) {
      throw new HttpException(
        'No line items with HS codes to calculate',
        HttpStatus.BAD_REQUEST,
      );
    }

    for (const line of linesWithHs) {
      try {
        const result: CalculationResult =
          await this.calculationService.calculate({
            htsNumber: line.hsCode!,
            countryOfOrigin: line.countryOfOrigin ?? 'CN',
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

        totalDuties += result.totalDuty;
        totalTaxes += result.totalTaxes;
        totalDeclaredValue += line.declaredValue.amount * line.quantity;

        // Extract fees from breakdown (MPF, HMF, etc.)
        if (result.breakdown?.taxes && Array.isArray(result.breakdown.taxes)) {
          for (const tax of result.breakdown.taxes) {
            if (
              tax.type === 'MPF' ||
              tax.type === 'HMF' ||
              tax.type?.toLowerCase().includes('fee')
            ) {
              totalFees += tax.amount ?? 0;
              totalTaxes -= tax.amount ?? 0; // Don't double-count fees in taxes
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          `Calculation failed for HS code ${line.hsCode}: ${error.message}`,
        );
        warnings.push(
          `Calculation failed for SKU ${line.sku} (${line.hsCode}): ${error.message}`,
        );
      }
    }

    // Ensure non-negative values after fee extraction
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
