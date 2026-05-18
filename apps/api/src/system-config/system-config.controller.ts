import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { SystemConfigService } from './system-config.service';
import { TestEmailDto } from './dto/test-email.dto';

@Controller('config')
@UseGuards(JwtAuthGuard)
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  getAll() {
    return this.systemConfigService.getAll();
  }

  @Patch()
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
  testEmail(@Body() body: TestEmailDto) {
    return this.systemConfigService.testEmail(body.provider, body.to);
  }
}
