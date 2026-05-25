import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgPermissionsGuard } from '../../src/modules/auth/guards/org-permissions.guard';
import { ORG_PERMISSIONS_KEY } from '../../src/modules/auth/decorators/org-permissions.decorator';

describe('OrgPermissionsGuard (R0-C-02)', () => {
  function makeCtx(
    permissions: string[] | null,
    required: string[] | undefined,
  ): { ctx: ExecutionContext; reflector: Reflector } {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === ORG_PERMISSIONS_KEY ? required : undefined,
      ) as any;
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user:
            permissions === null
              ? undefined
              : { roles: [{ permissions }] },
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
    return { ctx, reflector };
  }

  it('lets the request through when no @OrgPermissions decorator is present', () => {
    const { ctx, reflector } = makeCtx([], undefined);
    const guard = new OrgPermissionsGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('grants admin:* wildcard regardless of the required key', () => {
    const { ctx, reflector } = makeCtx(['admin:*'], [
      'broker:rules:write',
      'broker:audit:view',
    ]);
    const guard = new OrgPermissionsGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows trailing-wildcard permissions (e.g. broker:* matches broker:rules:write)', () => {
    const { ctx, reflector } = makeCtx(['broker:*'], [
      'broker:rules:write',
    ]);
    const guard = new OrgPermissionsGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('refuses when none of the required permissions are present', () => {
    const { ctx, reflector } = makeCtx(['broker:packets:view'], [
      'broker:rules:write',
    ]);
    const guard = new OrgPermissionsGuard(reflector);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('refuses unauthenticated callers', () => {
    const { ctx, reflector } = makeCtx(null, ['broker:rules:view']);
    const guard = new OrgPermissionsGuard(reflector);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
