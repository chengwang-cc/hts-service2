/**
 * Shopify Order Transactions list service.
 *
 * Phase 3 of the Shopify refactor (see docs/2026-05-19/2249_phase-3-transactions-tab.md).
 *
 * Reads from `checkout_orders` (populated by Phase 2's writeback worker)
 * and returns a denormalized, UI-ready summary of each per-order duty
 * calculation. Used by both the Shopify embedded admin Transactions tab
 * and the website dashboard's Order Transactions section.
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CheckoutOrderEntity } from '../../widget/entities/checkout-order.entity';

export type TransactionStatus =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'unknown';

export interface TransactionSummary {
  id: string;
  platformOrderId: string;
  platform: string;
  shop: string | null;
  calculatedAt: string;
  currency: string;
  totals: {
    duties: number;
    taxes: number;
    fees: number;
    landedCost: number;
  };
  lineCount: number;
  linesWithErrors: number;
  status: TransactionStatus;
}

export interface ListTransactionsOptions {
  limit?: number;
  offset?: number;
  since?: Date | null;
  until?: Date | null;
}

export interface TransactionsPage {
  total: number;
  limit: number;
  offset: number;
  items: TransactionSummary[];
}

@Injectable()
export class ShopifyOrderTransactionsService {
  private readonly logger = new Logger(ShopifyOrderTransactionsService.name);

  constructor(
    @InjectRepository(CheckoutOrderEntity)
    private readonly checkoutOrderRepository: Repository<CheckoutOrderEntity>,
  ) {}

  async list(
    organizationId: string,
    options: ListTransactionsOptions = {},
  ): Promise<TransactionsPage> {
    if (!organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const qb = this.checkoutOrderRepository
      .createQueryBuilder('co')
      .where('co.organizationId = :organizationId', { organizationId })
      .andWhere('co.platform = :platform', { platform: 'shopify' });

    if (options.since) {
      qb.andWhere('co.createdAt >= :since', { since: options.since });
    }
    if (options.until) {
      qb.andWhere('co.createdAt < :until', { until: options.until });
    }

    const [rows, total] = await qb
      .orderBy('co.createdAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    return {
      total,
      limit,
      offset,
      items: rows.map((row) => this.summarize(row)),
    };
  }

  private summarize(row: CheckoutOrderEntity): TransactionSummary {
    const summary = (row.calculationSummary ?? {}) as Record<string, unknown>;
    const totalsRaw =
      (summary.totals as Record<string, unknown> | undefined) ?? {};
    const lineItems = Array.isArray(summary.lineItems)
      ? (summary.lineItems as Array<Record<string, unknown>>)
      : [];

    const lineCount = lineItems.length;
    const linesWithErrors = lineItems.filter(
      (l) => typeof l.error === 'string' && l.error.length > 0,
    ).length;

    let status: TransactionStatus = 'unknown';
    if (lineCount > 0) {
      if (linesWithErrors === 0) status = 'completed';
      else if (linesWithErrors === lineCount) status = 'failed';
      else status = 'partial';
    } else if (Object.keys(summary).length === 0) {
      // No summary persisted at all — likely a legacy row from before Phase 2.
      status = 'unknown';
    }

    return {
      id: row.id,
      platformOrderId: row.platformOrderId,
      platform: row.platform,
      shop: typeof summary.shop === 'string' ? summary.shop : null,
      calculatedAt:
        typeof summary.calculatedAt === 'string'
          ? summary.calculatedAt
          : row.createdAt.toISOString(),
      currency: typeof summary.currency === 'string' ? summary.currency : 'USD',
      totals: {
        duties: numericOr0(totalsRaw.duties),
        taxes: numericOr0(totalsRaw.taxes),
        fees: numericOr0(totalsRaw.fees),
        landedCost: numericOr0(totalsRaw.landedCost),
      },
      lineCount,
      linesWithErrors,
      status,
    };
  }
}

function numericOr0(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
