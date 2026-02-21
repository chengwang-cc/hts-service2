import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementService } from '../services/entitlement.service';

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<string>(
      'requiredFeature',
      context.getHandler(),
    );

    if (!requiredFeature) {
      return true; // No feature requirement, allow access
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.organization) {
      throw new ForbiddenException('User or organization not found');
    }

    const plan = user.organization.plan || 'FREE';
    const currentUsage = user.organization.currentUsage || {};

    const result = await this.entitlementService.checkEntitlement(
      plan,
      currentUsage,
      requiredFeature,
      'check',
    );

    if (!result.allowed) {
      throw new ForbiddenException(
        result.message ||
          `Feature "${requiredFeature}" not available in your plan. Please upgrade.`,
      );
    }

    // Add usage info to response headers
    const response = context.switchToHttp().getResponse();
    if (result.quota !== undefined && result.quota !== -1) {
      response.setHeader('X-Usage-Limit', result.quota.toString());
      response.setHeader(
        'X-Usage-Remaining',
        result.remaining?.toString() || '0',
      );
      response.setHeader('X-Usage-Current', result.usage?.toString() || '0');
    }

    return true;
  }
}
