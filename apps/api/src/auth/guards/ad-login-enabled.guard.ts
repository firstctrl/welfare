import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigKey } from '@welfare/shared';
import { SystemConfigService } from '../../system-config/system-config.service';

@Injectable()
export class AdLoginEnabledGuard implements CanActivate {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const all = await this.systemConfigService.getAll();
    const enabled = (all[ConfigKey.AdLoginEnabled]?.value ?? 'true') === 'true';
    if (!enabled) {
      throw new ForbiddenException('Active Directory login is disabled');
    }
    return true;
  }
}
