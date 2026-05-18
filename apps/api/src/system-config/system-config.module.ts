import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigSetting, ConfigSettingSchema } from './system-config.schema';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConfigSetting.name, schema: ConfigSettingSchema },
    ]),
  ],
  providers: [SystemConfigService],
  controllers: [SystemConfigController],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
