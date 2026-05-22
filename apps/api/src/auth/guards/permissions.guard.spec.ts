import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { UserRole, AppModule } from '@welfare/shared';

describe('PermissionsGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new PermissionsGuard(reflector);
  });

  it('passes when no metadata set', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareOfficer } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows WelfareOfficer full access to Contributions', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Contributions, level: 'full' });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareOfficer } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks WelfareOfficer from AuditLog readonly', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.AuditLog, level: 'readonly' });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareOfficer } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('allows WelfareDirector readonly on Contributions but blocks full', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Contributions, level: 'readonly' });
    const ctxRead = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareDirector } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctxRead)).toBe(true);

    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Contributions, level: 'full' });
    const ctxFull = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareDirector } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctxFull)).toBe(false);
  });

  it('blocks request when user is missing', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Staff, level: 'readonly' });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: null }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
