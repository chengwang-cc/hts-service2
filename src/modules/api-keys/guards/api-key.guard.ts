import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyService } from '../services/api-key.service';
import { ApiKeyEntity } from '../entities/api-key.entity';

/**
 * API Key Guard
 * Validates API keys from request headers and enforces rate limits
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Extract API key from header
    const apiKeyHeader =
      request.headers['x-api-key'] || request.headers['authorization'];

    if (!apiKeyHeader) {
      throw new UnauthorizedException('API key is required');
    }

    // Handle Bearer token format
    let apiKey = apiKeyHeader;
    if (apiKeyHeader.startsWith('Bearer ')) {
      apiKey = apiKeyHeader.substring(7);
    }

    try {
      // Validate API key
      const validatedKey = await this.apiKeyService.validateApiKey(apiKey);

      // Check required permissions (if specified in route metadata)
      const requiredPermissions = this.reflector.get<string[]>(
        'api-permissions',
        context.getHandler(),
      );

      if (requiredPermissions && requiredPermissions.length > 0) {
        const hasAllPermissions = requiredPermissions.every((permission) =>
          this.apiKeyService.hasPermission(validatedKey, permission),
        );

        if (!hasAllPermissions) {
          throw new ForbiddenException(
            `API key does not have required permissions: ${requiredPermissions.join(', ')}`,
          );
        }
      }

      // Check IP whitelist
      if (validatedKey.ipWhitelist && validatedKey.ipWhitelist.length > 0) {
        const clientIp = this.getClientIp(request);
        const isAllowed = this.checkIpWhitelist(
          clientIp,
          validatedKey.ipWhitelist,
        );

        if (!isAllowed) {
          throw new ForbiddenException(
            `IP address ${clientIp} is not whitelisted`,
          );
        }
      }

      // Check rate limits
      const minuteLimit = await this.apiKeyService.checkRateLimit(
        validatedKey,
        'minute',
      );
      const dayLimit = await this.apiKeyService.checkRateLimit(
        validatedKey,
        'day',
      );

      // Set rate limit headers
      response.setHeader(
        'X-RateLimit-Limit-Minute',
        validatedKey.rateLimitPerMinute,
      );
      response.setHeader('X-RateLimit-Remaining-Minute', minuteLimit.remaining);
      response.setHeader(
        'X-RateLimit-Reset-Minute',
        minuteLimit.resetAt.toISOString(),
      );
      response.setHeader('X-RateLimit-Limit-Day', validatedKey.rateLimitPerDay);
      response.setHeader('X-RateLimit-Remaining-Day', dayLimit.remaining);
      response.setHeader(
        'X-RateLimit-Reset-Day',
        dayLimit.resetAt.toISOString(),
      );

      // Check if rate limit exceeded
      if (!minuteLimit.allowed) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Rate limit exceeded (per minute)',
            retryAfter: minuteLimit.resetAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (!dayLimit.allowed) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Rate limit exceeded (per day)',
            retryAfter: dayLimit.resetAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Attach API key to request for use in controllers
      request.apiKey = validatedKey;
      request.organizationId = validatedKey.organizationId;

      // Track usage (async, don't await)
      // Capture timestamp NOW (before processing) for accurate usage tracking
      const requestTimestamp = Date.now();
      response.on('finish', () => {
        const responseTimeMs = Date.now() - requestTimestamp;
        this.trackRequest(
          request,
          response,
          validatedKey,
          responseTimeMs,
          requestTimestamp,
        );
      });

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException(error.message || 'Invalid API key');
    }
  }

  /**
   * Extract client IP address from request
   */
  private getClientIp(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0].trim() ||
      request.headers['x-real-ip'] ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Check if client IP is in whitelist
   * Supports individual IPs and CIDR notation
   */
  private checkIpWhitelist(clientIp: string, whitelist: string[]): boolean {
    for (const allowed of whitelist) {
      // Simple IP match
      if (allowed === clientIp) {
        return true;
      }

      // CIDR notation (simplified check - production should use a proper CIDR library)
      if (allowed.includes('/')) {
        const [network, bits] = allowed.split('/');
        const mask = -1 << (32 - parseInt(bits, 10));
        const networkLong = this.ipToLong(network);
        const clientLong = this.ipToLong(clientIp);

        if ((networkLong & mask) === (clientLong & mask)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Convert IP address to long integer for CIDR comparison
   */
  private ipToLong(ip: string): number {
    const parts = ip.split('.');
    return (
      (parseInt(parts[0], 10) << 24) +
      (parseInt(parts[1], 10) << 16) +
      (parseInt(parts[2], 10) << 8) +
      parseInt(parts[3], 10)
    );
  }

  /**
   * Track API request usage
   */
  private async trackRequest(
    request: any,
    response: any,
    apiKey: ApiKeyEntity,
    responseTimeMs: number,
    requestTimestamp: number,
  ): Promise<void> {
    try {
      await this.apiKeyService.trackUsage({
        apiKeyId: apiKey.id,
        organizationId: apiKey.organizationId,
        endpoint: request.path,
        method: request.method,
        statusCode: response.statusCode,
        responseTimeMs,
        clientIp: this.getClientIp(request),
        userAgent: request.headers['user-agent'],
        errorMessage:
          response.statusCode >= 400 ? response.statusMessage : undefined,
        timestamp: new Date(requestTimestamp),
      });
    } catch (error) {
      // Log error but don't throw (tracking failure shouldn't block request)
      console.error('Failed to track API usage:', error);
    }
  }
}
