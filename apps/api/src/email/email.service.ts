import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import {
  EmailLogStatus,
  EmailLogType,
  EmailProvider,
  EmailTriggerSource,
  IEmailRecipient,
} from '@welfare/shared';
import { EmailLog, EmailLogDocument } from './email-log.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { Loan, LoanDocument } from '../loans/schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from '../loans/schemas/loan-repayment.schema';
import { renderContributionStatement } from './templates/contribution-statement.template';
import { renderLoanSchedule } from './templates/loan-schedule.template';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectModel(EmailLog.name) private readonly emailLogModel: Model<EmailLogDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly configService: SystemConfigService,
  ) {}

  async send(
    recipient: IEmailRecipient,
    type: EmailLogType,
    subject: string,
    html: string,
    triggeredBy: EmailTriggerSource,
  ): Promise<void> {
    const config = await this.configService.getAll();
    const provider = (config['EMAIL_PROVIDER']?.value ?? 'smtp') as EmailProvider;
    const fromAddress = config['EMAIL_FROM_ADDRESS']?.value ?? 'noreply@welfare.local';
    const fromName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    let errorMessage: string | undefined;
    let status = EmailLogStatus.Sent;

    try {
      if (provider === EmailProvider.Resend) {
        const apiKey = config['RESEND_API_KEY']?.value ?? '';
        const resend = new Resend(apiKey);
        const result = await resend.emails.send({
          from: `${fromName} <${fromAddress}>`,
          to: recipient.email,
          subject,
          html,
        });
        if (result.error) throw new Error(result.error.message);
      } else {
        const transporter = nodemailer.createTransport({
          host: config['OUTLOOK_HOST']?.value ?? 'smtp.office365.com',
          port: parseInt(config['OUTLOOK_PORT']?.value ?? '587', 10),
          secure: false,
          auth: {
            user: config['OUTLOOK_USERNAME']?.value ?? '',
            pass: config['OUTLOOK_PASSWORD']?.value ?? '',
          },
        });
        await transporter.sendMail({
          from: `"${fromName}" <${fromAddress}>`,
          to: recipient.email,
          subject,
          html,
        });
      }
    } catch (err) {
      this.logger.error(`Email send failed to ${recipient.email}: ${(err as Error).message}`);
      status = EmailLogStatus.Failed;
      errorMessage = (err as Error).message;
    }

    try {
      await this.emailLogModel.create({
        recipient,
        type,
        subject,
        status,
        provider,
        triggeredBy,
        sentAt: status === EmailLogStatus.Sent ? new Date() : undefined,
        errorMessage,
      });
    } catch (logErr) {
      this.logger.error(`Failed to write email log: ${(logErr as Error).message}`);
    }
  }

  async listLogs(filters: {
    staffId?: string;
    type?: EmailLogType;
    status?: EmailLogStatus;
    page?: number;
    limit?: number;
  }) {
    const query: Record<string, unknown> = {};
    if (filters.staffId) query['recipient.staffId'] = filters.staffId;
    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.emailLogModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.emailLogModel.countDocuments(query).exec(),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async sendContributionStatementForStaff(
    staffId: string,
    year: number,
    triggeredBy: EmailTriggerSource,
  ): Promise<void> {
    const staff = await this.staffModel.findById(staffId).exec();
    if (!staff) throw new NotFoundException(`Staff ${staffId} not found`);
    if (!staff.email) throw new Error(`Staff ${staffId} has no email address`);

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const rows = await this.contribModel
      .aggregate([
        { $match: { staffId, year, isDebit: { $ne: true } } },
        { $project: { month: 1, expectedAmount: 1, paidAmount: 1, surplusCarriedForward: 1, status: 1 } },
        { $sort: { month: 1 } },
      ])
      .exec();

    const totalExpected = rows.reduce((s: number, r: any) => s + r.expectedAmount, 0);
    const totalPaid = rows.reduce((s: number, r: any) => s + r.paidAmount, 0);
    const totalMissed = rows.reduce((s: number, r: any) => s + Math.max(0, r.expectedAmount - r.paidAmount), 0);
    const netSurplus = rows.reduce((s: number, r: any) => s + r.surplusCarriedForward, 0);

    const html = await renderContributionStatement({
      staffName: staff.fullName,
      staffNo: staff.staffId,
      year,
      organisationName,
      rows,
      totalExpected,
      totalPaid,
      totalMissed,
      netSurplus,
    });

    await this.send(
      { staffId, staffName: staff.fullName, email: staff.email },
      EmailLogType.ContributionStatement,
      `Your Welfare Contribution Statement — ${year}`,
      html,
      triggeredBy,
    );
  }

  async sendLoanScheduleById(loanId: string, triggeredBy: EmailTriggerSource): Promise<void> {
    const loan = await this.loanModel.findById(loanId).exec();
    if (!loan) throw new NotFoundException(`Loan ${loanId} not found`);

    const staff = await this.staffModel.findById(loan.staffId).exec();
    if (!staff?.email) throw new Error(`Staff has no email address`);

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const schedule = await this.repaymentModel
      .find({ loanId })
      .sort({ instalmentNumber: 1 })
      .exec();

    const totalPaid = schedule.reduce((s, r) => s + r.paidAmount, 0);
    const totalOutstanding = schedule.reduce((s, r) => s + r.dueAmount - r.paidAmount, 0);

    const html = await renderLoanSchedule({
      staffName: staff.fullName,
      staffNo: staff.staffId,
      loanId,
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

    await this.send(
      { staffId: loan.staffId, staffName: staff.fullName, email: staff.email },
      EmailLogType.LoanSchedule,
      `Your Loan Repayment Schedule — Loan #${loanId.slice(-6).toUpperCase()}`,
      html,
      triggeredBy,
    );
  }
}
