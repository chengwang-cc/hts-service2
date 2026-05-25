import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ORG_PERMISSIONS_KEY } from '../decorators/org-permissions.decorator';

interface RoleLike {
  permissions?: string[] | null;
}

@Injectable()
export class OrgPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      ORG_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
    const roles = (user.roles ?? []) as RoleLike[];
    const permissions = roles
      .flatMap((r) => r?.permissions ?? [])
      .filter(Boolean) as string[];

    if (permissions.includes('admin:*')) return true;

    if (required.some((needed) => hasPermission(permissions, needed))) {
      return true;
    }
    throw new ForbiddenException(
      `Missing permission: requires one of [${required.join(', ')}]`,
    );
  }
}

function hasPermission(userPermissions: string[], needed: string): boolean {
  if (userPermissions.includes(needed)) return true;
  for (const perm of userPermissions) {
    if (perm.endsWith('*')) {
      const prefix = perm.slice(0, -1);
      if (needed.startsWith(prefix)) return true;
    }
  }
  return false;
}
