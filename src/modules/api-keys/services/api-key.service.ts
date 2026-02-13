import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import * as crypto from 'crypto';
import { ApiKeyEntity } from '../entities/api-key.entity';
import {
  ApiUsageMetricEntity,
  ApiUsageSummaryEntity,
} from '../entities/api-usage-metric.entity';

/**
 * API Key Service
 * Handles API key creation, validation, and usage tracking
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  // Cache for validated keys (TTL: 5 minutes)
  private readonly keyCache = new Map<
    string,
    { data: ApiKeyEntity; expiresAt: number }
  >();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeyRepository: Repository<ApiKeyEntity>,
    @InjectRepository(ApiUsageMetricEntity)
    private readonly usageMetricRepository: Repository<ApiUsageMetricEntity>,
    @InjectRepository(ApiUsageSummaryEntity)
    private readonly usageSummaryRepository: Repository<ApiUsageSummaryEntity>,
  ) {
    // Clean cache every 10 minutes
    setInterval(() => this.cleanCache(), 10 * 60 * 1000);
  }

  /**
   * Generate a new API key
   * Format: hts_{env}_{32_random_chars}
   */
  async generateApiKey(params: {
    organizationId: string;
    name: string;
    description?: string;
    environment: 'test' | 'live';
    permissions: string[];
    rateLimitPerMinute?: number;
    rateLimitPerDay?: number;
    expiresAt?: Date;
    ipWhitelist?: string[];
    allowedOrigins?: string[];
    createdBy?: string;
  }): Promise<{ apiKey: ApiKeyEntity; plainTextKey: string }> {
    // Generate random key
    const randomBytes = crypto.randomBytes(24);
    const plainTextKey = `hts_${params.environment}_${randomBytes.toString('base64url')}`;

    // Hash the key for storage
    const keyHash = this.hashKey(plainTextKey);

    // Extract prefix for display (first 20 chars)
    const keyPrefix = plainTextKey.substring(0, 20);

    // Create entity
    const apiKey = this.apiKeyRepository.create({
      keyHash,
      keyPrefix,
      name: params.name,
      description: params.description || null,
      organizationId: params.organizationId,
      environment: params.environment,
      permissions: params.permissions,
      rateLimitPerMinute: params.rateLimitPerMinute || 60,
      rateLimitPerDay: params.rateLimitPerDay || 10000,
      expiresAt: params.expiresAt || null,
      ipWhitelist: params.ipWhitelist || null,
      allowedOrigins: params.allowedOrigins || null,
      createdBy: params.createdBy || null,
      isActive: true,
      metadata: {},
    });

    const savedKey = await this.apiKeyRepository.save(apiKey);

    this.logger.log(
      `Generated new API key: ${keyPrefix}... for organization ${params.organizationId}`,
    );

    // Return both entity and plain-text key (only time it's available)
    return {
      apiKey: savedKey,
      plainTextKey,
    };
  }

  /**
   * Validate an API key
   * Returns the key entity if valid, throws UnauthorizedException if invalid
   */
  async validateApiKey(plainTextKey: string): Promise<ApiKeyEntity> {
    const keyHash = this.hashKey(plainTextKey);

    // Check cache first
    const cached = this.keyCache.get(keyHash);
    if (cached && cached.expiresAt > Date.now()) {
      // Update lastUsedAt asynchronously (don't await)
      this.updateLastUsedAt(cached.data.id).catch((err) =>
        this.logger.error(`Failed to update lastUsedAt: ${err.message}`),
      );
      return cached.data;
    }

    // Query database
    const apiKey = await this.apiKeyRepository.findOne({
      where: { keyHash },
      relations: ['organization'],
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Check if active
    if (!apiKey.isActive) {
      throw new UnauthorizedException('API key is inactive');
    }

    // Check if expired
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    // Cache the result
    this.keyCache.set(keyHash, {
      data: apiKey,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    // Update lastUsedAt asynchronously
    this.updateLastUsedAt(apiKey.id).catch((err) =>
      this.logger.error(`Failed to update lastUsedAt: ${err.message}`),
    );

    return apiKey;
  }

  /**
   * Check if API key has permission
   */
  hasPermission(apiKey: ApiKeyEntity, permission: string): boolean {
    // Wildcard permission
    if (apiKey.permissions.includes('*')) {
      return true;
    }

    // Exact match
    if (apiKey.permissions.includes(permission)) {
      return true;
    }

    // Prefix match (e.g., 'hts:*' matches 'hts:lookup', 'hts:calculate')
    const permissionPrefix = permission.split(':')[0];
    if (apiKey.permissions.includes(`${permissionPrefix}:*`)) {
      return true;
    }

    return false;
  }

  /**
   * Check rate limit
   * Returns true if under limit, false if exceeded
   */
  async checkRateLimit(
    apiKey: ApiKeyEntity,
    granularity: 'minute' | 'day',
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now = new Date();
    let startTime: Date;
    let limit: number;

    if (granularity === 'minute') {
      // Check last minute
      startTime = new Date(now.getTime() - 60 * 1000);
      limit = apiKey.rateLimitPerMinute;
    } else {
      // Check last 24 hours
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      limit = apiKey.rateLimitPerDay;
    }

    // Count requests in time window
    const count = await this.usageMetricRepository.count({
      where: {
        apiKeyId: apiKey.id,
        timestamp: MoreThan(startTime),
      },
    });

    const allowed = count < limit;
    const remaining = Math.max(0, limit - count);

    // Calculate reset time
    const resetAt =
      granularity === 'minute'
        ? new Date(now.getTime() + 60 * 1000)
        : new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return { allowed, remaining, resetAt };
  }

  /**
   * Track API usage
   */
  async trackUsage(params: {
    apiKeyId: string;
    organizationId: string;
    endpoint: string;
    method: string;
    statusCode: number;
    responseTimeMs: number;
    requestSizeBytes?: number;
    responseSizeBytes?: number;
    clientIp?: string;
    userAgent?: string;
    errorMessage?: string;
  }): Promise<void> {
    // Round timestamp to minute for aggregation
    const timestamp = new Date();
    timestamp.setSeconds(0, 0);

    const metric = this.usageMetricRepository.create({
      apiKeyId: params.apiKeyId,
      organizationId: params.organizationId,
      timestamp,
      endpoint: params.endpoint,
      method: params.method,
      statusCode: params.statusCode,
      responseTimeMs: params.responseTimeMs,
      requestSizeBytes: params.requestSizeBytes || null,
      responseSizeBytes: params.responseSizeBytes || null,
      clientIp: params.clientIp || null,
      userAgent: params.userAgent || null,
      errorMessage: params.errorMessage || null,
    });

    // Save asynchronously (fire-and-forget)
    this.usageMetricRepository.save(metric).catch((err) => {
      this.logger.error(`Failed to save usage metric: ${err.message}`);
    });

    // Update daily summary asynchronously
    this.updateDailySummary(params).catch((err) => {
      this.logger.error(`Failed to update daily summary: ${err.message}`);
    });
  }

  /**
   * Revoke an API key (mark as inactive)
   */
  async revokeApiKey(id: string): Promise<void> {
    await this.apiKeyRepository.update(id, { isActive: false });

    // Remove from cache
    const apiKey = await this.apiKeyRepository.findOne({ where: { id } });
    if (apiKey) {
      this.keyCache.delete(apiKey.keyHash);
    }

    this.logger.log(`Revoked API key: ${id}`);
  }

  /**
   * List API keys for an organization
   */
  async listApiKeys(organizationId: string): Promise<ApiKeyEntity[]> {
    return this.apiKeyRepository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get usage statistics for an API key
   */
  async getUsageStats(
    apiKeyId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ApiUsageSummaryEntity[]> {
    return this.usageSummaryRepository.find({
      where: {
        apiKeyId,
        date: MoreThan(startDate) && LessThan(endDate),
      },
      order: { date: 'ASC' },
    });
  }

  /**
   * Hash an API key using SHA-256
   */
  private hashKey(plainTextKey: string): string {
    return crypto.createHash('sha256').update(plainTextKey).digest('hex');
  }

  /**
   * Update lastUsedAt timestamp
   */
  private async updateLastUsedAt(apiKeyId: string): Promise<void> {
    await this.apiKeyRepository.update(apiKeyId, { lastUsedAt: new Date() });
  }

  /**
   * Update daily usage summary
   */
  private async updateDailySummary(params: {
    apiKeyId: string;
    organizationId: string;
    endpoint: string;
    statusCode: number;
    responseTimeMs: number;
    responseSizeBytes?: number;
  }): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find or create summary for today
    let summary = await this.usageSummaryRepository.findOne({
      where: {
        apiKeyId: params.apiKeyId,
        date: today,
      },
    });

    if (!summary) {
      summary = this.usageSummaryRepository.create({
        apiKeyId: params.apiKeyId,
        organizationId: params.organizationId,
        date: today,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTimeMs: 0,
        totalDataBytes: 0,
        endpointBreakdown: {},
        statusBreakdown: {},
        updatedAt: new Date(),
      });
    }

    // Update counters
    summary.totalRequests += 1;
    if (params.statusCode >= 200 && params.statusCode < 300) {
      summary.successfulRequests += 1;
    } else {
      summary.failedRequests += 1;
    }

    // Update average response time
    summary.avgResponseTimeMs = Number(
      (
        (summary.avgResponseTimeMs * (summary.totalRequests - 1) +
          params.responseTimeMs) /
        summary.totalRequests
      ).toFixed(2),
    );

    // Update data transferred
    if (params.responseSizeBytes) {
      summary.totalDataBytes += params.responseSizeBytes;
    }

    // Update endpoint breakdown
    if (!summary.endpointBreakdown) {
      summary.endpointBreakdown = {};
    }
    summary.endpointBreakdown[params.endpoint] =
      (summary.endpointBreakdown[params.endpoint] || 0) + 1;

    // Update status breakdown
    if (!summary.statusBreakdown) {
      summary.statusBreakdown = {};
    }
    const statusKey = params.statusCode.toString();
    summary.statusBreakdown[statusKey] =
      (summary.statusBreakdown[statusKey] || 0) + 1;

    summary.updatedAt = new Date();

    await this.usageSummaryRepository.save(summary);
  }

  /**
   * Clean expired cache entries
   */
  private cleanCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.keyCache.entries()) {
      if (value.expiresAt <= now) {
        this.keyCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} expired cache entries`);
    }
  }
}
