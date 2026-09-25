import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLogStatus, EmailLogType, EmailTriggerSource, IEmailRecipient, LoanStatus, StaffStatus } from '@welfare/shared';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderGracePeriodWarning } from '../../email/templates/grace-period-warning.template';

@Injectable()
export class GracePeriodWarningJob {
  private readonly logger = new Logger(GracePeriodWarningJob.name);

  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 2 * * *')
  async sendGracePeriodWarnings(): Promise<void> {
    this.logger.log('Starting grace period warning job');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetEnd = new Date(today);
    targetEnd.setDate(targetEnd.getDate() + 7);
    targetEnd.setHours(23, 59, 59, 999);

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    // From today through 7 days out (not an exact single day) — a loan whose
    // grace period is under 7 days at the moment it first qualifies would
    // otherwise never match the query and never get warned.
    const loans = await this.loanModel
      .find({
        status: LoanStatus.Defaulted,
        endOfTenureGraceExpiry: { $gte: today, $lte: targetEnd },
        gracePeriodWarningSentAt: { $exists: false },
      })
      .exec();

    this.logger.log(`Found ${loans.length} loans with grace period ending within 7 days`);

    for (const loan of loans) {
      try {
        const loanRef = loan._id.toString().slice(-6).toUpperCase();
        let sentAny = false;

        const [borrower, guarantor] = await Promise.all([
          this.staffModel.findById(loan.staffId).exec(),
          this.staffModel.findById(loan.guarantorId).exec(),
        ]);

        if (borrower?.email && borrower.status === StaffStatus.Active) {
          const html = renderGracePeriodWarning({
            recipientName: borrower.fullName,
            role: 'Borrower',
            loanRef,
            principalAmount: loan.principalAmount,
            graceExpiryDate: loan.endOfTenureGraceExpiry!.toISOString(),
            organisationName,
          });
          const recipient: IEmailRecipient = { staffId: borrower._id.toString(), staffName: borrower.fullName, email: borrower.email };
          const status = await this.emailService.send(recipient, EmailLogType.GracePeriodWarning, `Grace Period Ending - Loan Ref ${loanRef}`, html, EmailTriggerSource.Cron);
          if (status === EmailLogStatus.Sent) sentAny = true;
        }

        if (guarantor?.email && guarantor.status === StaffStatus.Active) {
          const html = renderGracePeriodWarning({
            recipientName: guarantor.fullName,
            role: 'Guarantor',
            loanRef,
            principalAmount: loan.principalAmount,
            graceExpiryDate: loan.endOfTenureGraceExpiry!.toISOString(),
            organisationName,
          });
          const recipient: IEmailRecipient = { staffId: guarantor._id.toString(), staffName: guarantor.fullName, email: guarantor.email };
          const status = await this.emailService.send(recipient, EmailLogType.GracePeriodWarning, `Grace Period Ending - Loan Ref ${loanRef}`, html, EmailTriggerSource.Cron);
          if (status === EmailLogStatus.Sent) sentAny = true;
        }

        if (sentAny) {
          await this.loanModel.updateOne({ _id: loan._id }, { $set: { gracePeriodWarningSentAt: new Date() } }).exec();
        }
      } catch (err) {
        this.logger.error(`Grace period warning failed for loan ${loan._id.toString()}`, err);
      }
    }

    this.logger.log('Grace period warning job complete');
  }
}
