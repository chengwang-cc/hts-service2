import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
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
    const skipJwtAuth = this.reflector.getAllAndOverride<boolean>(SKIP_JWT_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipJwtAuth) {
      return true;
    }

    return super.canActivate(context);
  }
}
