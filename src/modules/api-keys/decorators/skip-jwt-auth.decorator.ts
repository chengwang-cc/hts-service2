import { SetMetadata } from '@nestjs/common';

export const SKIP_JWT_AUTH_KEY = 'skipJwtAuth';

/**
 * Skip JWT Auth Decorator
 * Use on controllers or routes that use API Key authentication instead of JWT
 *
 * This decorator tells the global JwtAuthGuard to skip JWT validation for
 * routes that use alternative authentication methods (e.g., API keys).
 *
 * @example
 * ```typescript
 * @SkipJwtAuth()
 * @UseGuards(ApiKeyGuard)
 * @Controller('api/v1/extension')
 * export class ExtensionController {}
 * ```
 *
 * @see JwtAuthGuard - Global guard that checks for this metadata
 * @see ApiKeyGuard - Alternative authentication for extension/public API
 */
export const SkipJwtAuth = () => SetMetadata(SKIP_JWT_AUTH_KEY, true);
