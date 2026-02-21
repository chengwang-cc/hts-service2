import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_PERMISSIONS_KEY } from '../decorators/admin-permissions.decorator';

@Injectable()
export class AdminPermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      ADMIN_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const permissions = (user.roles || [])
      .flatMap((role: any) => role.permissions || [])
      .filter(Boolean);

    if (this.hasAnyPermission(permissions, requiredPermissions)) {
      return true;
    }

    throw new ForbiddenException('Insufficient permissions');
  }

  private hasAnyPermission(
    userPermissions: string[],
    required: string[],
  ): boolean {
    for (const permission of userPermissions) {
      if (permission === 'admin:*') return true;
    }

    return required.some((needed) =>
      this.hasPermission(userPermissions, needed),
    );
  }

  private hasPermission(userPermissions: string[], needed: string): boolean {
    if (userPermissions.includes(needed)) return true;

    for (const permission of userPermissions) {
      if (permission.endsWith('*')) {
        const prefix = permission.slice(0, -1);
        if (needed.startsWith(prefix)) return true;
      }
    }

    return false;
  }
}
