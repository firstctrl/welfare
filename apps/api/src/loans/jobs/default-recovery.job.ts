import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditAction,
  AuditEntity,
  ConfigKey,
  LoanRepaymentStatus,
  LoanStatus,
  RepaymentSource,
} from '@welfare/shared';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';

type ConfigMap = Record<string, { value: string }>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class DefaultRecoveryJob {
  private readonly logger = new Logger(DefaultRecoveryJob.name);

  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
  ) {}

  @Cron('10 0 * * *')
  async detectAndMarkDefaulted(): Promise<void> {
    this.logger.log('Starting end-of-tenure default detection');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const graceMonths = parseInt(config[ConfigKey.EndOfTenureGracePeriodMonths]?.value ?? '1', 10);

    const candidates = await this.repaymentModel.aggregate([
      { $match: { status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } } },
      { $group: { _id: '$loanId', maxDueDate: { $max: '$dueDate' }, count: { $sum: 1 } } },
      { $match: { maxDueDate: { $lt: today } } },
    ]).exec() as Array<{ _id: string; maxDueDate: Date; count: number }>;

    if (candidates.length === 0) return;

    const candidateLoanIds = candidates.map((c) => c._id);
    const activeLoans = await this.loanModel.find({
      _id: { $in: candidateLoanIds },
      status: LoanStatus.Active,
    }).exec();

    this.logger.log(`Found ${activeLoans.length} loans to mark Defaulted`);

    for (const loan of activeLoans) {
      try {
        const graceExpiry = new Date(today.getFullYear(), today.getMonth() + graceMonths + 1, 1);

        await this.loanModel.findByIdAndUpdate(loan._id, {
          $set: {
            status: LoanStatus.Defaulted,
            defaultedAt: today,
            endOfTenureGraceExpiry: graceExpiry,
          },
        }).exec();

        await this.repaymentModel.updateMany(
          { loanId: loan._id.toString(), status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] } },
          { $set: { status: LoanRepaymentStatus.Overdue } },
        ).exec();

        this.auditService.log(
          'system', 'DefaultRecoveryJob',
          AuditAction.Update, AuditEntity.Loan,
          loan._id.toString(),
          { status: LoanStatus.Active },
          { status: LoanStatus.Defaulted, defaultedAt: today, endOfTenureGraceExpiry: graceExpiry },
        );
      } catch (err) {
        this.logger.error(`Failed to mark loan ${loan._id.toString()} as Defaulted`, err);
      }
    }
  }

  @Cron('15 0 * * *')
  async runGracePeriodRecovery(): Promise<void> {
    this.logger.log('Starting grace period recovery');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const defaultedLoans = await this.loanModel.find({
      status: LoanStatus.Defaulted,
      endOfTenureGraceExpiry: { $lt: today },
      recoveryRanAt: { $exists: false },
    }).exec();

    this.logger.log(`Found ${defaultedLoans.length} defaulted loans for recovery`);

    for (const loan of defaultedLoans) {
      try {
        await this.recoverDefaultedLoan(loan, today);
      } catch (err) {
        this.logger.error(`Failed recovery for loan ${loan._id.toString()}`, err);
      }
    }
  }

  private async recoverDefaultedLoan(loan: LoanDocument, today: Date): Promise<void> {
    const loanId = loan._id.toString();

    const unpaidInstalments = await this.repaymentModel.find({
      loanId,
      status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
    }).exec();

    const outstanding = round2(
      unpaidInstalments.reduce((sum, i) => sum + i.dueAmount + i.penaltyAmount - i.paidAmount, 0),
    );

    if (outstanding <= 0) {
      await this.loanModel.findByIdAndUpdate(loan._id, { $set: { recoveryRanAt: today } }).exec();
      return;
    }

    const { debited: defaulterDebited, remaining: afterDefaulter } =
      await this.contributionsService.debitDefaulterContribution(
        loan.staffId, outstanding, 'system', 'DefaultRecoveryJob',
      );

    let guarantorRestitutionOwed = 0;
    let badDebtAmount = 0;

    if (afterDefaulter > 0) {
      const { debited: guarantorDebited, remaining: stillUnpaid } =
        await this.contributionsService.debitGuarantorOffset(
          loan.guarantorId, afterDefaulter, loanId, 'system', 'DefaultRecoveryJob',
        );
      guarantorRestitutionOwed = guarantorDebited;
      badDebtAmount = round2(stillUnpaid);
    }

    let defaulterBudget = defaulterDebited;
    for (const inst of unpaidInstalments) {
      if (defaulterBudget <= 0) break;
      const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
      if (defaulterBudget >= owed) {
        inst.paidAmount = round2(inst.paidAmount + owed);
        inst.status = LoanRepaymentStatus.Paid;
        inst.source = RepaymentSource.ExitDeduction;
        inst.paidDate = today;
        defaulterBudget = round2(defaulterBudget - owed);
      } else {
        inst.paidAmount = round2(inst.paidAmount + defaulterBudget);
        inst.status = LoanRepaymentStatus.Partial;
        inst.source = RepaymentSource.ExitDeduction;
        inst.paidDate = today;
        defaulterBudget = 0;
      }
      await inst.save();
    }

    if (guarantorRestitutionOwed > 0) {
      let guarantorBudget = guarantorRestitutionOwed;
      const stillUnpaidInsts = await this.repaymentModel.find({
        loanId,
        status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
      }).exec();
      for (const inst of stillUnpaidInsts) {
        if (guarantorBudget <= 0) break;
        const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
        if (guarantorBudget >= owed) {
          inst.paidAmount = round2(inst.paidAmount + owed);
          inst.status = LoanRepaymentStatus.Paid;
          inst.source = RepaymentSource.GuarantorOffset;
          inst.guarantorStaffId = loan.guarantorId;
          inst.paidDate = today;
          guarantorBudget = round2(guarantorBudget - owed);
        } else {
          inst.paidAmount = round2(inst.paidAmount + guarantorBudget);
          inst.status = LoanRepaymentStatus.Partial;
          inst.source = RepaymentSource.GuarantorOffset;
          inst.guarantorStaffId = loan.guarantorId;
          inst.paidDate = today;
          guarantorBudget = 0;
        }
        await inst.save();
      }
    }

    await this.loanModel.findByIdAndUpdate(loan._id, {
      $set: {
        defaulterContributionDebited: defaulterDebited,
        guarantorRestitutionOwed,
        badDebtAmount,
        recoveryRanAt: today,
      },
    }).exec();

    this.auditService.log(
      'system', 'DefaultRecoveryJob',
      AuditAction.Update, AuditEntity.Loan,
      loanId, undefined,
      { defaulterDebited, guarantorRestitutionOwed, badDebtAmount },
    );
  }
}
