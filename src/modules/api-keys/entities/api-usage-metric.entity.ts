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
@Entity('api_usage_metrics')
@Index(['apiKeyId', 'timestamp'])
@Index(['organizationId', 'timestamp'])
@Index(['apiKeyId', 'endpoint', 'timestamp'])
export class ApiUsageMetricEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * API Key that made the request
   */
  @Column('uuid')
  apiKeyId: string;

  @ManyToOne(() => ApiKeyEntity)
  @JoinColumn({ name: 'api_key_id' })
  apiKey: ApiKeyEntity;

  /**
   * Organization (denormalized for faster queries)
   */
  @Column('uuid')
  organizationId: string;

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
  @Column('decimal', { precision: 10, scale: 2, default: 0 })
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
