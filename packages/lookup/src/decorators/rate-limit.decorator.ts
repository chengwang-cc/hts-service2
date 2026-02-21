import { SetMetadata } from '@nestjs/common';
import { RateLimitConfig } from '../services/rate-limit.service';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  endpoint: string; // Endpoint identifier for tracking
  config?: RateLimitConfig; // Optional custom config
}

/**
 * Rate Limit Decorator
 * Apply to controller methods to enforce daily rate limits
 *
 * @example
 * ```typescript
 * @RateLimit({ endpoint: 'classify-url' })
 * @Post('classify-url')
 * async classifyUrl(@Body() dto: ClassifyUrlRequestDto) {
 *   // ...
 * }
 * ```
 *
 * @example With custom config
 * ```typescript
 * @RateLimit({
 *   endpoint: 'special-endpoint',
 *   config: { guest: 5, authenticated: 10 }
 * })
 * @Get('special')
 * async specialEndpoint() {
 *   // ...
 * }
 * ```
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
