import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EmailLogType,
  EmailTriggerSource,
  IEmailRecipient,
  LoanRepaymentStatus,
  LoanStatus,
} from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderLoanPaymentReminder } from '../../email/templates/loan-payment-reminder.template';

@Injectable()
export class PaymentReminderJob {
  private readonly logger = new Logger(PaymentReminderJob.name);

  constructor(
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly emailService: EmailService,
    private readonly configService: SystemConfigService,
  ) {}

  @Cron('10 0 * * *')
  async sendPaymentReminders(): Promise<void> {
    this.logger.log('Starting payment reminder job');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 7);
    const targetEnd = new Date(targetDate);
    targetEnd.setHours(23, 59, 59, 999);

    const dueRepayments = await this.repaymentModel
      .find({
        dueDate: { $gte: targetDate, $lte: targetEnd },
        status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] },
      })
      .exec();

    this.logger.log(`Found ${dueRepayments.length} repayments due in 7 days`);
    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    for (const repayment of dueRepayments) {
      try {
        const [loan, staff] = await Promise.all([
          this.loanModel.findById(repayment.loanId).exec(),
          this.staffModel.findById(repayment.staffId).exec(),
        ]);

        if (!loan || loan.status !== LoanStatus.Active) continue;
        if (!staff?.email) continue;

        const loanRef = repayment.loanId.slice(-6).toUpperCase();
        const html = renderLoanPaymentReminder({
          staffName: staff.fullName,
          loanRef,
          amountDue: repayment.dueAmount,
          dueDate: repayment.dueDate.toISOString(),
          organisationName,
        });

        const recipient: IEmailRecipient = {
          staffId: repayment.staffId,
          staffName: staff.fullName,
          email: staff.email,
        };

        await this.emailService.send(
          recipient,
          EmailLogType.LoanPaymentReminder,
          `Loan Payment Reminder - Due ${repayment.dueDate.toLocaleDateString('en-GB')}`,
          html,
          EmailTriggerSource.Cron,
        );
      } catch (err) {
        this.logger.error(`Reminder failed for repayment ${repayment._id.toString()}`, err);
      }
    }

    this.logger.log('Payment reminder job complete');
  }
}
