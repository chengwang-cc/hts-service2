import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { RateLimitService } from '../services/rate-limit.service';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

/**
 * Rate Limit Guard
 * Enforces daily API usage limits for endpoints decorated with @RateLimit()
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get rate limit options from decorator
    const rateLimitOptions = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    // If no rate limit decorator, allow the request
    if (!rateLimitOptions) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Extract user/organization info (from JWT auth)
    const user = (request as any).user;
    const organizationId = user?.organizationId || null;
    const plan = user?.plan || user?.subscription?.plan;

    // Get IP address
    const ipAddress = this.getIpAddress(request);

    this.logger.log(
      `Rate limit check: endpoint=${rateLimitOptions.endpoint} ` +
        `organizationId=${organizationId} ipAddress=${ipAddress} plan=${plan}`,
    );

    // Enforce rate limit (throws exception if exceeded)
    await this.rateLimitService.enforceRateLimit(
      rateLimitOptions.endpoint,
      organizationId,
      ipAddress,
      plan,
      rateLimitOptions.config,
    );

    // Track this API call
    await this.rateLimitService.trackApiCall(
      rateLimitOptions.endpoint,
      organizationId,
      ipAddress,
    );

    return true;
  }

  /**
   * Extract IP address from request
   * Handles X-Forwarded-For header for proxied requests
   */
  private getIpAddress(request: Request): string {
    // Check X-Forwarded-For header first (for proxied requests)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0];
      return ips.trim();
    }

    // Fall back to direct connection IP
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
