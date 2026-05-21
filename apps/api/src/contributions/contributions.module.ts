import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { ImportService } from './import.service';
import { Contribution, ContributionSchema } from './schemas/contribution.schema';
import { ImportBatch, ImportBatchSchema } from './schemas/import-batch.schema';
import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
import { SystemConfigModule } from '../system-config/system-config.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contribution.name, schema: ContributionSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema },
      { name: Loan.name, schema: LoanSchema },
    ]),
    MulterModule.register({}),
    SystemConfigModule,
    StaffModule,
  ],
  controllers: [ContributionsController],
  providers: [ContributionsService, ImportService],
  exports: [ContributionsService],
})
export class ContributionsModule {}
