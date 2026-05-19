import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditAction,
  AuditEntity,
  ConfigKey,
  LoanRepaymentStatus,
  RepaymentSource,
} from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';

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
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
  ) {}

  @Cron('5 0 * * *')
  async detectAndProcess(): Promise<void> {
    this.logger.log('Starting overdue detection job');
    const config = await this.configService.getAll();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
}
