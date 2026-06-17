import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Materialized views for the financial reports dashboard (Phase 9,
 * PR F9.1).
 *
 * Three views, refreshed nightly at 03:00 UTC by
 * MaterializedViewsRefreshWorker (after the reconciliation cron at
 * 02:00, so reports never reflect un-reconciled data):
 *
 *   mv_revenue_monthly   — gross revenue by month, by source
 *   mv_refunds_monthly   — refunded amount by month + denominator for
 *                          rate calculation
 *   mv_top_accounts_t12m — top revenue accounts, trailing 12 months
 *
 * Each view has a UNIQUE index on its grouping key — required for
 * REFRESH MATERIALIZED VIEW CONCURRENTLY (the non-blocking refresh).
 * Without CONCURRENTLY, refresh takes an EXCLUSIVE lock and the
 * dashboard goes dark for the duration. With it, the new rows swap
 * in atomically once the rebuild finishes.
 *
 * Why use credit_purchases.amount (dollar decimal) here
 * -----------------------------------------------------
 * F7.1 adds amount_minor_units but doesn't backfill existing rows yet
 * — the writer migrations haven't shipped. We use the legacy `amount`
 * column so the views work against today's data and don't bifurcate
 * by data shape. A future PR can swap to amount_minor_units once
 * writers are aligned.
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §13.2
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §10.1
 */
export class FinancialReportsViews1781718504000
  implements MigrationInterface
{
  name = 'FinancialReportsViews1781718504000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── mv_revenue_monthly ──────────────────────────────────────────
    // One row per (month, source). Source = 'credit_purchase' for
    // one-off credit packs, 'invoice' for subscription billing.
    // Status filter keeps refunded/pending rows out of revenue —
    // refunds count separately in mv_refunds_monthly.
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_revenue_monthly" AS
      SELECT
        date_trunc('month', created_at AT TIME ZONE 'UTC')::date AS month,
        'credit_purchase'::varchar AS source,
        COUNT(*)::int AS count,
        COALESCE(SUM(amount), 0)::numeric(14, 2) AS gross_usd,
        COALESCE(SUM(amount * 100), 0)::bigint AS gross_usd_cents
      FROM credit_purchases
      WHERE status = 'completed'
      GROUP BY 1
      UNION ALL
      SELECT
        date_trunc('month', created_at AT TIME ZONE 'UTC')::date AS month,
        'invoice'::varchar AS source,
        COUNT(*)::int AS count,
        COALESCE(SUM(total), 0)::numeric(14, 2) AS gross_usd,
        COALESCE(SUM(total * 100), 0)::bigint AS gross_usd_cents
      FROM invoices
      WHERE status = 'paid'
      GROUP BY 1
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mv_revenue_monthly_month_source"
        ON "mv_revenue_monthly" ("month", "source")
    `);

    // ── mv_refunds_monthly ──────────────────────────────────────────
    // Refund total + count by month, plus denominator (gross
    // payments in the same month, used to compute % refund rate).
    // We snapshot the denominator into the same row so the dashboard
    // doesn't need to join across two views.
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_refunds_monthly" AS
      WITH gross AS (
        SELECT
          date_trunc('month', created_at AT TIME ZONE 'UTC')::date AS month,
          COALESCE(SUM(amount * 100), 0)::bigint AS gross_cents
        FROM credit_purchases
        WHERE status = 'completed'
        GROUP BY 1
      )
      SELECT
        date_trunc('month', r.created_at AT TIME ZONE 'UTC')::date AS month,
        COUNT(*)::int AS refund_count,
        COALESCE(SUM(r.amount_minor_units::bigint), 0)::bigint AS refunded_cents,
        COALESCE(SUM(r.credits_returned), 0)::int AS credits_returned,
        COALESCE(g.gross_cents, 0)::bigint AS gross_cents,
        CASE
          WHEN COALESCE(g.gross_cents, 0) = 0 THEN 0
          ELSE (SUM(r.amount_minor_units::bigint)::numeric / g.gross_cents)::numeric(8, 6)
        END AS refund_rate
      FROM refunds r
      LEFT JOIN gross g
        ON g.month = date_trunc('month', r.created_at AT TIME ZONE 'UTC')::date
      WHERE r.status = 'succeeded'
      GROUP BY 1, g.gross_cents
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mv_refunds_monthly_month"
        ON "mv_refunds_monthly" ("month")
    `);

    // ── mv_top_accounts_t12m ────────────────────────────────────────
    // Top revenue accounts over the trailing 12 months. Aggregates
    // credit_purchases + invoices per org. The view is refreshed
    // nightly so "trailing 12 months" advances as the clock does.
    // We compute the window inside the view using now() at refresh
    // time — that's the only place the view depends on wall-clock,
    // and it's fine because we refresh daily.
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_top_accounts_t12m" AS
      WITH revenue AS (
        SELECT organization_id, COALESCE(SUM(amount * 100), 0)::bigint AS cents
        FROM credit_purchases
        WHERE status = 'completed'
          AND created_at >= now() - interval '12 months'
        GROUP BY 1
        UNION ALL
        SELECT organization_id, COALESCE(SUM(total * 100), 0)::bigint AS cents
        FROM invoices
        WHERE status = 'paid'
          AND created_at >= now() - interval '12 months'
        GROUP BY 1
      )
      SELECT
        r.organization_id,
        o.name AS organization_name,
        o.slug AS organization_slug,
        SUM(r.cents)::bigint AS revenue_cents,
        (SUM(r.cents)::numeric / 100)::numeric(14, 2) AS revenue_usd
      FROM revenue r
      LEFT JOIN organizations o ON o.id = r.organization_id
      GROUP BY 1, 2, 3
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mv_top_accounts_t12m_org"
        ON "mv_top_accounts_t12m" ("organization_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_mv_top_accounts_t12m_revenue"
        ON "mv_top_accounts_t12m" ("revenue_cents" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP MATERIALIZED VIEW IF EXISTS "mv_top_accounts_t12m"`,
    );
    await queryRunner.query(
      `DROP MATERIALIZED VIEW IF EXISTS "mv_refunds_monthly"`,
    );
    await queryRunner.query(
      `DROP MATERIALIZED VIEW IF EXISTS "mv_revenue_monthly"`,
    );
  }
}
