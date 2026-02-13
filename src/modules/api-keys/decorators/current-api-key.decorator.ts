import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiKeyEntity } from '../entities/api-key.entity';

/**
 * Current API Key Decorator
 * Extract the validated API key from the request
 *
 * @example
 * async getProfile(@CurrentApiKey() apiKey: ApiKeyEntity) {
 *   return { organizationId: apiKey.organizationId };
 * }
 */
export const CurrentApiKey = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ApiKeyEntity => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKey;
  },
);
