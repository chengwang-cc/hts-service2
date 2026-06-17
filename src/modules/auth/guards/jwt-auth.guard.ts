import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { SKIP_JWT_AUTH_KEY } from '../../api-keys/decorators/skip-jwt-auth.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Skip JWT auth for @Public() decorated routes (no auth at all)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Skip JWT auth for @SkipJwtAuth() decorated routes (uses API key auth instead)
    const skipJwtAuth = this.reflector.getAllAndOverride<boolean>(
      SKIP_JWT_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipJwtAuth) {
      return true;
    }

    // For @OptionalAuth() routes: run the JWT strategy so req.user gets
    // populated when a valid token is present, but never throw on missing
    // or invalid tokens. handleRequest() below converts authentication
    // failures to a `null` user instead of a 401.
    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isOptional) {
      const result = super.canActivate(context);
      if (result instanceof Promise) {
        return result.catch(() => true);
      }
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * Passport calls this with the authentication result. For
   * @OptionalAuth() routes a failed authentication is NOT an error —
   * we just return a null user and let the handler proceed (it'll fall
   * back to guest behaviour, etc.).
   */
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
  ): TUser {
    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isOptional) {
      return (user ?? null) as TUser;
    }
    return super.handleRequest(err, user, info, context);
  }
}
