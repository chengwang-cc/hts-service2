/**
 * Admin Guard
 * Verifies that the authenticated user has admin role
 */

import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Check if user has admin role or admin permissions
    const hasAdminRole = user.roles?.some(
      (role: any) =>
        role.name === 'admin' ||
        role.name === 'superadmin' ||
        role.name === 'Platform Administrator' ||
        role.permissions?.includes('admin:*')
    );

    if (!hasAdminRole) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
