import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLogType, EmailTriggerSource, IEmailRecipient, LoanRepaymentStatus, LoanStatus } from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderLoanOverdueReminder } from '../../email/templates/loan-overdue-reminder.template';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class LoanOverdueReminderJob {
  private readonly logger = new Logger(LoanOverdueReminderJob.name);

  constructor(
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 1 * * *')
  async sendOverdueReminders(): Promise<void> {
    this.logger.log('Starting loan overdue reminder job');

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const overdue = await this.repaymentModel
      .find({
        status: LoanRepaymentStatus.Overdue,
        overdueReminderSentAt: { $exists: false },
      })
      .exec();

    this.logger.log(`Found ${overdue.length} newly-overdue instalments`);

    for (const inst of overdue) {
      try {
        const loan = await this.loanModel.findById(inst.loanId).exec();
        if (!loan || loan.status !== LoanStatus.Active) continue;

        const staff = await this.staffModel.findById(inst.staffId).exec();
        if (!staff?.email) continue;

        const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
        const html = renderLoanOverdueReminder({
          staffName: staff.fullName,
          loanRef: inst.loanId.slice(-6).toUpperCase(),
          outstandingAmount: outstanding,
          organisationName,
        });

        const recipient: IEmailRecipient = {
          staffId: staff._id.toString(),
          staffName: staff.fullName,
          email: staff.email,
        };
        await this.emailService.send(
          recipient,
          EmailLogType.LoanOverdueReminder,
          `Loan Instalment Overdue - Ref ${inst.loanId.slice(-6).toUpperCase()}`,
          html,
          EmailTriggerSource.Cron,
        );

        await this.repaymentModel.updateOne({ _id: inst._id }, { $set: { overdueReminderSentAt: new Date() } }).exec();
      } catch (err) {
        this.logger.error(`Overdue reminder failed for instalment ${inst._id.toString()}`, err);
      }
    }

    this.logger.log('Loan overdue reminder job complete');
  }
}
