import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Marker decorator: the route is publicly accessible (no auth required),
 * BUT if a Bearer token is present and valid, the JWT strategy still
 * runs and `req.user` gets populated. Without this, `@Public()` causes
 * the JwtAuthGuard to short-circuit before passport runs, so a signed-in
 * user's identity is silently dropped — the request is treated as a guest.
 *
 * Used for endpoints with mixed guest+user UX (e.g. batch CSV upload):
 * guests get a guest token; signed-in users get their jobs scoped to
 * their account.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
