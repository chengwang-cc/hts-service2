import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { FinanceAdminGuard } from './finance-admin.guard';

const makeCtx = (roles: Array<{ name: string }>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user: { roles } }),
    }),
  }) as any;

describe('FinanceAdminGuard', () => {
  const guard = new FinanceAdminGuard();

  it('allows Platform Administrator', () => {
    expect(guard.canActivate(makeCtx([{ name: 'Platform Administrator' }]))).toBe(true);
  });

  it('allows Finance Administrator', () => {
    expect(guard.canActivate(makeCtx([{ name: 'Finance Administrator' }]))).toBe(true);
  });

  it('allows a user with BOTH roles', () => {
    expect(
      guard.canActivate(
        makeCtx([{ name: 'Platform Administrator' }, { name: 'Finance Administrator' }]),
      ),
    ).toBe(true);
  });

  it('rejects a user without either role', () => {
    expect(() =>
      guard.canActivate(makeCtx([{ name: 'Business User' }])),
    ).toThrow(ForbiddenException);
  });

  it('rejects a user with no roles array', () => {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: {} }) }) } as any;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects unauthenticated requests (no user)', () => {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({}) }) } as any;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
