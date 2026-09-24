import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { ImportService } from './import.service';
import { ContributionRatesService } from './contribution-rates.service';
import { Contribution, ContributionSchema } from './schemas/contribution.schema';
import { ImportBatch, ImportBatchSchema } from './schemas/import-batch.schema';
import { ContributionRate, ContributionRateSchema } from './schemas/contribution-rate.schema';
import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
import { SystemConfigModule } from '../system-config/system-config.module';
import { StaffModule } from '../staff/staff.module';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { MissedContributionReminderJob } from './jobs/missed-contribution-reminder.job';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contribution.name, schema: ContributionSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema },
      { name: Loan.name, schema: LoanSchema },
      { name: ContributionRate.name, schema: ContributionRateSchema },
      { name: Staff.name, schema: StaffSchema },
    ]),
    MulterModule.register({}),
    SystemConfigModule,
    StaffModule,
  ],
  controllers: [ContributionsController],
  providers: [ContributionsService, ImportService, ContributionRatesService, MissedContributionReminderJob],
  exports: [ContributionsService],
})
export class ContributionsModule {}
