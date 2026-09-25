import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLogType, EmailTriggerSource, IEmailRecipient, LoanStatus, StaffStatus } from '@welfare/shared';
import { Loan, LoanDocument } from '../../loans/schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderGuarantorRestitutionReminder } from '../../email/templates/guarantor-restitution-reminder.template';

@Injectable()
export class GuarantorRestitutionReminderJob {
  private readonly logger = new Logger(GuarantorRestitutionReminderJob.name);

  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 8 * * 1')
  async sendRestitutionReminders(): Promise<void> {
    this.logger.log('Starting guarantor restitution reminder job');

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const loans = await this.loanModel
      .find({
        status: { $in: [LoanStatus.Active, LoanStatus.Defaulted] },
        $expr: { $gt: ['$guarantorRestitutionOwed', '$guarantorRestitutionPaid'] },
      })
      .exec();

    this.logger.log(`Found ${loans.length} loans with unresolved guarantor restitution`);

    for (const loan of loans) {
      try {
        const [guarantor, borrower] = await Promise.all([
          this.staffModel.findById(loan.guarantorId).exec(),
          this.staffModel.findById(loan.staffId).exec(),
        ]);
        if (!guarantor?.email || guarantor.status !== StaffStatus.Active) continue;

        const amountOwed = (loan.guarantorRestitutionOwed ?? 0) - (loan.guarantorRestitutionPaid ?? 0);
        const loanRef = loan._id.toString().slice(-6).toUpperCase();

        const html = renderGuarantorRestitutionReminder({
          guarantorName: guarantor.fullName,
          borrowerName: borrower?.fullName ?? 'Unknown',
          loanRef,
          amountOwed,
          organisationName,
        });

        const recipient: IEmailRecipient = { staffId: guarantor._id.toString(), staffName: guarantor.fullName, email: guarantor.email };
        await this.emailService.send(recipient, EmailLogType.GuarantorRestitutionReminder, `Restitution Still Outstanding - Loan Ref ${loanRef}`, html, EmailTriggerSource.Cron);
      } catch (err) {
        this.logger.error(`Restitution reminder failed for loan ${loan._id.toString()}`, err);
      }
    }

    this.logger.log('Guarantor restitution reminder job complete');
  }
}
