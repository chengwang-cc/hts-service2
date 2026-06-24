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
  /** Dollar cost for the window. Sum of per-request cost_usd. */
  costUsd: number;
  /** Total LLM input tokens consumed by this partner in the window. */
  llmInputTokens: number;
  /** Total LLM output tokens consumed by this partner in the window. */
  llmOutputTokens: number;
  /**
   * Cached input tokens served from provider cache. Subset of
   * llmInputTokens. Used by the dashboard to surface "% from cache" —
   * a useful efficiency signal when tuning prompts.
   */
  llmCachedTokens: number;
  /** Primary model name by spend, or null if no AI traffic. */
  primaryModelName: string | null;
}

interface PlatformCostByModelRow {
  modelName: string | null;
  calls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmCachedTokens: number;
  costUsd: number;
}

interface TopClientRow {
  /** Internal partner_users.id. */
  partnerUserId: string;
  /** Partner-supplied end-user id (X-Partner-User-Id / token sub), or null. */
  externalUserId: string | null;
  requests: number;
  /** 4xx + 5xx in the window. */
  errors: number;
  costUsd: number;
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
   * Per-partner summary over the selected window. Returns one row
   * per partner with a non-zero request count in the window, plus zero-rows
   * for any seeded partner with no traffic (so the dashboard always shows the
   * full partner list).
   *
   * Window resolution: explicit `from`/`to` win when present, otherwise
   * `hours` (defaults to 24). Max 365d to match the portal range picker.
   */
  @Get('partners')
  @ApiOperation({ summary: 'Per-partner usage summary' })
  @ApiQuery({ name: 'hours', required: false, description: '1..8760 (365d), default 24' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601' })
  @ApiResponse({ status: 200, description: 'Partner summary rows' })
  async listPartnerSummary(
    @Query('hours') hoursParam?: string,
    @Query('from') fromParam?: string,
    @Query('to') toParam?: string,
  ): Promise<PartnerSummaryRow[]> {
    const { from, to } = this.parseRange(hoursParam, fromParam, toParam);

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
      cost_usd: string;
      llm_input_tokens: string;
      llm_output_tokens: string;
      llm_cached_tokens: string;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select('m.partner_id', 'partner_id')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500)', 'errors_4xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 500)', 'errors_5xx')
      .addSelect('percentile_disc(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)', 'p95_latency_ms')
      .addSelect('COUNT(DISTINCT m.partner_user_id) FILTER (WHERE m.partner_user_id IS NOT NULL)', 'distinct_users')
      .addSelect('MAX(m.timestamp)', 'last_seen_at')
      .addSelect('COALESCE(SUM(m.cost_usd), 0)', 'cost_usd')
      .addSelect('COALESCE(SUM(m.llm_input_tokens), 0)', 'llm_input_tokens')
      .addSelect('COALESCE(SUM(m.llm_output_tokens), 0)', 'llm_output_tokens')
      .addSelect('COALESCE(SUM(m.llm_cached_tokens), 0)', 'llm_cached_tokens')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .groupBy('m.partner_id')
      .getRawMany();

    const byPartnerId = new Map(rows.map((r) => [r.partner_id, r]));

    // Resolve each partner's primary model with a separate, lean query —
    // doing it inline would force an aggregate-of-aggregates that
    // PostgreSQL can't evaluate without a subquery. Two round-trips is
    // a fine tradeoff for the admin dashboard which loads on operator
    // action, not on every page view.
    const primaryModelRows: Array<{ partner_id: string; model_name: string }> =
      await this.metrics
        .createQueryBuilder('m')
        .select('m.partner_id', 'partner_id')
        .addSelect('m.model_name', 'model_name')
        .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
        .andWhere('m.model_name IS NOT NULL')
        .groupBy('m.partner_id')
        .addGroupBy('m.model_name')
        .orderBy('m.partner_id', 'ASC')
        .addOrderBy('COALESCE(SUM(m.cost_usd), 0)', 'DESC')
        .getRawMany();

    const primaryModelByPartnerId = new Map<string, string>();
    for (const row of primaryModelRows) {
      // First row per partner_id wins because we ordered by cost DESC.
      if (!primaryModelByPartnerId.has(row.partner_id)) {
        primaryModelByPartnerId.set(row.partner_id, row.model_name);
      }
    }

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
        costUsd: row ? Number(row.cost_usd) : 0,
        llmInputTokens: row ? Number(row.llm_input_tokens) : 0,
        llmOutputTokens: row ? Number(row.llm_output_tokens) : 0,
        llmCachedTokens: row ? Number(row.llm_cached_tokens) : 0,
        primaryModelName: primaryModelByPartnerId.get(p.id) ?? null,
      };
    });
  }

  /**
   * Platform-wide per-model cost + token breakdown over the requested
   * window. Used by the admin dashboard "Which model is driving cost?"
   * tile — answers "are we spending more on gpt-5.4-mini or gpt-5.4?"
   * without forcing the operator to sum across the per-partner table.
   *
   * Sorted by costUsd DESC. `modelName: null` is included so non-AI
   * traffic reconciles with the per-partner summary totals.
   */
  @Get('cost-by-model')
  @ApiOperation({ summary: 'Platform-wide per-model cost + token breakdown' })
  @ApiQuery({ name: 'hours', required: false, description: '1..8760 (365d), default 24' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601' })
  async costByModel(
    @Query('hours') hoursParam?: string,
    @Query('from') fromParam?: string,
    @Query('to') toParam?: string,
  ): Promise<PlatformCostByModelRow[]> {
    const { from, to } = this.parseRange(hoursParam, fromParam, toParam);
    const rows: Array<{
      model_name: string | null;
      calls: string;
      llm_input_tokens: string;
      llm_output_tokens: string;
      llm_cached_tokens: string;
      cost_usd: string;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select('m.model_name', 'model_name')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('COALESCE(SUM(m.llm_input_tokens), 0)', 'llm_input_tokens')
      .addSelect('COALESCE(SUM(m.llm_output_tokens), 0)', 'llm_output_tokens')
      .addSelect('COALESCE(SUM(m.llm_cached_tokens), 0)', 'llm_cached_tokens')
      .addSelect('COALESCE(SUM(m.cost_usd), 0)', 'cost_usd')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .groupBy('m.model_name')
      .orderBy('COALESCE(SUM(m.cost_usd), 0)', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      modelName: r.model_name,
      calls: Number(r.calls ?? 0),
      llmInputTokens: Number(r.llm_input_tokens ?? 0),
      llmOutputTokens: Number(r.llm_output_tokens ?? 0),
      llmCachedTokens: Number(r.llm_cached_tokens ?? 0),
      costUsd: Number(r.cost_usd ?? 0),
    }));
  }

  /**
   * Per-bucket request count timeseries for a single partner. Bucket is
   * 'hour' unless the selected range exceeds 14 days, in which case it
   * auto-switches to 'day' so the chart doesn't render hundreds of bars.
   *
   * Window resolution: explicit `from`/`to` win when present, otherwise
   * `hours`. Default 24h.
   */
  @Get('timeseries')
  @ApiOperation({ summary: 'Hourly / daily timeseries for a partner' })
  @ApiQuery({ name: 'slug', required: true })
  @ApiQuery({ name: 'hours', required: false, description: '1..8760 (365d), default 24' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601' })
  async timeseries(
    @Query('slug') slug: string,
    @Query('hours') hoursParam?: string,
    @Query('from') fromParam?: string,
    @Query('to') toParam?: string,
  ): Promise<Array<{ hour: string; status2xx: number; status4xx: number; status5xx: number }>> {
    if (!slug) throw new BadRequestException('slug is required');
    const { from, to } = this.parseRange(hoursParam, fromParam, toParam);
    const org = await this.orgs.findOne({ where: { slug } });
    if (!org) return [];

    // Auto-bucket: above 14 days the hourly grid is too dense to render
    // legibly. 'day' truncation keeps the chart readable for month/year
    // ranges. The response field stays named `hour` for backwards
    // compatibility with the existing TimeseriesPoint type on the SPA.
    const spanMs = to.getTime() - from.getTime();
    const bucket = spanMs > 14 * 24 * 3_600_000 ? 'day' : 'hour';

    const rows: Array<{
      hour: Date;
      status_2xx: string;
      status_4xx: string;
      status_5xx: string;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select(`date_trunc('${bucket}', m.timestamp)`, 'hour')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 200 AND m.status_code < 300)', 'status_2xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500)', 'status_4xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 500)', 'status_5xx')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .andWhere('m.partner_id = :partnerId', { partnerId: org.id })
      .groupBy(`date_trunc('${bucket}', m.timestamp)`)
      .orderBy(`date_trunc('${bucket}', m.timestamp)`, 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      hour: r.hour.toISOString(),
      status2xx: Number(r.status_2xx),
      status4xx: Number(r.status_4xx),
      status5xx: Number(r.status_5xx),
    }));
  }

  /**
   * Top end-clients (partner_user) for a single partner over the window —
   * the per-client drill-down behind /admin/usage/:slug.
   *
   * Only requests carrying an end-user id contribute: partners must send
   * `X-Partner-User-Id` (or the signed `X-Partner-User-Token`) for their
   * sub-clients to appear here. Requests with a null partner_user_id are
   * excluded — the SPA surfaces an "unattributed" hint when the result is
   * empty so operators know the partner simply isn't passing the header
   * rather than having no traffic.
   *
   * Sorted by request count DESC. `limit` defaults to 50 (max 200).
   */
  @Get('clients')
  @ApiOperation({ summary: 'Top end-clients (partner_user) for a partner' })
  @ApiQuery({ name: 'slug', required: true })
  @ApiQuery({ name: 'hours', required: false, description: '1..8760 (365d), default 24' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601' })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 50' })
  async clients(
    @Query('slug') slug: string,
    @Query('hours') hoursParam?: string,
    @Query('from') fromParam?: string,
    @Query('to') toParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<TopClientRow[]> {
    if (!slug) throw new BadRequestException('slug is required');
    const { from, to } = this.parseRange(hoursParam, fromParam, toParam);
    const org = await this.orgs.findOne({ where: { slug } });
    if (!org) return [];
    const limit = Math.min(Math.max(parseInt(limitParam ?? '50', 10) || 50, 1), 200);

    const rows: Array<{
      partner_user_id: string;
      external_user_id: string | null;
      requests: string;
      errors: string;
      cost_usd: string;
      last_seen_at: Date | null;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select('m.partner_user_id', 'partner_user_id')
      .addSelect('pu.external_user_id', 'external_user_id')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400)', 'errors')
      .addSelect('COALESCE(SUM(m.cost_usd), 0)', 'cost_usd')
      .addSelect('MAX(m.timestamp)', 'last_seen_at')
      .leftJoin('partner_users', 'pu', 'pu.id = m.partner_user_id')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .andWhere('m.partner_id = :partnerId', { partnerId: org.id })
      .andWhere('m.partner_user_id IS NOT NULL')
      .groupBy('m.partner_user_id')
      .addGroupBy('pu.external_user_id')
      .orderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((r) => ({
      partnerUserId: r.partner_user_id,
      externalUserId: r.external_user_id,
      requests: Number(r.requests),
      errors: Number(r.errors),
      costUsd: Number(r.cost_usd),
      lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
    }));
  }

  private parseRange(
    hoursRaw: string | undefined,
    fromRaw: string | undefined,
    toRaw: string | undefined,
    maxHours = 24 * 365,
  ): { from: Date; to: Date } {
    if (fromRaw || toRaw) {
      const to = toRaw ? new Date(toRaw) : new Date();
      if (Number.isNaN(to.getTime())) {
        throw new BadRequestException('`to` must be an ISO 8601 timestamp');
      }
      const from = fromRaw
        ? new Date(fromRaw)
        : new Date(to.getTime() - 24 * 3_600_000);
      if (Number.isNaN(from.getTime())) {
        throw new BadRequestException('`from` must be an ISO 8601 timestamp');
      }
      if (from >= to) {
        throw new BadRequestException('`from` must be strictly before `to`');
      }
      const hours = (to.getTime() - from.getTime()) / 3_600_000;
      if (hours > maxHours) {
        throw new BadRequestException(
          `range cannot exceed ${maxHours} hours (~${Math.floor(maxHours / 24)} days)`,
        );
      }
      return { from, to };
    }
    const n = Number(hoursRaw ?? 24);
    if (!Number.isFinite(n) || n < 1 || n > maxHours) {
      throw new BadRequestException(`hours must be between 1 and ${maxHours}`);
    }
    const hours = Math.floor(n);
    const to = new Date();
    return { from: new Date(to.getTime() - hours * 3_600_000), to };
  }
}
