import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Guard for partner-WEBSITE (browser) endpoints — the public lookup/classify
 * surface called from partner frontends (proto.com, usahts.com, chitchats.com).
 *
 * Accepts a request when AttributionMiddleware resolved it to one of:
 *   - 'api_key' / 'partner_key'  (server-to-server or keyed clients), OR
 *   - 'jwt'                      (signed-in portal users), OR
 *   - 'origin'  AND the matched partner_origins row has purpose='web'
 *               (a recognised partner website) — ONLY when the
 *               BROWSER_ORIGIN_AUTH flag is enabled.
 *
 * Rejects 'unknown' (no matching origin) and non-'web' origins (server/mobile)
 * with 401. The intent: a partner website authenticates by *being served from
 * a registered origin* — no secret key is shipped to the browser — while the
 * abuse vector that closed @Public on async (keyless, un-attributable job
 * creation) stays closed because un-attributable traffic is rejected and the
 * resolved partner is still rate-limited (PartnerRateLimitMiddleware) and
 * quota-metered (PartnerQuotaGuard, where applied).
 *
 * Origin is spoofable by non-browser clients, so this is NOT a cryptographic
 * boundary — it is a partner-attribution + rate-limit/quota boundary, which is
 * the appropriate model for a public classification surface. Real browsers
 * cannot forge Origin (CORS), so cross-site reuse from another site is blocked.
 *
 * The route must be marked `@SkipJwtAuth()` so the global JwtAuthGuard doesn't
 * 401 the non-JWT paths before this guard runs.
 *
 * Flag: BROWSER_ORIGIN_AUTH (default 'false'). When off, this guard behaves
 * exactly like ApiKeyOrJwtAuthGuard (origin rejected) — safe to deploy dark.
 */
@Injectable()
export class BrowserOriginOrAuthGuard implements CanActivate {
  private readonly logger = new Logger(BrowserOriginOrAuthGuard.name);
  private readonly originAuthEnabled =
    (process.env.BROWSER_ORIGIN_AUTH ?? 'false').toLowerCase() === 'true';

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      Request & {
        attribution?: {
          attributionSource?: string;
          partnerId?: string;
          organizationId?: string;
          originPurpose?: string | null;
        };
        user?: { id: string | null; organizationId: string };
      }
    >();

    const src = req.attribution?.attributionSource;
    const keyedOrJwt = src === 'api_key' || src === 'partner_key' || src === 'jwt';
    const webOrigin =
      this.originAuthEnabled &&
      src === 'origin' &&
      req.attribution?.originPurpose === 'web';

    if (!keyedOrJwt && !webOrigin) {
      throw new UnauthorizedException(
        'Authentication required: call from a registered partner website (Origin) or provide X-API-Key, X-Partner-Key, or Authorization: Bearer <token>',
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
