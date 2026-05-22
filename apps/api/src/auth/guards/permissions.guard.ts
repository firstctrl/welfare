import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PERMISSIONS, AppModule, AccessLevel, UserRole } from '@welfare/shared';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<{ module: AppModule; level: AccessLevel }>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const { user } = context.switchToHttp().getRequest<{ user: { role: UserRole } | null }>();
    if (!user?.role) return false;

    const granted = PERMISSIONS[user.role]?.[meta.module];
    if (meta.level === 'readonly') return granted === 'full' || granted === 'readonly';
    return granted === 'full';
  }
}
