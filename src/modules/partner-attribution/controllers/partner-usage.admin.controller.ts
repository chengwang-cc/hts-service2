import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { ApiUsageMetricEntity } from '../../api-keys/entities/api-usage-metric.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

interface PartnerSummaryRow {
  organizationId: string;
  slug: string | null;
  name: string;
  type: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  p95LatencyMs: number | null;
  distinctEndUsers: number;
  lastSeenAt: string | null;
}

/**
 * Internal operator dashboard for partner usage. Authenticated by JWT +
 * AdminGuard. Aggregates the last 24h directly from api_usage_metrics —
 * cheap enough at current volumes; rollup tables come in P3.
 */
@ApiTags('Admin — Partner Usage')
@Controller('api/v1/admin/usage')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PartnerUsageAdminController {
  constructor(
    @InjectRepository(ApiUsageMetricEntity)
    private readonly metrics: Repository<ApiUsageMetricEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
  ) {}

  /**
   * Per-partner summary over the last `hours` (max 168 = 7d). Returns one row
   * per partner with a non-zero request count in the window, plus zero-rows
   * for any seeded partner with no traffic (so the dashboard always shows the
   * full partner list).
   */
  @Get('partners')
  @ApiOperation({ summary: 'Per-partner usage summary' })
  @ApiQuery({ name: 'hours', required: false, description: '1..168, default 24' })
  @ApiResponse({ status: 200, description: 'Partner summary rows' })
  async listPartnerSummary(@Query('hours') hoursParam?: string): Promise<PartnerSummaryRow[]> {
    const hours = this.parseHours(hoursParam);
    const sinceSql = `now() - interval '${hours} hours'`;

    const partners = await this.orgs
      .createQueryBuilder('o')
      .where('o.type IN (:...types)', { types: ['partner', 'internal', 'customer'] })
      .andWhere('o.slug IS NOT NULL')
      .getMany();

    const rows: Array<{
      partner_id: string;
      requests: string;
      errors_4xx: string;
      errors_5xx: string;
      p95_latency_ms: number | null;
      distinct_users: string;
      last_seen_at: Date | null;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select('m.partner_id', 'partner_id')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500)', 'errors_4xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 500)', 'errors_5xx')
      .addSelect('percentile_disc(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)', 'p95_latency_ms')
      .addSelect('COUNT(DISTINCT m.partner_user_id) FILTER (WHERE m.partner_user_id IS NOT NULL)', 'distinct_users')
      .addSelect('MAX(m.timestamp)', 'last_seen_at')
      .where(`m.timestamp > ${sinceSql}`)
      .groupBy('m.partner_id')
      .getRawMany();

    const byPartnerId = new Map(rows.map((r) => [r.partner_id, r]));

    return partners.map((p) => {
      const row = byPartnerId.get(p.id);
      return {
        organizationId: p.id,
        slug: p.slug,
        name: p.name,
        type: p.type,
        requests: row ? Number(row.requests) : 0,
        errors4xx: row ? Number(row.errors_4xx) : 0,
        errors5xx: row ? Number(row.errors_5xx) : 0,
        p95LatencyMs: row?.p95_latency_ms ?? null,
        distinctEndUsers: row ? Number(row.distinct_users) : 0,
        lastSeenAt: row?.last_seen_at ? row.last_seen_at.toISOString() : null,
      };
    });
  }

  /**
   * Hourly request count timeseries for a single partner. Default window
   * is the last 24h. Returns a sparse array of `{hour, status_2xx, 4xx, 5xx}`.
   */
  @Get('timeseries')
  @ApiOperation({ summary: 'Hourly timeseries for a partner' })
  @ApiQuery({ name: 'slug', required: true })
  @ApiQuery({ name: 'hours', required: false, description: '1..168, default 24' })
  async timeseries(
    @Query('slug') slug: string,
    @Query('hours') hoursParam?: string,
  ): Promise<Array<{ hour: string; status2xx: number; status4xx: number; status5xx: number }>> {
    if (!slug) throw new BadRequestException('slug is required');
    const hours = this.parseHours(hoursParam);
    const org = await this.orgs.findOne({ where: { slug } });
    if (!org) return [];

    const sinceSql = `now() - interval '${hours} hours'`;
    const rows: Array<{
      hour: Date;
      status_2xx: string;
      status_4xx: string;
      status_5xx: string;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select(`date_trunc('hour', m.timestamp)`, 'hour')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 200 AND m.status_code < 300)', 'status_2xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500)', 'status_4xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 500)', 'status_5xx')
      .where(`m.timestamp > ${sinceSql}`)
      .andWhere('m.partner_id = :partnerId', { partnerId: org.id })
      .groupBy(`date_trunc('hour', m.timestamp)`)
      .orderBy(`date_trunc('hour', m.timestamp)`, 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      hour: r.hour.toISOString(),
      status2xx: Number(r.status_2xx),
      status4xx: Number(r.status_4xx),
      status5xx: Number(r.status_5xx),
    }));
  }

  private parseHours(raw: string | undefined): number {
    const n = Number(raw ?? 24);
    if (!Number.isFinite(n) || n < 1 || n > 168) {
      throw new BadRequestException('hours must be between 1 and 168');
    }
    return Math.floor(n);
  }
}
