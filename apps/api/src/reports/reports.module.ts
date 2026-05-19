import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Contribution, ContributionSchema } from '../contributions/schemas/contribution.schema';
import { ImportBatch, ImportBatchSchema } from '../contributions/schemas/import-batch.schema';
import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
import { LoanRepayment, LoanRepaymentSchema } from '../loans/schemas/loan-repayment.schema';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contribution.name, schema: ContributionSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema },
      { name: Loan.name, schema: LoanSchema },
      { name: LoanRepayment.name, schema: LoanRepaymentSchema },
      { name: Staff.name, schema: StaffSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
