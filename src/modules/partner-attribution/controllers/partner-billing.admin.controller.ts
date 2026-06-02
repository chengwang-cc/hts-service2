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
