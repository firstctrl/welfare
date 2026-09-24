import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { UserRole } from '@welfare/shared';

describe('RolesGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  const ctxFor = (role: string | undefined) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  it('passes when no @Roles metadata is set on the route', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(ctxFor(UserRole.WelfareOfficer))).toBe(true);
  });

  it('allows a role listed in @Roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.WelfareManager, UserRole.Admin]);
    expect(guard.canActivate(ctxFor(UserRole.WelfareManager))).toBe(true);
    expect(guard.canActivate(ctxFor(UserRole.Admin))).toBe(true);
  });

  it('blocks a role not listed in @Roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.WelfareManager, UserRole.Admin]);
    expect(guard.canActivate(ctxFor(UserRole.WelfareOfficer))).toBe(false);
  });

  it('blocks the request when the user is missing', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.WelfareManager, UserRole.Admin]);
    expect(guard.canActivate(ctxFor(undefined))).toBe(false);
  });
});
