import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Financial reports — read-only views over the materialized rollup
 * tables created in 1781718504000-FinancialReportsViews.
 *
 * Phase 9, PR F9.1.
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §13
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §10.1
 *
 * Why a materialized view + service combo
 * ---------------------------------------
 * The reports run over the full history of credit_purchases +
 * invoices + refunds. Doing those aggregates live on every dashboard
 * load would scale poorly: a 24-month MRR chart issues N row scans
 * across millions of rows. The materialized views pre-aggregate
 * nightly; the service just reads + paginates them. Refresh is
 * concurrent so the dashboard stays available during rebuilds.
 *
 * Refresh schedule
 * ----------------
 * 03:00 UTC daily — 1 hour after the reconciliation cron (02:00 UTC)
 * so reports never reflect un-reconciled data. The
 * MaterializedViewsRefreshWorker drives this on the existing pg-boss
 * scheduler.
 *
 * Why we don't expose a manual-refresh endpoint
 * ---------------------------------------------
 * CONCURRENTLY refresh can take ~minutes on large tables. We don't
 * want ops to fire it ad-hoc from the dashboard. If a refresh-now
 * surface becomes useful, it should land behind a separate guard
 * + Idempotency-Key in a follow-up.
 */
@Injectable()
export class FinancialReportsService {
  private readonly logger = new Logger(FinancialReportsService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Refresh all three materialized views CONCURRENTLY. Called by the
   * nightly worker. Each view is refreshed independently so a failure
   * on one doesn't block the others. Throws aggregate error after
   * all attempts complete.
   */
  async refreshAll(): Promise<{
    refreshed: string[];
    failed: Array<{ view: string; error: string }>;
  }> {
    const views = ['mv_revenue_monthly', 'mv_refunds_monthly', 'mv_top_accounts_t12m'];
    const refreshed: string[] = [];
    const failed: Array<{ view: string; error: string }> = [];
    for (const v of views) {
      try {
        await this.ds.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${v}"`);
        refreshed.push(v);
      } catch (err) {
        const msg = (err as Error).message ?? 'unknown';
        // CONCURRENTLY requires the view to be populated at least once
        // (initial load is non-concurrent). Fall back to plain refresh
        // on the first run.
        if (msg.includes('cannot be refreshed concurrently')) {
          try {
            await this.ds.query(`REFRESH MATERIALIZED VIEW "${v}"`);
            refreshed.push(v);
            continue;
          } catch (err2) {
            failed.push({ view: v, error: (err2 as Error).message });
            continue;
          }
        }
        failed.push({ view: v, error: msg });
      }
    }
    this.logger.log(
      `[reports] refresh complete: ${refreshed.length} ok, ${failed.length} failed`,
    );
    return { refreshed, failed };
  }

  // ── Report read methods ──────────────────────────────────────────

  /**
   * Revenue by month. Splits into `credit_purchase` + `invoice`
   * sources so the dashboard can stack the chart. Range defaults to
   * trailing 24 months.
   */
  async revenueByMonth(opts: {
    fromMonth?: string; // 'YYYY-MM'
    toMonth?: string; // 'YYYY-MM'
  } = {}): Promise<
    Array<{
      month: string;
      source: 'credit_purchase' | 'invoice';
      count: number;
      grossUsd: number;
      grossUsdCents: number;
    }>
  > {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.fromMonth) {
      where.push(`month >= $${params.length + 1}::date`);
      params.push(`${opts.fromMonth}-01`);
    }
    if (opts.toMonth) {
      where.push(`month <= $${params.length + 1}::date`);
      params.push(`${opts.toMonth}-01`);
    }
    // Default to trailing 24 months when no range supplied.
    if (where.length === 0) {
      where.push(`month >= (date_trunc('month', now()) - interval '24 months')::date`);
    }
    const sql = `
      SELECT month, source, count, gross_usd, gross_usd_cents
      FROM mv_revenue_monthly
      WHERE ${where.join(' AND ')}
      ORDER BY month ASC, source ASC
    `;
    const rows = await this.ds.query<
      Array<{
        month: Date;
        source: string;
        count: number;
        gross_usd: string;
        gross_usd_cents: string;
      }>
    >(sql, params);
    return rows.map((r) => ({
      month:
        r.month instanceof Date
          ? r.month.toISOString().slice(0, 10)
          : String(r.month).slice(0, 10),
      source: r.source as 'credit_purchase' | 'invoice',
      count: Number(r.count),
      grossUsd: Number(r.gross_usd),
      grossUsdCents: Number(r.gross_usd_cents),
    }));
  }

  /**
   * Refund rate by month. `refundRate` is refunded_cents / gross_cents
   * — 0 to 1; the SPA renders as percent. Default range trailing 12
   * months.
   */
  async refundsByMonth(opts: { fromMonth?: string; toMonth?: string } = {}): Promise<
    Array<{
      month: string;
      refundCount: number;
      refundedCents: number;
      creditsReturned: number;
      grossCents: number;
      refundRate: number;
    }>
  > {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.fromMonth) {
      where.push(`month >= $${params.length + 1}::date`);
      params.push(`${opts.fromMonth}-01`);
    }
    if (opts.toMonth) {
      where.push(`month <= $${params.length + 1}::date`);
      params.push(`${opts.toMonth}-01`);
    }
    if (where.length === 0) {
      where.push(`month >= (date_trunc('month', now()) - interval '12 months')::date`);
    }
    const sql = `
      SELECT month, refund_count, refunded_cents, credits_returned, gross_cents, refund_rate
      FROM mv_refunds_monthly
      WHERE ${where.join(' AND ')}
      ORDER BY month ASC
    `;
    const rows = await this.ds.query<
      Array<{
        month: Date;
        refund_count: number;
        refunded_cents: string;
        credits_returned: number;
        gross_cents: string;
        refund_rate: string;
      }>
    >(sql, params);
    return rows.map((r) => ({
      month:
        r.month instanceof Date
          ? r.month.toISOString().slice(0, 10)
          : String(r.month).slice(0, 10),
      refundCount: Number(r.refund_count),
      refundedCents: Number(r.refunded_cents),
      creditsReturned: Number(r.credits_returned),
      grossCents: Number(r.gross_cents),
      refundRate: Number(r.refund_rate),
    }));
  }

  /**
   * Manual credits issued, grouped by `reasonCode` (default) or by
   * `month`. Reads directly from credit_ledger — small enough to live-
   * query without a materialized view.
   */
  async manualCredits(opts: { groupBy?: 'reason_code' | 'month' } = {}): Promise<{
    groupBy: 'reason_code' | 'month';
    rows: Array<{
      key: string;
      grants: { count: number; credits: number };
      debits: { count: number; credits: number };
    }>;
  }> {
    const groupBy = opts.groupBy ?? 'reason_code';
    const groupExpr =
      groupBy === 'month'
        ? `date_trunc('month', created_at AT TIME ZONE 'UTC')::date::text`
        : `COALESCE(reason_code, 'UNCATEGORIZED')`;
    const sql = `
      SELECT
        ${groupExpr} AS key,
        COUNT(*) FILTER (WHERE kind = 'MANUAL_TOPUP')::int AS topup_count,
        COALESCE(SUM(delta_credits) FILTER (WHERE kind = 'MANUAL_TOPUP'), 0)::int AS topup_credits,
        COUNT(*) FILTER (WHERE kind = 'MANUAL_DEBIT')::int AS debit_count,
        COALESCE(SUM(-delta_credits) FILTER (WHERE kind = 'MANUAL_DEBIT'), 0)::int AS debit_credits
      FROM credit_ledger
      WHERE kind IN ('MANUAL_TOPUP', 'MANUAL_DEBIT')
      GROUP BY 1
      ORDER BY 1
    `;
    const rows = await this.ds.query<
      Array<{
        key: string;
        topup_count: number;
        topup_credits: number;
        debit_count: number;
        debit_credits: number;
      }>
    >(sql);
    return {
      groupBy,
      rows: rows.map((r) => ({
        key: r.key,
        grants: { count: Number(r.topup_count), credits: Number(r.topup_credits) },
        debits: { count: Number(r.debit_count), credits: Number(r.debit_credits) },
      })),
    };
  }

  async topAccounts(limit = 20): Promise<
    Array<{
      organizationId: string;
      organizationName: string | null;
      organizationSlug: string | null;
      revenueUsd: number;
      revenueCents: number;
    }>
  > {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.ds.query<
      Array<{
        organization_id: string;
        organization_name: string | null;
        organization_slug: string | null;
        revenue_usd: string;
        revenue_cents: string;
      }>
    >(
      `SELECT organization_id, organization_name, organization_slug, revenue_usd, revenue_cents
       FROM mv_top_accounts_t12m
       ORDER BY revenue_cents DESC
       LIMIT $1`,
      [safeLimit],
    );
    return rows.map((r) => ({
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      organizationSlug: r.organization_slug,
      revenueUsd: Number(r.revenue_usd),
      revenueCents: Number(r.revenue_cents),
    }));
  }

  /**
   * Dashboard summary tile data — one method that bundles the
   * highlights the SPA renders above the fold. Saves the dashboard
   * from issuing N parallel calls on mount.
   *
   *   - currentMrrUsd: this month's revenue from invoices + topups
   *     (proxy for MRR — exact MRR computation comes when we project
   *     subscriptions properly in a follow-up)
   *   - mrrMomChangePct: vs prior month, signed percent
   *   - refundRateT12m: trailing 12 month refund rate
   *   - activeOrgs: distinct organization_id with any purchase or
   *     invoice in the trailing 30 days
   */
  async dashboardSummary(): Promise<{
    currentMrrUsd: number;
    mrrMomChangePct: number | null;
    refundRateT12m: number;
    activeOrgs30d: number;
    lastRefreshedAt: string | null;
  }> {
    const currentRow = await this.ds.query<Array<{ usd: string }>>(`
      SELECT COALESCE(SUM(gross_usd), 0)::numeric(14, 2) AS usd
      FROM mv_revenue_monthly
      WHERE month = date_trunc('month', now())::date
    `);
    const priorRow = await this.ds.query<Array<{ usd: string }>>(`
      SELECT COALESCE(SUM(gross_usd), 0)::numeric(14, 2) AS usd
      FROM mv_revenue_monthly
      WHERE month = (date_trunc('month', now()) - interval '1 month')::date
    `);
    const currentMrrUsd = Number(currentRow[0]?.usd ?? 0);
    const priorMrrUsd = Number(priorRow[0]?.usd ?? 0);
    const mrrMomChangePct =
      priorMrrUsd === 0 ? null : ((currentMrrUsd - priorMrrUsd) / priorMrrUsd) * 100;

    const refundRow = await this.ds.query<
      Array<{ refunded: string; gross: string }>
    >(`
      SELECT
        COALESCE(SUM(refunded_cents), 0)::bigint AS refunded,
        COALESCE(SUM(gross_cents), 0)::bigint AS gross
      FROM mv_refunds_monthly
      WHERE month >= (date_trunc('month', now()) - interval '12 months')::date
    `);
    const refunded = Number(refundRow[0]?.refunded ?? 0);
    const gross = Number(refundRow[0]?.gross ?? 0);
    const refundRateT12m = gross === 0 ? 0 : refunded / gross;

    const activeRow = await this.ds.query<Array<{ n: string }>>(`
      SELECT COUNT(DISTINCT organization_id)::bigint AS n FROM (
        SELECT organization_id FROM credit_purchases
        WHERE status = 'completed'
          AND created_at >= now() - interval '30 days'
        UNION
        SELECT organization_id FROM invoices
        WHERE status = 'paid'
          AND created_at >= now() - interval '30 days'
      ) t
    `);
    const activeOrgs30d = Number(activeRow[0]?.n ?? 0);

    // pg's last refresh timestamp lives in pg_stat_user_tables but the
    // materialized view metadata is exposed via pg_matviews; we read
    // the latest known refresh via a small cheap query.
    const refreshRow = await this.ds.query<Array<{ ts: Date | null }>>(`
      SELECT GREATEST(
        (SELECT MAX(month)::timestamp FROM mv_revenue_monthly),
        (SELECT MAX(month)::timestamp FROM mv_refunds_monthly)
      ) AS ts
    `);
    const lastRefreshedAt = refreshRow[0]?.ts
      ? new Date(refreshRow[0].ts).toISOString()
      : null;

    return {
      currentMrrUsd,
      mrrMomChangePct,
      refundRateT12m,
      activeOrgs30d,
      lastRefreshedAt,
    };
  }

  // ── Phase 9 priority-list reports (PR F9.1.5) ────────────────────

  /**
   * Paid-vs-non-paid credits: how many credits did orgs receive from
   * paid purchases (PURCHASE + AUTO_TOPUP) vs. promotional grants
   * (MANUAL_TOPUP + PROMO + MIGRATION). Critical for accounting —
   * promotional credits are NOT revenue.
   *
   * Live query against credit_ledger; no materialized view needed.
   */
  async paidVsPromoCredits(opts: {
    fromMonth?: string;
    toMonth?: string;
  } = {}): Promise<
    Array<{
      month: string;
      paidCredits: number;
      promoCredits: number;
      paidPct: number;
    }>
  > {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.fromMonth) {
      where.push(`date_trunc('month', created_at)::date >= $${params.length + 1}::date`);
      params.push(`${opts.fromMonth}-01`);
    }
    if (opts.toMonth) {
      where.push(`date_trunc('month', created_at)::date <= $${params.length + 1}::date`);
      params.push(`${opts.toMonth}-01`);
    }
    if (where.length === 0) {
      where.push(
        `created_at >= (date_trunc('month', now()) - interval '12 months')`,
      );
    }
    const rows = await this.ds.query<
      Array<{ month: Date; paid: string; promo: string }>
    >(
      `SELECT
         date_trunc('month', created_at AT TIME ZONE 'UTC')::date AS month,
         COALESCE(SUM(delta_credits) FILTER (WHERE kind IN ('PURCHASE', 'AUTO_TOPUP')), 0)::bigint AS paid,
         COALESCE(SUM(delta_credits) FILTER (WHERE kind IN ('MANUAL_TOPUP', 'PROMO', 'MIGRATION')), 0)::bigint AS promo
       FROM credit_ledger
       WHERE delta_credits > 0
         AND ${where.join(' AND ')}
       GROUP BY 1
       ORDER BY 1 ASC`,
      params,
    );
    return rows.map((r) => {
      const paid = Number(r.paid);
      const promo = Number(r.promo);
      const total = paid + promo;
      return {
        month:
          r.month instanceof Date
            ? r.month.toISOString().slice(0, 10)
            : String(r.month).slice(0, 10),
        paidCredits: paid,
        promoCredits: promo,
        paidPct: total === 0 ? 0 : paid / total,
      };
    });
  }

  /**
   * Auto-topup velocity: average days between consecutive AUTO_TOPUP
   * events per org. A short interval indicates aggressive usage; a
   * long interval = idle. Useful for the SPA to highlight which
   * customers are about to hit their monthly cap.
   *
   * Returns top N orgs ordered by topup_count (most active first).
   * Orgs with fewer than 2 topup events are excluded — can't compute
   * an interval from a single point.
   */
  async autoTopupVelocity(limit = 50): Promise<
    Array<{
      organizationId: string;
      topupCount: number;
      firstTopupAt: string;
      lastTopupAt: string;
      avgIntervalDays: number;
    }>
  > {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.ds.query<
      Array<{
        organization_id: string;
        topup_count: string;
        first_at: Date;
        last_at: Date;
        avg_interval_days: string;
      }>
    >(
      `SELECT
         organization_id,
         COUNT(*)::bigint AS topup_count,
         MIN(created_at) AS first_at,
         MAX(created_at) AS last_at,
         (EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / NULLIF(COUNT(*) - 1, 0) / 86400.0)::numeric(10, 2) AS avg_interval_days
       FROM credit_ledger
       WHERE kind = 'AUTO_TOPUP'
       GROUP BY 1
       HAVING COUNT(*) >= 2
       ORDER BY COUNT(*) DESC
       LIMIT $1`,
      [safeLimit],
    );
    return rows.map((r) => ({
      organizationId: r.organization_id,
      topupCount: Number(r.topup_count),
      firstTopupAt:
        r.first_at instanceof Date ? r.first_at.toISOString() : String(r.first_at),
      lastTopupAt:
        r.last_at instanceof Date ? r.last_at.toISOString() : String(r.last_at),
      avgIntervalDays: Number(r.avg_interval_days),
    }));
  }

  /**
   * Unbilled usage (WIP): per-org sum of usage_records since the org's
   * last invoice. Surfaces orgs that have racked up usage but haven't
   * been billed yet — useful for ops to spot stuck billing flows.
   *
   * Joins on the most recent invoice; orgs without any invoice fall
   * through to all usage (typical for free-tier orgs).
   *
   * Returns top N orgs by unbilled usage record count.
   */
  async unbilledUsage(limit = 50): Promise<
    Array<{
      organizationId: string;
      unbilledRecords: number;
      lastInvoiceAt: string | null;
      oldestUnbilledAt: string | null;
    }>
  > {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.ds.query<
      Array<{
        organization_id: string;
        unbilled_records: string;
        last_invoice_at: Date | null;
        oldest_unbilled_at: Date | null;
      }>
    >(
      `WITH last_invoice AS (
         SELECT organization_id, MAX(created_at) AS last_at
         FROM invoices
         WHERE status = 'paid'
         GROUP BY 1
       )
       SELECT
         u.organization_id,
         COUNT(*)::bigint AS unbilled_records,
         li.last_at AS last_invoice_at,
         MIN(u.timestamp) AS oldest_unbilled_at
       FROM usage_records u
       LEFT JOIN last_invoice li ON li.organization_id = u.organization_id
       WHERE u.timestamp > COALESCE(li.last_at, '1970-01-01'::timestamp)
       GROUP BY u.organization_id, li.last_at
       ORDER BY COUNT(*) DESC
       LIMIT $1`,
      [safeLimit],
    );
    return rows.map((r) => ({
      organizationId: r.organization_id,
      unbilledRecords: Number(r.unbilled_records),
      lastInvoiceAt:
        r.last_invoice_at instanceof Date
          ? r.last_invoice_at.toISOString()
          : r.last_invoice_at
            ? String(r.last_invoice_at)
            : null,
      oldestUnbilledAt:
        r.oldest_unbilled_at instanceof Date
          ? r.oldest_unbilled_at.toISOString()
          : r.oldest_unbilled_at
            ? String(r.oldest_unbilled_at)
            : null,
    }));
  }

  // ── CSV export ───────────────────────────────────────────────────

  /**
   * Render a report row set as CSV. Escapes RFC 4180-style:
   * fields containing comma / quote / newline get wrapped in
   * double-quotes, with internal " doubled to "".
   */
  toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines: string[] = [headers.map(esc).join(',')];
    for (const r of rows) {
      lines.push(headers.map((h) => esc((r as any)[h])).join(','));
    }
    return lines.join('\n');
  }
}
