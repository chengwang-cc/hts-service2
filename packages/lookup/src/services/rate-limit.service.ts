import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiUsageEntity } from '../entities/api-usage.entity';

export interface RateLimitConfig {
  guest: number; // Daily limit for guest users
  authenticated: number; // Base daily limit for authenticated users
  planMultipliers?: Record<string, number>; // Optional multipliers per plan
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  resetAt: Date;
}

/**
 * Rate Limiting Service
 * Enforces daily API usage limits for guest and authenticated users
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  // Default configuration for smart search endpoints
  private readonly defaultConfig: RateLimitConfig = {
    guest: 10, // Guest users: 10 per day
    authenticated: 20, // Authenticated users: 20 per day
    planMultipliers: {
      FREE: 1, // 20 * 1 = 20 per day
      STARTER: 2, // 20 * 2 = 40 per day
      PROFESSIONAL: 5, // 20 * 5 = 100 per day
      ENTERPRISE: -1, // unlimited
    },
  };

  constructor(
    @InjectRepository(ApiUsageEntity)
    private readonly apiUsageRepo: Repository<ApiUsageEntity>,
  ) {}

  /**
   * Check if a request is allowed under rate limits
   * @param endpoint The endpoint being accessed (e.g., 'classify-url')
   * @param organizationId Organization ID for authenticated users (null for guests)
   * @param ipAddress IP address (used for guests or as fallback)
   * @param plan Subscription plan (for plan-based limits)
   * @param config Optional custom rate limit configuration
   */
  async checkRateLimit(
    endpoint: string,
    organizationId: string | null,
    ipAddress: string,
    plan?: string,
    config?: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const rateLimitConfig = config || this.defaultConfig;
    const today = this.getToday();

    // Determine the limit based on user type and plan
    const limit = this.getLimit(organizationId, plan, rateLimitConfig);

    // Get current usage
    const usage = await this.getCurrentUsage(
      endpoint,
      organizationId,
      ipAddress,
      today,
    );

    // Check if unlimited
    if (limit === -1) {
      return {
        allowed: true,
        limit: -1,
        current: usage,
        remaining: -1,
        resetAt: this.getTomorrow(),
      };
    }

    // Check if under limit
    const allowed = usage < limit;
    const remaining = Math.max(0, limit - usage);

    if (!allowed) {
      this.logger.warn(
        `Rate limit exceeded for endpoint=${endpoint} ` +
          `organizationId=${organizationId} ipAddress=${ipAddress} ` +
          `usage=${usage} limit=${limit}`,
      );
    }

    return {
      allowed,
      limit,
      current: usage,
      remaining,
      resetAt: this.getTomorrow(),
    };
  }

  /**
   * Track an API call (increment usage counter)
   */
  async trackApiCall(
    endpoint: string,
    organizationId: string | null,
    ipAddress: string,
  ): Promise<void> {
    const today = this.getToday();

    // Find or create usage record
    let usageRecord = await this.apiUsageRepo.findOne({
      where: {
        organizationId: organizationId || undefined,
        ipAddress: organizationId ? undefined : ipAddress, // Only track by IP for guests
        endpoint,
        date: today,
      },
    });

    if (usageRecord) {
      // Increment existing record
      usageRecord.count += 1;
      await this.apiUsageRepo.save(usageRecord);
    } else {
      // Create new record
      usageRecord = this.apiUsageRepo.create({
        organizationId,
        ipAddress: organizationId ? null : ipAddress, // Only store IP for guests
        endpoint,
        date: today,
        count: 1,
      });
      await this.apiUsageRepo.save(usageRecord);
    }

    this.logger.log(
      `Tracked API call: endpoint=${endpoint} ` +
        `organizationId=${organizationId} ipAddress=${ipAddress} ` +
        `count=${usageRecord.count}`,
    );
  }

  /**
   * Enforce rate limit - check and throw exception if exceeded
   */
  async enforceRateLimit(
    endpoint: string,
    organizationId: string | null,
    ipAddress: string,
    plan?: string,
    config?: RateLimitConfig,
  ): Promise<void> {
    const result = await this.checkRateLimit(
      endpoint,
      organizationId,
      ipAddress,
      plan,
      config,
    );

    if (!result.allowed) {
      // Determine what action the user should take
      const actionInfo = this.getActionInfo(organizationId, plan);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Rate limit exceeded. You have used ${result.current} of ${result.limit} daily requests. Limit resets at ${result.resetAt.toISOString()}.`,
          error: 'Too Many Requests',
          limit: result.limit,
          current: result.current,
          remaining: result.remaining,
          resetAt: result.resetAt,
          ...actionInfo,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Get action information for rate limit exceeded error
   */
  private getActionInfo(organizationId: string | null, plan?: string) {
    // Guest user - should login
    if (!organizationId) {
      return {
        action: 'login',
        actionMessage: 'Please sign in to get more searches per day',
      };
    }

    // Authenticated user with no subscription or FREE plan
    if (!plan || plan === 'FREE') {
      return {
        action: 'subscribe',
        actionMessage: 'Upgrade to a paid plan for higher limits',
        currentPlan: plan || 'FREE',
      };
    }

    // Authenticated user with subscription - offer upgrade or buy credits
    const upgradePlans = this.getUpgradePlans(plan);

    return {
      action: 'upgrade_or_buy_credits',
      actionMessage: 'Upgrade your plan or purchase additional credits',
      currentPlan: plan,
      upgradePlans,
      creditOptions: [
        { credits: 10, price: 5.0 },
        { credits: 20, price: 9.0 },
        { credits: 50, price: 20.0 },
        { credits: 100, price: 35.0 },
        { credits: 200, price: 60.0 },
      ],
      autoTopUpAvailable: true,
    };
  }

  /**
   * Get available upgrade plans for current plan
   */
  private getUpgradePlans(
    currentPlan: string,
  ): Array<{ plan: string; limit: number }> {
    const planHierarchy: Record<
      string,
      Array<{ plan: string; limit: number }>
    > = {
      FREE: [
        { plan: 'STARTER', limit: 40 },
        { plan: 'PROFESSIONAL', limit: 100 },
        { plan: 'ENTERPRISE', limit: -1 },
      ],
      STARTER: [
        { plan: 'PROFESSIONAL', limit: 100 },
        { plan: 'ENTERPRISE', limit: -1 },
      ],
      PROFESSIONAL: [{ plan: 'ENTERPRISE', limit: -1 }],
      ENTERPRISE: [],
    };

    return planHierarchy[currentPlan] || [];
  }

  /**
   * Get current usage count for today
   */
  private async getCurrentUsage(
    endpoint: string,
    organizationId: string | null,
    ipAddress: string,
    date: Date,
  ): Promise<number> {
    const where: any = {
      endpoint,
      date,
    };

    if (organizationId) {
      // For authenticated users, look up by organization ID
      where.organizationId = organizationId;
    } else {
      // For guests, look up by IP address
      where.ipAddress = ipAddress;
      where.organizationId = null; // Explicitly filter out authenticated records
    }

    const usageRecord = await this.apiUsageRepo.findOne({ where });
    return usageRecord?.count || 0;
  }

  /**
   * Get the applicable rate limit for a user
   */
  private getLimit(
    organizationId: string | null,
    plan: string | undefined,
    config: RateLimitConfig,
  ): number {
    // Guest users
    if (!organizationId) {
      return config.guest;
    }

    // Authenticated users
    const baseLimit = config.authenticated;

    // Apply plan multiplier if available
    if (
      plan &&
      config.planMultipliers &&
      config.planMultipliers[plan] !== undefined
    ) {
      const multiplier = config.planMultipliers[plan];

      // -1 means unlimited
      if (multiplier === -1) {
        return -1;
      }

      return baseLimit * multiplier;
    }

    // Default to base limit
    return baseLimit;
  }

  /**
   * Get today's date (date only, no time)
   */
  private getToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /**
   * Get tomorrow's date at midnight (when rate limit resets)
   */
  private getTomorrow(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Get usage statistics for an organization or IP
   */
  async getUsageStats(
    organizationId: string | null,
    ipAddress: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Array<{ endpoint: string; date: Date; count: number }>> {
    const where: any = {};

    if (organizationId) {
      where.organizationId = organizationId;
    } else {
      where.ipAddress = ipAddress;
      where.organizationId = null;
    }

    const query = this.apiUsageRepo.createQueryBuilder('usage').where(where);

    if (startDate) {
      query.andWhere('usage.date >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('usage.date <= :endDate', { endDate });
    }

    const records = await query
      .orderBy('usage.date', 'DESC')
      .addOrderBy('usage.endpoint', 'ASC')
      .getMany();

    return records.map((r) => ({
      endpoint: r.endpoint,
      date: r.date,
      count: r.count,
    }));
  }
}
