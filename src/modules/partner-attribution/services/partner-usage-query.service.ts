import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiUsageMetricEntity } from '../../api-keys/entities/api-usage-metric.entity';

/**
 * Shared query layer for both the operator-facing admin endpoints and the
 * partner-facing read API. Every method takes an explicit `partnerId` —
 * scope-fencing is the controller's responsibility (admin: any partner;
 * partner: their own only).
 */

export interface SummaryRow {
  requests: number;
  errors4xx: number;
  errors5xx: number;
  p95LatencyMs: number | null;
  distinctEndUsers: number;
  lastSeenAt: string | null;
  firstSeenAt: string | null;
}

export interface TimeseriesPoint {
  bucket: string;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  p95LatencyMs: number | null;
}

export interface EndpointRow {
  endpoint: string;
  method: string;
  requests: number;
  errors: number;
  p95LatencyMs: number | null;
}

export interface TopUserRow {
  partnerUserId: string;
  externalUserId: string | null;
  requests: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface ErrorSampleRow {
  timestamp: string;
  endpoint: string;
  method: string;
  statusCode: number;
  errorMessage: string | null;
  origin: string | null;
}

export interface CostSummaryRow {
  bucketMonth: string; // YYYY-MM-DD (first of month)
  requests: number;
  costUsd: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmCachedTokens: number;
}

/**
 * Per-model cost + token breakdown for a partner over a window. Used by
 * the portal "Cost by model" tile so partners can see which model is
 * driving their spend (and where prompt-cache hits are saving them).
 *
 * `modelName: null` rows roll up all non-AI traffic (calls that didn't
 * touch an LLM) so the totals reconcile with the summary row.
 */
export interface CostByModelRow {
  modelName: string | null;
  calls: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmCachedTokens: number;
  costUsd: number;
}

/**
 * Hard ceiling on the size of a custom date range. 365 days is enough for
 * "show me last year"; beyond that the cost rollup view should be used.
 * Bumped from 30d on 2026-06-04 so the portal range picker can ask for
 * up to a year — the dashboard query itself is bounded by partner_id +
 * an index on (partner_id, timestamp), so the wider window is cheap.
 */
const MAX_HOURS = 24 * 365;

/**
 * Range filter passed by every controller endpoint. `from`/`to` win when
 * both (or just one) are present; otherwise `hours` (an integer string)
 * is used to compute `[now - hours, now]`. Order of precedence is
 * documented in `parseRange()`.
 */
export interface RangeInput {
  hours?: string;
  /** ISO 8601 timestamp. */
  from?: string;
  /** ISO 8601 timestamp. */
  to?: string;
}

interface ResolvedRange {
  from: Date;
  to: Date;
}

function parseHours(raw: string | undefined, defaultHours: number, max = MAX_HOURS): number {
  const n = Number(raw ?? defaultHours);
  if (!Number.isFinite(n) || n < 1 || n > max) {
    throw new BadRequestException(`hours must be between 1 and ${max}`);
  }
  return Math.floor(n);
}

/**
 * Resolve `{ hours }` OR `{ from, to }` into a concrete [from, to] window.
 *
 * Precedence:
 *   - If EITHER `from` or `to` is supplied, range is custom.
 *       missing `from` → defaults to `to - defaultHours`
 *       missing `to`   → defaults to `now`
 *   - Otherwise, `hours` is used to compute `[now - hours, now]`.
 *
 * Validation:
 *   - Both timestamps must parse as ISO.
 *   - `from < to` (no zero-length or inverted windows).
 *   - Total span ≤ `maxHours`.
 *
 * Returned `from` / `to` are Date objects; controllers pass them straight
 * to parameterized SQL — no template-string injection.
 */
function parseRange(
  input: RangeInput,
  defaultHours: number,
  maxHours = MAX_HOURS,
): ResolvedRange {
  const hasCustom = !!(input.from || input.to);
  const now = new Date();
  if (hasCustom) {
    const to = input.to ? new Date(input.to) : now;
    if (Number.isNaN(to.getTime())) {
      throw new BadRequestException('`to` must be an ISO 8601 timestamp');
    }
    const from = input.from
      ? new Date(input.from)
      : new Date(to.getTime() - defaultHours * 3_600_000);
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
  const hours = parseHours(input.hours, defaultHours, maxHours);
  return { from: new Date(now.getTime() - hours * 3_600_000), to: now };
}

function parseLimit(raw: string | undefined, defaultLimit: number, max = 200): number {
  const n = Number(raw ?? defaultLimit);
  if (!Number.isFinite(n) || n < 1 || n > max) {
    throw new BadRequestException(`limit must be between 1 and ${max}`);
  }
  return Math.floor(n);
}

@Injectable()
export class PartnerUsageQueryService {
  constructor(
    @InjectRepository(ApiUsageMetricEntity)
    private readonly metrics: Repository<ApiUsageMetricEntity>,
  ) {}

  async summary(partnerId: string, range: RangeInput): Promise<SummaryRow> {
    const { from, to } = parseRange(range, 24);
    const row = await this.metrics
      .createQueryBuilder('m')
      .select('COUNT(*)', 'requests')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500)', 'errors_4xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 500)', 'errors_5xx')
      .addSelect('percentile_disc(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)', 'p95_latency_ms')
      .addSelect('COUNT(DISTINCT m.partner_user_id) FILTER (WHERE m.partner_user_id IS NOT NULL)', 'distinct_users')
      .addSelect('MAX(m.timestamp)', 'last_seen_at')
      .addSelect('MIN(m.timestamp)', 'first_seen_at')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .andWhere('m.partner_id = :partnerId', { partnerId })
      .getRawOne<{
        requests: string;
        errors_4xx: string;
        errors_5xx: string;
        p95_latency_ms: number | null;
        distinct_users: string;
        last_seen_at: Date | null;
        first_seen_at: Date | null;
      }>();

    return {
      requests: row ? Number(row.requests) : 0,
      errors4xx: row ? Number(row.errors_4xx) : 0,
      errors5xx: row ? Number(row.errors_5xx) : 0,
      p95LatencyMs: row?.p95_latency_ms ?? null,
      distinctEndUsers: row ? Number(row.distinct_users) : 0,
      lastSeenAt: row?.last_seen_at ? row.last_seen_at.toISOString() : null,
      firstSeenAt: row?.first_seen_at ? row.first_seen_at.toISOString() : null,
    };
  }

  async timeseries(
    partnerId: string,
    range: RangeInput,
    bucketParam: 'hour' | 'day' | undefined,
  ): Promise<TimeseriesPoint[]> {
    const { from, to } = parseRange(range, 24);
    const bucket = bucketParam === 'day' ? 'day' : 'hour';
    const rows: Array<{
      bucket: Date;
      status_2xx: string;
      status_4xx: string;
      status_5xx: string;
      p95_latency_ms: number | null;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select(`date_trunc('${bucket}', m.timestamp)`, 'bucket')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 200 AND m.status_code < 300)', 'status_2xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400 AND m.status_code < 500)', 'status_4xx')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 500)', 'status_5xx')
      .addSelect('percentile_disc(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)', 'p95_latency_ms')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .andWhere('m.partner_id = :partnerId', { partnerId })
      .groupBy(`date_trunc('${bucket}', m.timestamp)`)
      .orderBy(`date_trunc('${bucket}', m.timestamp)`, 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      bucket: r.bucket.toISOString(),
      status2xx: Number(r.status_2xx),
      status4xx: Number(r.status_4xx),
      status5xx: Number(r.status_5xx),
      p95LatencyMs: r.p95_latency_ms,
    }));
  }

  async topEndpoints(
    partnerId: string,
    range: RangeInput,
    limitParam: string | undefined,
  ): Promise<EndpointRow[]> {
    const { from, to } = parseRange(range, 24);
    const limit = parseLimit(limitParam, 25);
    const rows: Array<{
      endpoint: string;
      method: string;
      requests: string;
      errors: string;
      p95_latency_ms: number | null;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select('m.endpoint', 'endpoint')
      .addSelect('m.method', 'method')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('COUNT(*) FILTER (WHERE m.status_code >= 400)', 'errors')
      .addSelect('percentile_disc(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)', 'p95_latency_ms')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .andWhere('m.partner_id = :partnerId', { partnerId })
      .groupBy('m.endpoint')
      .addGroupBy('m.method')
      .orderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((r) => ({
      endpoint: r.endpoint,
      method: r.method,
      requests: Number(r.requests),
      errors: Number(r.errors),
      p95LatencyMs: r.p95_latency_ms,
    }));
  }

  async topUsers(
    partnerId: string,
    range: RangeInput,
    limitParam: string | undefined,
  ): Promise<TopUserRow[]> {
    const { from, to } = parseRange(range, 24 * 7);
    const limit = parseLimit(limitParam, 50);

    // Aggregate from metrics (counts), join partner_users for external ids.
    const rows: Array<{
      partner_user_id: string;
      external_user_id: string | null;
      requests: string;
      first_seen_at: Date | null;
      last_seen_at: Date | null;
    }> = await this.metrics
      .createQueryBuilder('m')
      .select('m.partner_user_id', 'partner_user_id')
      .addSelect('pu.external_user_id', 'external_user_id')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('MIN(m.timestamp)', 'first_seen_at')
      .addSelect('MAX(m.timestamp)', 'last_seen_at')
      .leftJoin('partner_users', 'pu', 'pu.id = m.partner_user_id')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .andWhere('m.partner_id = :partnerId', { partnerId })
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
      firstSeenAt: r.first_seen_at?.toISOString() ?? null,
      lastSeenAt: r.last_seen_at?.toISOString() ?? null,
    }));
  }

  async errorSamples(
    partnerId: string,
    range: RangeInput,
    limitParam: string | undefined,
  ): Promise<ErrorSampleRow[]> {
    const { from, to } = parseRange(range, 24);
    const limit = parseLimit(limitParam, 50);
    const rows: ApiUsageMetricEntity[] = await this.metrics
      .createQueryBuilder('m')
      .where('m.timestamp >= :from AND m.timestamp <= :to', { from, to })
      .andWhere('m.partner_id = :partnerId', { partnerId })
      .andWhere('m.status_code >= 400')
      .orderBy('m.timestamp', 'DESC')
      .limit(limit)
      .getMany();

    return rows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      endpoint: r.endpoint,
      method: r.method,
      statusCode: r.statusCode,
      errorMessage: r.errorMessage,
      origin: r.origin,
    }));
  }

  /**
   * Per-month $-cost + request totals for the partner. Reads from
   * partner_usage_monthly (pre-aggregated by PartnerUsageMonthlyRollupWorker).
   * `months` is clamped to [1, 24].
   */
  async costSummary(partnerId: string, monthsParam: string | undefined): Promise<CostSummaryRow[]> {
    const months = parseInteger(monthsParam, 3, 1, 24, 'months');
    const rows: Array<{
      bucket_month: Date;
      requests: string;
      cost_usd: string;
      llm_input_tokens: string;
      llm_output_tokens: string;
      llm_cached_tokens: string;
    }> = await this.metrics.manager.query(
      `SELECT bucket_month,
              SUM(requests)::text AS requests,
              SUM(cost_usd)::text AS cost_usd,
              SUM(llm_input_tokens)::text AS llm_input_tokens,
              SUM(llm_output_tokens)::text AS llm_output_tokens,
              SUM(llm_cached_tokens)::text AS llm_cached_tokens
       FROM partner_usage_monthly
       WHERE partner_id = $1
         AND bucket_month >= date_trunc('month', now() - interval '${months - 1} months')::date
       GROUP BY bucket_month
       ORDER BY bucket_month ASC`,
      [partnerId],
    );

    return rows.map((r) => ({
      bucketMonth: r.bucket_month.toISOString().slice(0, 10),
      requests: Number(r.requests ?? 0),
      costUsd: Number(r.cost_usd ?? 0),
      llmInputTokens: Number(r.llm_input_tokens ?? 0),
      llmOutputTokens: Number(r.llm_output_tokens ?? 0),
      llmCachedTokens: Number(r.llm_cached_tokens ?? 0),
    }));
  }

  /**
   * Per-model cost + token breakdown over the requested window. Read
   * directly from api_usage_metrics so the result reflects partial-month
   * spend in real time (the monthly rollup lags by up to an hour, which
   * is fine for billing but feels stale on a dashboard).
   *
   * Includes a `modelName: null` row when the partner has non-AI traffic
   * in the window — gives partners a single place where AI cost + non-AI
   * usage reconcile to the summary card's totals.
   *
   * Sorted by costUsd DESC so the dominant model leads the list. The UI
   * uses this ordering directly — no per-row "rank" field needed.
   */
  async costByModel(partnerId: string, range: RangeInput): Promise<CostByModelRow[]> {
    const { from, to } = parseRange(range, 24 * 30);
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
      .andWhere('m.partner_id = :partnerId', { partnerId })
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
}

function parseInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new BadRequestException(`${field} must be between ${min} and ${max}`);
  }
  return Math.floor(n);
}
