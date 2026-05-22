import { SetMetadata } from '@nestjs/common';
import { AppModule, AccessLevel } from '@welfare/shared';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (module: AppModule, level: AccessLevel) =>
  SetMetadata(PERMISSION_KEY, { module, level });
