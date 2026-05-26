/**
 * Shopify Order Writeback
 *
 * Phase 2 of the Shopify refactor (see docs/2026-05-19/2237_phase-2-order-duty-writeback.md).
 *
 * Consumes pg-boss jobs enqueued by the `orders/create` webhook handler.
 * For each order:
 *   1. Looks up the merchant's ShopifySession; bails if `calculate_duty=false`.
 *   2. Resolves each line item's HS code via Shopify GraphQL (Phase 1 sync
 *      already wrote HS codes back to inventory items).
 *   3. Calls CalculationService per line.
 *   4. Persists the per-line breakdown into CheckoutOrderEntity.calculationSummary
 *      (upserts on (organizationId, platformOrderId) so webhook retries are
 *      idempotent).
 *   5. Writes the same breakdown back to the Shopify order as a
 *      `hts_classify.duty_breakdown` metafield so the merchant sees it in
 *      Shopify's order detail UI.
 *
 * The webhook handler returns 200 immediately and pg-boss takes care of
 * retries / concurrency.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationService } from '../../calculator/services/calculation.service';
import { BillingChargeService } from '../../billing/services/billing-charge.service';
import {
  ShopifyConnector,
  type ShopifyConfig,
} from '../../connectors/services/shopify.connector';
import { CheckoutOrderEntity } from '../../widget/entities/checkout-order.entity';
import { ShopifySessionEntity } from '../entities/shopify-session.entity';
import { ShopifyAuthService } from './shopify-auth.service';

export const SHOPIFY_ORDER_WRITEBACK_QUEUE = 'shopify-order-writeback';
export const ORDER_METAFIELD_NAMESPACE = 'hts_classify';
export const ORDER_METAFIELD_KEY = 'duty_breakdown';
const BREAKDOWN_SCHEMA_VERSION = 1 as const;

/**
 * Minimal subset of Shopify's orders/create webhook body that we read.
 * Shopify ships dozens of fields; we typing the ones we touch.
 */
interface ShopifyOrderWebhookLineItem {
  id: number | string;
  variant_id?: number | string | null;
  product_id?: number | string | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  quantity?: number | null;
  price?: string | null;
  price_set?: {
    shop_money?: { amount?: string; currency_code?: string };
    presentment_money?: { amount?: string; currency_code?: string };
  } | null;
  grams?: number | null;
  origin_location?: { country_code?: string | null } | null;
}

interface ShopifyOrderWebhookPayload {
  id: number | string;
  order_number?: number | string;
  name?: string;
  currency?: string;
  presentment_currency?: string;
  total_price?: string;
  shipping_address?: { country_code?: string | null } | null;
  line_items?: ShopifyOrderWebhookLineItem[];
}

export interface OrderWritebackJobData {
  shopDomain: string;
  organizationId: string;
  connectorId: string | null;
  order: ShopifyOrderWebhookPayload;
}

interface LineItemResult {
  lineItemId: string | number;
  variantId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  hsCode: string | null;
  unitDeclaredValue: number;
  duties: number;
  taxes: number;
  fees: number;
  error?: string;
}

interface OrderBreakdown {
  calculationId: string;
  currency: string;
  totals: {
    duties: number;
    taxes: number;
    fees: number;
    landedCost: number;
  };
  lineItems: LineItemResult[];
  shop: string;
  calculatedAt: string;
  schemaVersion: typeof BREAKDOWN_SCHEMA_VERSION;
}

@Injectable()
export class ShopifyOrderWritebackService {
  private readonly logger = new Logger(ShopifyOrderWritebackService.name);

  constructor(
    @InjectRepository(ShopifySessionEntity)
    private readonly sessionRepository: Repository<ShopifySessionEntity>,
    @InjectRepository(CheckoutOrderEntity)
    private readonly checkoutOrderRepository: Repository<CheckoutOrderEntity>,
    private readonly calculationService: CalculationService,
    private readonly shopifyConnector: ShopifyConnector,
    private readonly billingCharge: BillingChargeService,
    private readonly shopifyAuthService: ShopifyAuthService,
  ) {}

  async processOrder(data: OrderWritebackJobData): Promise<void> {
    const { shopDomain, organizationId, connectorId, order } = data;
    const orderId = String(order?.id ?? '');
    if (!orderId) {
      this.logger.warn(
        `[writeback] no order id in payload for ${shopDomain}; skipping`,
      );
      return;
    }

    const session = await this.sessionRepository.findOne({
      where: { shop: shopDomain },
    });
    if (!session) {
      this.logger.warn(
        `[writeback] no ShopifySession for ${shopDomain}; order ${orderId} skipped`,
      );
      return;
    }
    session.accessToken = this.shopifyAuthService.decryptAccessToken(
      session.accessToken,
    );
    if (session.calculateDuty === false) {
      // Merchant opted out — no calculation, no write-back, no billable work.
      return;
    }
    if (!session.accessToken) {
      this.logger.warn(
        `[writeback] session for ${shopDomain} has no accessToken; cannot fetch variants`,
      );
      return;
    }

    const config: ShopifyConfig = {
      shopUrl: session.shop,
      accessToken: session.accessToken,
    };

    const breakdown = await this.buildBreakdown(order, config, organizationId);

    // Phase 4: meter the call. In shadow mode this logs a usage_records row
    // without touching the balance; in live mode it deducts atomically.
    // We do this BEFORE the metafield write so retries don't double-charge:
    // pg-boss may retry the whole job, but in shadow mode the audit log is
    // append-only (acceptable for ops review), and in live mode a retry
    // after a successful charge would attempt another deduction — the
    // checkout_orders upsert is keyed on (org, platformOrderId) and we
    // dedupe charges at the audit query layer (the Transactions view
    // shows the most recent matching usage_records row). If pg-boss
    // retries are observed to over-charge in practice we'll add a
    // dedupe lookup here; for shadow rollout this is acceptable.
    let chargeOutcome: Awaited<
      ReturnType<BillingChargeService['chargeForEvent']>
    > | null = null;
    try {
      chargeOutcome = await this.billingCharge.chargeForEvent(
        organizationId,
        'DUTY_CALCULATION',
        {
          platformOrderId: orderId,
          shop: shopDomain,
          lineCount: breakdown.lineItems.length,
        },
      );
    } catch (err: any) {
      // Billing must not block order processing.
      this.logger.warn(
        `[writeback] billing chargeForEvent failed for order ${orderId}: ${err?.message ?? err}`,
      );
    }

    // Attach the charge outcome to the persisted breakdown so the
    // Transactions UI's "Billed" column has data to show without a join.
    if (chargeOutcome) {
      (breakdown as unknown as Record<string, unknown>).billed = {
        credits: chargeOutcome.charged ? chargeOutcome.costCredits : 0,
        cents: chargeOutcome.charged
          ? chargeOutcome.costCredits * this.billingCharge.perCreditCents()
          : 0,
        shadow: chargeOutcome.shadow,
        reason: chargeOutcome.reason ?? null,
      };
    }

    await this.upsertCheckoutOrder(
      organizationId,
      orderId,
      connectorId,
      breakdown,
    );

    try {
      await this.shopifyConnector.setOrderMetafield(
        config,
        orderId,
        ORDER_METAFIELD_NAMESPACE,
        ORDER_METAFIELD_KEY,
        breakdown,
      );
    } catch (err: any) {
      // Don't lose the DB row if Shopify rejects the metafield write —
      // pg-boss will retry the whole job, which will overwrite the row and
      // re-attempt the metafield. Throw so the retry happens.
      this.logger.warn(
        `[writeback] order ${orderId} metafield write failed: ${err?.message ?? err}`,
      );
      throw err;
    }

    this.logger.log(
      `[writeback] order ${orderId} (${shopDomain}): ${breakdown.lineItems.length} lines, totals duties=${breakdown.totals.duties} taxes=${breakdown.totals.taxes}`,
    );
  }

  // ──────────────────────────────────────────────────────────────────

  private async buildBreakdown(
    order: ShopifyOrderWebhookPayload,
    config: ShopifyConfig,
    organizationId: string,
  ): Promise<OrderBreakdown> {
    const currency =
      order.presentment_currency ||
      order.line_items?.[0]?.price_set?.presentment_money?.currency_code ||
      order.currency ||
      'USD';
    const lineItems: LineItemResult[] = [];
    let batchCalculationId = '';
    let totalDuties = 0;
    let totalTaxes = 0;
    let totalFees = 0;
    let totalDeclaredValue = 0;

    for (const line of order.line_items ?? []) {
      const lineResult = await this.processLine(
        line,
        config,
        organizationId,
        currency,
      );
      lineItems.push(lineResult);

      if (lineResult.error) continue;

      totalDuties += lineResult.duties;
      totalTaxes += lineResult.taxes;
      totalFees += lineResult.fees;
      totalDeclaredValue += lineResult.unitDeclaredValue * lineResult.quantity;
    }

    if (!batchCalculationId) {
      batchCalculationId = `SHOPIFY-${order.id}-${Date.now()}`;
    }

    return {
      calculationId: batchCalculationId,
      currency,
      totals: {
        duties: round2(totalDuties),
        taxes: round2(totalTaxes),
        fees: round2(totalFees),
        landedCost: round2(
          totalDeclaredValue + totalDuties + totalTaxes + totalFees,
        ),
      },
      lineItems,
      shop: config.shopUrl ?? '',
      calculatedAt: new Date().toISOString(),
      schemaVersion: BREAKDOWN_SCHEMA_VERSION,
    };
  }

  private async processLine(
    line: ShopifyOrderWebhookLineItem,
    config: ShopifyConfig,
    organizationId: string,
    currency: string,
  ): Promise<LineItemResult> {
    const lineItemId = line.id;
    const variantId = line.variant_id != null ? String(line.variant_id) : null;
    const sku = line.sku?.trim() || null;
    const title = (line.name || line.title || '').trim();
    const quantity = Math.max(1, Number(line.quantity ?? 1));
    const unitDeclaredValue = parseMoney(
      line.price_set?.presentment_money?.amount ??
        line.price_set?.shop_money?.amount ??
        line.price ??
        '0',
    );
    if (!variantId) {
      return zeroLine(
        lineItemId,
        variantId,
        sku,
        title,
        quantity,
        unitDeclaredValue,
        'Line has no variant_id',
      );
    }

    let hsCode: string | null = null;
    let countryOfOrigin: string | null =
      line.origin_location?.country_code?.trim()?.toUpperCase() || null;
    try {
      const compliance = await this.shopifyConnector.getVariantCompliance(
        config,
        variantId,
      );
      hsCode = compliance.hsCode;
      countryOfOrigin = countryOfOrigin || compliance.countryOfOrigin;
    } catch (err: any) {
      return zeroLine(
        lineItemId,
        variantId,
        sku,
        title,
        quantity,
        unitDeclaredValue,
        `Variant lookup failed: ${err?.message ?? err}`,
      );
    }
    if (!hsCode) {
      return zeroLine(
        lineItemId,
        variantId,
        sku,
        title,
        quantity,
        unitDeclaredValue,
        'No HS code on variant — run product sync first',
      );
    }
    if (!countryOfOrigin) {
      return zeroLine(
        lineItemId,
        variantId,
        sku,
        title,
        quantity,
        unitDeclaredValue,
        'Missing country of origin on Shopify line and inventory item',
      );
    }

    try {
      const result = await this.calculationService.calculate({
        htsNumber: hsCode,
        countryOfOrigin,
        declaredValue: unitDeclaredValue * quantity,
        currency,
        quantity,
        weightKg:
          line.grams != null && line.grams > 0
            ? (line.grams / 1000) * quantity
            : undefined,
        organizationId,
      });

      let duties = result.totalDuty ?? 0;
      let taxes = result.totalTaxes ?? 0;
      let fees = 0;

      // Mirror widget-api's fee extraction so the metafield numbers match
      // what merchants see on the website calculator.
      const breakdownTaxes = (result.breakdown as { taxes?: unknown })?.taxes;
      if (Array.isArray(breakdownTaxes)) {
        for (const t of breakdownTaxes as Array<{
          type?: string;
          amount?: number;
        }>) {
          const isFee =
            t.type === 'MPF' ||
            t.type === 'HMF' ||
            (typeof t.type === 'string' &&
              t.type.toLowerCase().includes('fee'));
          if (isFee) {
            fees += t.amount ?? 0;
            taxes -= t.amount ?? 0;
          }
        }
      }
      taxes = Math.max(0, taxes);
      fees = Math.max(0, fees);

      return {
        lineItemId,
        variantId,
        sku,
        title,
        quantity,
        hsCode,
        unitDeclaredValue,
        duties: round2(duties),
        taxes: round2(taxes),
        fees: round2(fees),
      };
    } catch (err: any) {
      return zeroLine(
        lineItemId,
        variantId,
        sku,
        title,
        quantity,
        unitDeclaredValue,
        `Calculation failed: ${err?.message ?? err}`,
      );
    }
  }

  private async upsertCheckoutOrder(
    organizationId: string,
    orderId: string,
    connectorId: string | null,
    breakdown: OrderBreakdown,
  ): Promise<void> {
    const existing = await this.checkoutOrderRepository.findOne({
      where: {
        platformOrderId: orderId,
        organizationId,
      },
    });

    if (existing) {
      existing.calculationId = breakdown.calculationId;
      existing.calculationSummary = breakdown as unknown as Record<
        string,
        unknown
      >;
      if (connectorId) existing.storeConnectionId = connectorId;
      await this.checkoutOrderRepository.save(existing);
      return;
    }

    await this.checkoutOrderRepository.save(
      this.checkoutOrderRepository.create({
        calculationId: breakdown.calculationId,
        platformOrderId: orderId,
        platform: 'shopify',
        storeConnectionId: connectorId ?? null,
        organizationId,
        calculationSummary: breakdown as unknown as Record<string, unknown>,
      }),
    );
  }
}

function zeroLine(
  lineItemId: string | number,
  variantId: string | null,
  sku: string | null,
  title: string,
  quantity: number,
  unitDeclaredValue: number,
  error: string,
): LineItemResult {
  return {
    lineItemId,
    variantId,
    sku,
    title,
    quantity,
    hsCode: null,
    unitDeclaredValue,
    duties: 0,
    taxes: 0,
    fees: 0,
    error,
  };
}

function parseMoney(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
