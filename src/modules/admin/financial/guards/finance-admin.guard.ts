import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { UserEntity } from '../../../auth/entities/user.entity';

/**
 * Gates the financial admin surface. Accepts either:
 *   - Platform Administrator (existing role — covers everything)
 *   - Finance Administrator (new role provisioned by F3.1 migration —
 *     scoped narrowly to financial endpoints; cannot edit org plans,
 *     users, or non-financial state).
 *
 * Runs AFTER JwtAuthGuard so `req.user` is populated with the
 * eager-loaded roles relation (per UserEntity.findOne in the JWT
 * strategy).
 *
 * Throws 403 on missing role; deliberately surfaces "Finance
 * Administrator role required" so an operator who's signed in but
 * doesn't have the role sees a clear message rather than a generic
 * "unauthorized".
 */
@Injectable()
export class FinanceAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as UserEntity | undefined;
    const roleNames = (user?.roles ?? []).map((r) => r.name);
    const allowed =
      roleNames.includes('Platform Administrator') ||
      roleNames.includes('Finance Administrator');
    if (!allowed) {
      throw new ForbiddenException(
        'Platform Administrator or Finance Administrator role required',
      );
    }
    return true;
  }
}
