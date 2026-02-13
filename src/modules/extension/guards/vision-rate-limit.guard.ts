import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { VisionAnalysisEntity } from '../entities/vision-analysis.entity';
import { ScrapingMetadataEntity } from '../entities/scraping-metadata.entity';

/**
 * Vision Rate Limit Guard
 * Enforces rate limits for vision and scraping endpoints
 *
 * Limits:
 * - Vision: 100 requests per organization per hour
 * - Scraping: 200 requests per organization per hour
 */
@Injectable()
export class VisionRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(VisionRateLimitGuard.name);

  // Rate limits
  private readonly VISION_LIMIT_PER_HOUR = 100;
  private readonly SCRAPING_LIMIT_PER_HOUR = 200;

  constructor(
    @InjectRepository(VisionAnalysisEntity)
    private readonly visionAnalysisRepository: Repository<VisionAnalysisEntity>,
    @InjectRepository(ScrapingMetadataEntity)
    private readonly scrapingMetadataRepository: Repository<ScrapingMetadataEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const apiKey = request.apiKey; // Set by ApiKeyGuard

    if (!apiKey) {
      throw new HttpException(
        'API key required for rate limiting',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const organizationId = apiKey.organizationId;
    const endpoint = request.route.path;

    // Determine which limit to apply
    const isVisionEndpoint = endpoint.includes('detect-from-image');
    const isScrapingEndpoint = endpoint.includes('detect-from-url');

    if (isVisionEndpoint) {
      return this.checkVisionRateLimit(organizationId, response);
    } else if (isScrapingEndpoint) {
      return this.checkScrapingRateLimit(organizationId, response);
    }

    // Default: allow if not a rate-limited endpoint
    return true;
  }

  /**
   * Check vision endpoint rate limit
   */
  private async checkVisionRateLimit(
    organizationId: string,
    response: any,
  ): Promise<boolean> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    try {
      const count = await this.visionAnalysisRepository.count({
        where: {
          organizationId,
          createdAt: MoreThan(oneHourAgo),
        },
      });

      // Set rate limit headers
      response.setHeader('X-RateLimit-Limit', this.VISION_LIMIT_PER_HOUR);
      response.setHeader('X-RateLimit-Remaining', Math.max(0, this.VISION_LIMIT_PER_HOUR - count));
      response.setHeader('X-RateLimit-Reset', new Date(Date.now() + 60 * 60 * 1000).toISOString());

      if (count >= this.VISION_LIMIT_PER_HOUR) {
        this.logger.warn(
          `Vision rate limit exceeded for organization ${organizationId}: ${count}/${this.VISION_LIMIT_PER_HOUR}`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Vision API rate limit exceeded. Maximum ${this.VISION_LIMIT_PER_HOUR} requests per hour.`,
            retryAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Failed to check vision rate limit', error.stack);
      // Allow request on error (fail open)
      return true;
    }
  }

  /**
   * Check scraping endpoint rate limit
   */
  private async checkScrapingRateLimit(
    organizationId: string,
    response: any,
  ): Promise<boolean> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    try {
      const count = await this.scrapingMetadataRepository.count({
        where: {
          organizationId,
          createdAt: MoreThan(oneHourAgo),
        },
      });

      // Set rate limit headers
      response.setHeader('X-RateLimit-Limit', this.SCRAPING_LIMIT_PER_HOUR);
      response.setHeader('X-RateLimit-Remaining', Math.max(0, this.SCRAPING_LIMIT_PER_HOUR - count));
      response.setHeader('X-RateLimit-Reset', new Date(Date.now() + 60 * 60 * 1000).toISOString());

      if (count >= this.SCRAPING_LIMIT_PER_HOUR) {
        this.logger.warn(
          `Scraping rate limit exceeded for organization ${organizationId}: ${count}/${this.SCRAPING_LIMIT_PER_HOUR}`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Scraping API rate limit exceeded. Maximum ${this.SCRAPING_LIMIT_PER_HOUR} requests per hour.`,
            retryAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Failed to check scraping rate limit', error.stack);
      // Allow request on error (fail open)
      return true;
    }
  }
}
