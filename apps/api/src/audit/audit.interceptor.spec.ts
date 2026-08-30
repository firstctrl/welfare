import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { AuditAction, AuditEntity } from '@welfare/shared';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

const mockAuditService = { log: jest.fn() };
const mockReflector = { get: jest.fn() };

function makeContext(opts: {
  type?: string;
  params?: Record<string, string>;
  user?: { _id: { toString(): string }; displayName: string };
  ip?: string;
}): ExecutionContext {
  const request = {
    params: opts.params ?? {},
    user: opts.user,
    ip: opts.ip,
    socket: {},
  };
  return {
    getType: () => opts.type ?? 'http',
    getHandler: () => jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeCallHandler(response: unknown): CallHandler {
  return { handle: () => of(response) };
}

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        { provide: Reflector, useValue: mockReflector },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    interceptor = module.get<AuditInterceptor>(AuditInterceptor);
    jest.clearAllMocks();
  });

  it('passes through untouched for non-http contexts', (done) => {
    const context = makeContext({ type: 'rpc' });
    interceptor.intercept(context, makeCallHandler({})).subscribe(() => {
      expect(mockReflector.get).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('skips logging when the handler has no @Audit metadata', (done) => {
    mockReflector.get.mockReturnValue(undefined);
    const context = makeContext({ user: { _id: { toString: () => 'u1' }, displayName: 'Jane' } });
    interceptor.intercept(context, makeCallHandler({})).subscribe(() => {
      expect(mockAuditService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('skips logging when there is no authenticated user', (done) => {
    mockReflector.get.mockReturnValue({ action: AuditAction.Create, entity: AuditEntity.Staff });
    const context = makeContext({ params: { id: 'staff-1' } });
    interceptor.intercept(context, makeCallHandler({})).subscribe(() => {
      expect(mockAuditService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('skips logging when no entityId can be resolved from params or response', (done) => {
    mockReflector.get.mockReturnValue({ action: AuditAction.Create, entity: AuditEntity.Staff });
    const context = makeContext({ user: { _id: { toString: () => 'u1' }, displayName: 'Jane' } });
    interceptor.intercept(context, makeCallHandler({})).subscribe(() => {
      expect(mockAuditService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('logs using the route param id when present', (done) => {
    mockReflector.get.mockReturnValue({ action: AuditAction.Update, entity: AuditEntity.Staff });
    const context = makeContext({
      params: { id: 'staff-1' },
      user: { _id: { toString: () => 'u1' }, displayName: 'Jane' },
      ip: '10.0.0.1',
    });
    interceptor.intercept(context, makeCallHandler({})).subscribe(() => {
      expect(mockAuditService.log).toHaveBeenCalledWith(
        'u1', 'Jane', AuditAction.Update, AuditEntity.Staff, 'staff-1',
        undefined, undefined, '10.0.0.1',
      );
      done();
    });
  });

  it('falls back to the response body _id when no route param id exists', (done) => {
    mockReflector.get.mockReturnValue({ action: AuditAction.Create, entity: AuditEntity.Staff });
    const context = makeContext({ user: { _id: { toString: () => 'u1' }, displayName: 'Jane' } });
    interceptor.intercept(context, makeCallHandler({ _id: { toString: () => 'staff-9' } })).subscribe(() => {
      expect(mockAuditService.log).toHaveBeenCalledWith(
        'u1', 'Jane', AuditAction.Create, AuditEntity.Staff, 'staff-9',
        undefined, undefined, undefined,
      );
      done();
    });
  });
});
