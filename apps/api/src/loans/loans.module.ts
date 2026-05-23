import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { LoansController } from './loans.controller';
import { StaffLoansController } from './staff-loans.controller';
import { LoansService } from './loans.service';
import { LoansImportService } from './loans.import.service';
import { LoansRecordsImportService } from './loans.records.import.service';
import { OverdueDetectionJob } from './jobs/overdue-detection.job';
import { DefaultRecoveryJob } from './jobs/default-recovery.job';
import { Loan, LoanSchema } from './schemas/loan.schema';
import { LoanRepayment, LoanRepaymentSchema } from './schemas/loan-repayment.schema';
import { LoanImportBatch, LoanImportBatchSchema } from './schemas/loan-import-batch.schema';
import { LoanRecordsImportBatch, LoanRecordsImportBatchSchema } from './schemas/loan-records-import-batch.schema';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';
import { StaffModule } from '../staff/staff.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { ContributionsModule } from '../contributions/contributions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Loan.name, schema: LoanSchema },
      { name: LoanRepayment.name, schema: LoanRepaymentSchema },
      { name: LoanImportBatch.name, schema: LoanImportBatchSchema },
      { name: LoanRecordsImportBatch.name, schema: LoanRecordsImportBatchSchema },
      { name: Staff.name, schema: StaffSchema },
    ]),
    MulterModule.register({}),
    StaffModule,
    SystemConfigModule,
    ContributionsModule,
  ],
  controllers: [LoansController, StaffLoansController],
  providers: [LoansService, LoansImportService, LoansRecordsImportService, OverdueDetectionJob, DefaultRecoveryJob, LoanScheduleSenderService],
  exports: [LoansService],
})
export class LoansModule {}
