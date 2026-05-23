import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffImportService } from './staff.import.service';
import { Staff, StaffSchema } from './schemas/staff.schema';
import { StaffImportBatch, StaffImportBatchSchema } from './schemas/staff-import-batch.schema';
import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Staff.name, schema: StaffSchema },
      { name: StaffImportBatch.name, schema: StaffImportBatchSchema },
      { name: Loan.name, schema: LoanSchema },
    ]),
    MulterModule.register({}),
    SystemConfigModule,
  ],
  controllers: [StaffController],
  providers: [StaffService, StaffImportService],
  exports: [StaffService],
})
export class StaffModule {}
