import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { SystemConfigService } from './system-config.service';
import { TestEmailDto } from './dto/test-email.dto';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';

@Controller('config')
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get('public')
  getPublic() {
    return this.systemConfigService.getPublic();
  }

  @Get()
  @RequirePermission(AppModule.Settings, 'readonly')
  getAll() {
    return this.systemConfigService.getAll();
  }

  @Patch()
  @RequirePermission(AppModule.Settings, 'full')
  bulkUpdate(
    @Body() body: Record<string, string>,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ) {
    const ip = req.ip;
    return this.systemConfigService.bulkUpdate(
      body,
      String(user._id),
      user.displayName,
      ip,
    );
  }

  @Post('test-email')
  @RequirePermission(AppModule.Settings, 'full')
  testEmail(@Body() body: TestEmailDto) {
    return this.systemConfigService.testEmail(body.provider, body.to);
  }
}
