import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { Staff, StaffSchema } from './schemas/staff.schema';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Staff.name, schema: StaffSchema }]),
    MulterModule.register({}),
    SystemConfigModule,
  ],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
