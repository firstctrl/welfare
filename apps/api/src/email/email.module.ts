import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EmailLog, EmailLogSchema } from './email-log.schema';
import { AnnualStatementJob } from './jobs/annual-statement.job';
import { EmailBatchProcessor } from './jobs/email-batch.processor';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { Contribution, ContributionSchema } from '../contributions/schemas/contribution.schema';
import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
import { LoanRepayment, LoanRepaymentSchema } from '../loans/schemas/loan-repayment.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailLog.name, schema: EmailLogSchema },
      { name: Staff.name, schema: StaffSchema },
      { name: Contribution.name, schema: ContributionSchema },
      { name: Loan.name, schema: LoanSchema },
      { name: LoanRepayment.name, schema: LoanRepaymentSchema },
    ]),
    BullModule.registerQueue({ name: 'email-batch' }),
  ],
  controllers: [EmailController],
  providers: [EmailService, AnnualStatementJob, EmailBatchProcessor],
  exports: [EmailService, AnnualStatementJob],
})
export class EmailModule {}
