import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditAction,
  AuditEntity,
  ConfigKey,
  EmailLogType,
  EmailTriggerSource,
  IEmailRecipient,
  LoanRepaymentStatus,
  RepaymentSource,
} from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { Discount, DiscountDocument } from '../schemas/discount.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';
import { EmailService } from '../../email/email.service';
import { renderLoanForfeitureNotice } from '../../email/templates/loan-forfeiture-notice.template';

type ConfigMap = Record<string, { value: string }>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class OverdueDetectionJob {
  private readonly logger = new Logger(OverdueDetectionJob.name);

  constructor(
    @InjectModel(LoanRepayment.name)
    private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('5 0 * * *')
  async detectAndProcess(): Promise<void> {
    this.logger.log('Starting overdue detection job');
    const config = await this.configService.getAll();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.runForfeitureCheck(today, config as ConfigMap);

    const dueInstalments = await this.repaymentModel
      .find({
        dueDate: { $lt: today },
        status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] },
      })
      .exec();

    this.logger.log(`Found ${dueInstalments.length} overdue instalments`);

    for (const inst of dueInstalments) {
      try {
        await this.processOverdueInstalment(inst, config as ConfigMap, today);
      } catch (err) {
        this.logger.error(`Failed to process instalment ${inst._id.toString()}`, err);
      }
    }
  }

  private async processOverdueInstalment(
    inst: LoanRepaymentDocument,
    config: ConfigMap,
    today: Date,
  ): Promise<void> {
    inst.status = LoanRepaymentStatus.Overdue;
    if (inst.penaltyAmount === 0) {
      inst.penaltyAmount = this.calculatePenalty(inst.dueAmount, config);
    }
    await inst.save();

    if (!this.isGracePeriodExpired(inst.dueDate, today, config)) return;

    const loan = await this.loanModel.findById(inst.loanId).exec();
    if (!loan) return;

    const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);

    const { debited, remaining } = await this.contributionsService.debitGuarantorOffset(
      loan.guarantorId,
      outstanding,
      inst.loanId,
      'system',
      'Overdue Detection Job',
    );

    if (debited > 0) {
      inst.paidAmount = round2(inst.paidAmount + debited);
      inst.guarantorStaffId = loan.guarantorId;
      inst.source = RepaymentSource.GuarantorOffset;
      inst.paidDate = new Date();
      inst.status = remaining === 0 ? LoanRepaymentStatus.Paid : LoanRepaymentStatus.Partial;
      await inst.save();

      this.auditService.log(
        'system',
        'Overdue Detection Job',
        AuditAction.Update,
        AuditEntity.LoanRepayment,
        inst._id.toString(),
        undefined,
        { debited, remaining, guarantorId: loan.guarantorId },
      );
    }
  }

  private isGracePeriodExpired(dueDate: Date, today: Date, config: ConfigMap): boolean {
    const gracePeriodDays = parseInt(config[ConfigKey.GracePeriodDays]?.value ?? '0', 10);

    if (gracePeriodDays === 0) {
      return (
        today.getFullYear() > dueDate.getFullYear() ||
        (today.getFullYear() === dueDate.getFullYear() &&
          today.getMonth() > dueDate.getMonth())
      );
    }

    const expiry = new Date(dueDate.getTime() + gracePeriodDays * 86_400_000);
    return today >= expiry;
  }

  private calculatePenalty(dueAmount: number, config: ConfigMap): number {
    const penaltyType = config[ConfigKey.PenaltyType]?.value ?? 'Fixed';
    const penaltyValue = parseFloat(config[ConfigKey.PenaltyValue]?.value ?? '0');
    if (penaltyValue === 0) return 0;
    return penaltyType === 'Percentage'
      ? round2(dueAmount * (penaltyValue / 100))
      : penaltyValue;
  }

  private async runForfeitureCheck(today: Date, config: ConfigMap): Promise<void> {
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const candidates = await this.loanModel.find({
      tenureMonths: { $lte: 6 },
      status: 'Active',
      forfeitedAt: { $exists: false },
      disbursedDate: { $lte: sixMonthsAgo },
    }).exec();

    for (const loan of candidates) {
      try {
        const loanId = loan._id.toString();
        const allRepayments = await this.repaymentModel.find({ loanId }).exec();
        const alreadyPaid = round2(allRepayments.reduce((s, r) => s + r.paidAmount, 0));

        const newTotalRepayable = round2(loan.principalAmount * 1.15);
        const newOutstanding = round2(newTotalRepayable - alreadyPaid);

        const unpaid = allRepayments
          .filter(r => ['Pending', 'Partial', 'Overdue'].includes(r.status))
          .sort((a, b) => a.instalmentNumber - b.instalmentNumber);

        const N = unpaid.length;
        if (N > 0) {
          const newTotalInterest = round2(newTotalRepayable - loan.principalAmount);
          const interestPerInst = round2(newTotalInterest / loan.tenureMonths);
          const baseNewDue = round2(newOutstanding / N);

          for (let i = 0; i < N; i++) {
            const inst = unpaid[i];
            const isLast = i === N - 1;
            const dueAmount = isLast ? round2(newOutstanding - baseNewDue * (N - 1)) : baseNewDue;
            const interestAmount = isLast ? round2(newTotalInterest - interestPerInst * (loan.tenureMonths - 1)) : interestPerInst;
            const principalAmount = round2(Math.max(0, dueAmount - interestAmount));
            await this.repaymentModel.updateOne({ _id: inst._id }, { dueAmount, principalAmount, interestAmount });
          }
        }

        const newMonthlyInstalment = N > 0 ? round2(newOutstanding / N) : loan.monthlyInstalment;
        await this.loanModel.updateOne(
          { _id: loanId },
          { interestRate: 15, totalRepayable: newTotalRepayable, monthlyInstalment: newMonthlyInstalment, forfeitedAt: today },
        );

        await this.discountModel.updateOne(
          { loanId, discountType: 'Origination', cancelled: false },
          { cancelled: true, cancelledAt: today, cancelledReason: 'Discount forfeiture: loan crossed 6-month threshold with outstanding balance' },
        );

        this.auditService.log(
          'system', 'System', AuditAction.Update, AuditEntity.Loan, loanId, undefined,
          { event: 'forfeiture', originalTotal: loan.totalRepayable, revisedTotal: newTotalRepayable, clawback: round2(newTotalRepayable - loan.totalRepayable) },
        );

        const staff = await this.staffModel.findById(loan.staffId).exec();
        if (staff?.email) {
          const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';
          const loanRef = loanId.slice(-6).toUpperCase();
          const html = await renderLoanForfeitureNotice({
            staffName: staff.fullName,
            loanRef,
            originalTotal: loan.totalRepayable,
            revisedTotal: newTotalRepayable,
            clawbackAmount: round2(newTotalRepayable - loan.totalRepayable),
            newOutstanding,
            organisationName,
          });
          const recipient: IEmailRecipient = { staffId: loan.staffId, staffName: staff.fullName, email: staff.email };
          await this.emailService.send(
            recipient,
            EmailLogType.LoanForfeitureNotice,
            'Interest Rate Adjustment on Your Loan',
            html,
            EmailTriggerSource.Cron,
          );
        }

        this.logger.log(`Forfeiture applied to loan ${loanId}`);
      } catch (err) {
        this.logger.error(`Forfeiture failed for loan ${loan._id.toString()}`, err);
      }
    }
  }
}
