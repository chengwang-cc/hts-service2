import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Accepts a request if it carries either:
 *   - a valid `X-API-Key` / `X-Partner-Key` (validated by AttributionMiddleware
 *     against the api_keys table), OR
 *   - a valid `Authorization: Bearer <jwt>` (decoded by AttributionMiddleware
 *     with HS256 verification against JWT_SECRET).
 *
 * Both surfaces are resolved BEFORE guards run — AttributionMiddleware sets
 * `req.attribution.attributionSource` to one of:
 *     'api_key' | 'partner_key' | 'jwt' | 'origin' | 'unknown'
 *
 * This guard accepts only the first three. `origin` and `unknown` are billing
 * attribution fallbacks, not authentication signals — they exist so anonymous
 * traffic still lands on a partner's dashboard, not so it grants access.
 *
 * Why this guard exists:
 *   - Routes used by BOTH partners (X-API-Key) AND business portal users
 *     (browser JWT) can't use ApiKeyGuard alone (rejects JWT) or JwtAuthGuard
 *     alone (rejects API keys). This guard composes the two.
 *   - The route must be marked `@SkipJwtAuth()` so the global JwtAuthGuard
 *     doesn't intercept and 401 the API-key path before this guard runs.
 *
 * After accept, `req.user` is populated with `{ id, organizationId }` so
 * existing `@CurrentUser()` consumers keep working. For partner_key /
 * api_key paths there is no end-user id, so `id` is null.
 */
@Injectable()
export class ApiKeyOrJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & {
      attribution?: { attributionSource?: string; partnerId?: string; organizationId?: string };
      user?: { id: string | null; organizationId: string };
    }>();
    const src = req.attribution?.attributionSource;
    if (src !== 'api_key' && src !== 'partner_key' && src !== 'jwt') {
      throw new UnauthorizedException(
        'Authentication required: provide X-API-Key, X-Partner-Key, or Authorization: Bearer <token>',
      );
    }
    const orgId = req.attribution?.organizationId || req.attribution?.partnerId;
    if (!orgId) {
      throw new UnauthorizedException('Authentication resolved without an organization');
    }
    if (!req.user) {
      req.user = { id: null, organizationId: orgId };
    }
    return true;
  }
}
