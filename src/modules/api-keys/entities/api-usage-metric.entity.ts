import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiKeyEntity } from './api-key.entity';

/**
 * API Usage Metric Entity
 * Tracks API usage for billing, monitoring, and rate limiting
 */
/**
 * Attribution source for a recorded request. Set by AttributionMiddleware
 * and stamped onto every api_usage_metrics row.
 *
 *   'api_key'      → resolved from X-API-Key (legacy server-to-server)
 *   'partner_key'  → resolved from X-Partner-Key (explicit partner identity)
 *   'jwt'          → resolved from Authorization: Bearer <jwt> (signed-in SPA user)
 *   'origin'       → resolved by matching Origin header in partner_origins
 *   'unknown'      → no match; falls back to the 'unknown' sentinel partner
 */
export type AttributionSource = 'api_key' | 'partner_key' | 'jwt' | 'origin' | 'unknown';

@Entity('api_usage_metrics')
@Index(['apiKeyId', 'timestamp'])
@Index(['organizationId', 'timestamp'])
@Index(['apiKeyId', 'endpoint', 'timestamp'])
@Index(['partnerId', 'timestamp'])
@Index(['partnerUserId', 'timestamp'])
@Index(['endpoint', 'partnerId', 'timestamp'])
@Index(['partnerId', 'contextLabel', 'timestamp'])
export class ApiUsageMetricEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * API Key that made the request. Nullable: anonymous browser traffic
   * attributed by Origin header has no key.
   */
  @Column('uuid', { nullable: true })
  apiKeyId: string | null;

  @ManyToOne(() => ApiKeyEntity, { nullable: true })
  @JoinColumn({ name: 'api_key_id' })
  apiKey: ApiKeyEntity | null;

  /**
   * Organization the request is attributed to. For keyed requests this is
   * the API key's owning org (existing semantic). For anonymous origin-
   * attributed requests this is the partner organization the Origin matched.
   *
   * Stays NOT NULL — the 'unknown' partner row is the catch-all for
   * unmatched anonymous traffic so every metric has an org.
   */
  @Column('uuid')
  organizationId: string;

  /**
   * Canonical attribution target. Always set (= organizationId for new rows;
   * may differ from organizationId in P3 if we let one org operate keys
   * scoped to multiple partner attribution targets).
   * Nullable on legacy rows that pre-date attribution wiring.
   */
  @Column('uuid', { nullable: true })
  partnerId: string | null;

  /**
   * Partner-asserted end-user id (resolved to a partner_users.id). Null for
   * anonymous traffic or when the partner didn't pass the headers.
   */
  @Column('uuid', { nullable: true })
  partnerUserId: string | null;

  /**
   * How the partner was resolved on this request — see AttributionSource.
   */
  @Column('varchar', { length: 20, nullable: true })
  attributionSource: AttributionSource | null;

  /**
   * Origin header value as received. Stored for forensic / audit purposes
   * (e.g., "we attributed this to chitchats but the Origin says foo.com").
   */
  @Column('varchar', { length: 255, nullable: true })
  origin: string | null;

  /**
   * HTS code from the request, denormalized for cheap aggregation
   * ("top 10 HTS codes ChitChats users look up"). Null for endpoints
   * without an HTS context.
   */
  @Column('varchar', { length: 20, nullable: true })
  htsCode: string | null;

  /**
   * ISO country code from the request (calculator only). Null elsewhere.
   */
  @Column('varchar', { length: 8, nullable: true })
  countryCode: string | null;

  /**
   * Request timestamp (bucketed to minute for aggregation)
   */
  @Column('timestamp')
  timestamp: Date;

  /**
   * API endpoint called
   * Example: '/api/v1/hts/lookup', '/api/v1/calculator/calculate'
   */
  @Column('varchar', { length: 255 })
  endpoint: string;

  /**
   * HTTP method
   */
  @Column('varchar', { length: 10 })
  method: string;

  /**
   * Response status code
   */
  @Column('integer')
  statusCode: number;

  /**
   * Response time in milliseconds
   */
  @Column('integer')
  responseTimeMs: number;

  /**
   * Request size in bytes (optional)
   */
  @Column('integer', { nullable: true })
  requestSizeBytes: number | null;

  /**
   * Response size in bytes (optional)
   */
  @Column('integer', { nullable: true })
  responseSizeBytes: number | null;

  /**
   * Client IP address
   */
  @Column('varchar', { length: 45, nullable: true })
  clientIp: string | null;

  /**
   * User agent
   */
  @Column('varchar', { length: 500, nullable: true })
  userAgent: string | null;

  /**
   * Error message (if request failed)
   */
  @Column('text', { nullable: true })
  errorMessage: string | null;

  /**
   * Additional metadata
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  /**
   * Dollar cost charged to the partner for this request. Sum of the per-call
   * baseline (from per-call-pricing.config) plus any AI-provider cost forwarded
   * via req.attribution.extras.costUsd. Stored at 6-decimal precision because
   * embedding/AI calls can be fractions of a cent.
   */
  @Column('numeric', { precision: 12, scale: 6, default: 0 })
  costUsd: number;

  /**
   * LLM input tokens consumed (Anthropic/OpenAI). Zero for non-AI endpoints.
   * Kept separate from costUsd for forensic and provider price-change audits.
   */
  @Column('integer', { default: 0 })
  llmInputTokens: number;

  /**
   * LLM output tokens consumed (Anthropic/OpenAI). Zero for non-AI endpoints.
   */
  @Column('integer', { default: 0 })
  llmOutputTokens: number;

  /**
   * Caller-supplied business context (X-HTS-Context header). Allowlist:
   * checkout | fulfillment | search-ui | other. Used to slice partner usage
   * dashboards (e.g. "how many checkout calls vs. merchant searches").
   */
  @Column('varchar', { length: 32, nullable: true })
  contextLabel: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}

/**
 * API Usage Summary Entity
 * Pre-aggregated metrics for faster dashboard queries
 */
@Entity('api_usage_summaries')
@Index(['apiKeyId', 'date'])
@Index(['organizationId', 'date'])
export class ApiUsageSummaryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * API Key
   */
  @Column('uuid')
  apiKeyId: string;

  /**
   * Organization
   */
  @Column('uuid')
  organizationId: string;

  /**
   * Date (day granularity)
   */
  @Column('date')
  date: Date;

  /**
   * Total requests
   */
  @Column('integer', { default: 0 })
  totalRequests: number;

  /**
   * Successful requests (2xx status)
   */
  @Column('integer', { default: 0 })
  successfulRequests: number;

  /**
   * Failed requests (4xx, 5xx status)
   */
  @Column('integer', { default: 0 })
  failedRequests: number;

  /**
   * Average response time in milliseconds
   */
  @Column('decimal', { precision: 10, scale: 2, default: '0' })
  avgResponseTimeMs: number;

  /**
   * Total data transferred (bytes)
   */
  @Column('bigint', { default: 0 })
  totalDataBytes: number;

  /**
   * Breakdown by endpoint
   * Example: { '/api/v1/hts/lookup': 1500, '/api/v1/calculator/calculate': 300 }
   */
  @Column('jsonb', { nullable: true })
  endpointBreakdown: Record<string, number> | null;

  /**
   * Breakdown by status code
   * Example: { '200': 1700, '400': 50, '500': 50 }
   */
  @Column('jsonb', { nullable: true })
  statusBreakdown: Record<string, number> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column('timestamp')
  updatedAt: Date;
}
