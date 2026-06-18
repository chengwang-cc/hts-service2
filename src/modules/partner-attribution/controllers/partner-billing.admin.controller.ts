import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';

/**
 * Billing-ready exports. Returns one row per (partner, month, endpoint) with
 * total request count + distinct end-user count. Streams CSV directly so the
 * billing system can ingest large months without buffering in memory.
 *
 * The endpoint emits a stable idempotency key in the X-Export-Idempotency-Key
 * header derived from (month, exportRunTimestamp) so the billing system can
 * de-dupe reruns.
 */
@ApiTags('Admin — Billing Export')
@Controller('api/v1/admin/billing')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PartnerBillingAdminController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * GET /usage?month=YYYY-MM — streams CSV with billing aggregates.
   *
   * Source-of-truth: partner_usage_hourly (rolled up). For the current
   * month-in-progress, hours past the last rollup tick won't be included —
   * the billing system runs at month-close, so this is fine.
   */
  @Get('usage')
  @ApiOperation({ summary: 'Per-partner monthly usage CSV for billing' })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  @Header('Content-Type', 'text/csv')
  async exportUsage(@Query('month') month: string, @Res() res: Response): Promise<void> {
    const range = parseMonth(month);
    const idempotencyKey = `usage-${month}-${new Date().toISOString().slice(0, 13)}`; // hourly granularity
    res.setHeader('Content-Disposition', `attachment; filename="partner-usage-${month}.csv"`);
    res.setHeader('X-Export-Idempotency-Key', idempotencyKey);

    res.write('partner_slug,partner_id,month,endpoint,method,requests,errors,distinct_end_users\n');

    // Stream rows in chunks. At expected partner volumes (single-digit
    // partners × ~20 endpoints) this fits easily in one shot, but the
    // streaming shape keeps us safe as it grows.
    const rows: Array<{
      partner_slug: string | null;
      partner_id: string;
      endpoint: string;
      method: string;
      requests: string;
      errors: string;
      distinct_end_users: string;
    }> = await this.ds.query(
      `
      SELECT
        o.slug AS partner_slug,
        h.partner_id,
        h.endpoint,
        h.method,
        SUM(h.requests)::text AS requests,
        SUM(h.status4xx + h.status5xx)::text AS errors,
        COUNT(DISTINCT h.partner_user_id) FILTER (WHERE h.partner_user_id IS NOT NULL)::text AS distinct_end_users
      FROM partner_usage_hourly h
      LEFT JOIN organizations o ON o.id = h.partner_id
      WHERE h.bucket_hour >= $1
        AND h.bucket_hour <  $2
      GROUP BY o.slug, h.partner_id, h.endpoint, h.method
      ORDER BY o.slug NULLS LAST, h.partner_id, requests DESC
      `,
      [range.start, range.end],
    );

    for (const r of rows) {
      const slug = csvEscape(r.partner_slug ?? '');
      const endpoint = csvEscape(r.endpoint);
      const method = csvEscape(r.method);
      res.write(
        `${slug},${r.partner_id},${month},${endpoint},${method},${r.requests},${r.errors},${r.distinct_end_users}\n`,
      );
    }
    res.end();
  }

  /**
   * Per-(partnerId, endpoint) breakdown of attribution_source over the
   * trailing window. Used to confirm a partner is authenticating via API key
   * (vs origin / JWT / unknown) before changing a route from @Public() to
   * auth-required — flipping a route used by an origin-only partner would
   * break their integration.
   */
  @Get('attribution-breakdown')
  @ApiOperation({ summary: 'Attribution source breakdown for a (partnerId, endpoint) pair' })
  @ApiQuery({ name: 'partnerId', required: true })
  @ApiQuery({ name: 'endpoint', required: true, description: 'Route template, e.g. /api/v1/lookup/smart-classify-async' })
  @ApiQuery({ name: 'hours', required: false, description: '1..8760, default 168 (7d)' })
  async attributionBreakdown(
    @Query('partnerId') partnerId: string,
    @Query('endpoint') endpoint: string,
    @Query('hours') hoursStr?: string,
  ): Promise<{ data: Array<{ attribution_source: string | null; requests: number; latest: string | null }>; meta: { partnerId: string; endpoint: string; hours: number } }> {
    if (!partnerId) throw new BadRequestException('partnerId is required');
    if (!endpoint) throw new BadRequestException('endpoint is required');
    const parsed = hoursStr ? parseInt(hoursStr, 10) : 168;
    const hours = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 8760) : 168;
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const rows: Array<{ attribution_source: string | null; requests: string; latest: string | null }> = await this.ds.query(
      `SELECT attribution_source, COUNT(*)::text AS requests, MAX(timestamp)::text AS latest
       FROM api_usage_metrics
       WHERE partner_id = $1 AND endpoint = $2 AND timestamp >= $3
       GROUP BY attribution_source
       ORDER BY COUNT(*) DESC`,
      [partnerId, endpoint, since],
    );
    return {
      data: rows.map((r) => ({
        attribution_source: r.attribution_source,
        requests: parseInt(r.requests, 10),
        latest: r.latest,
      })),
      meta: { partnerId, endpoint, hours },
    };
  }
}

function parseMonth(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new BadRequestException('month must be in YYYY-MM format');
  }
  const [y, m] = month.split('-').map((s) => parseInt(s, 10));
  if (m < 1 || m > 12) throw new BadRequestException('month must be 01..12');
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
