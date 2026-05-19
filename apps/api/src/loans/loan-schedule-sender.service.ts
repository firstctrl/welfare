import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLogType, EmailTriggerSource, ConfigKey } from '@welfare/shared';
import { LoanDocument } from './schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from './schemas/loan-repayment.schema';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { EmailService } from '../email/email.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { renderLoanSchedule } from '../email/templates/loan-schedule.template';

@Injectable()
export class LoanScheduleSenderService {
  private readonly logger = new Logger(LoanScheduleSenderService.name);

  constructor(
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly emailService: EmailService,
    private readonly configService: SystemConfigService,
  ) {}

  async sendForLoan(loan: LoanDocument): Promise<void> {
    const config = await this.configService.getAll();
    const enabled = config[ConfigKey.EmailLoanScheduleEnabled]?.value === 'true';
    if (!enabled) return;

    const staff = await this.staffModel.findById(loan.staffId).exec();
    if (!staff?.email) {
      this.logger.warn(`Skipping loan schedule email for ${loan.staffId} — no email on record`);
      return;
    }

    const schedule = await this.repaymentModel
      .find({ loanId: loan._id.toString() })
      .sort({ instalmentNumber: 1 })
      .exec();

    const totalPaid = schedule.reduce((s, r) => s + r.paidAmount, 0);
    const totalOutstanding = schedule.reduce((s, r) => s + r.dueAmount - r.paidAmount, 0);
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const html = await renderLoanSchedule({
      staffName: staff.fullName,
      staffNo: staff.staffId,
      loanId: loan._id.toString(),
      disbursedDate: loan.disbursedDate.toISOString(),
      principalAmount: loan.principalAmount,
      interestRate: loan.interestRate,
      totalRepayable: loan.totalRepayable,
      organisationName,
      schedule: schedule.map(r => ({
        instalmentNumber: r.instalmentNumber,
        dueDate: r.dueDate.toISOString(),
        dueAmount: r.dueAmount,
        paidAmount: r.paidAmount,
        outstanding: r.dueAmount - r.paidAmount,
        status: r.status,
      })),
      totalPaid,
      totalOutstanding,
      loanStatus: loan.status,
    });

    await this.emailService.send(
      { staffId: staff._id.toString(), staffName: staff.fullName, email: staff.email },
      EmailLogType.LoanSchedule,
      `Your Loan Repayment Schedule — Loan #${loan._id.toString().slice(-6).toUpperCase()}`,
      html,
      EmailTriggerSource.Cron,
    );
  }
}
