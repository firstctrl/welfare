import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import {
  AuditAction,
  AuditEntity,
  EmailLogType,
  EmailTriggerSource,
  RepaymentSource,
  StaffStatus,
} from '@welfare/shared';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { Contribution, ContributionDocument } from '../../contributions/schemas/contribution.schema';
import { LoanRepayment, LoanRepaymentDocument } from '../../loans/schemas/loan-repayment.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { renderContributionStatement } from '../templates/contribution-statement.template';
import { EmailBatchJobData } from './email-batch.processor';

@Injectable()
export class AnnualStatementJob {
  private readonly logger = new Logger(AnnualStatementJob.name);

  constructor(
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectQueue('email-batch') private readonly emailQueue: Queue<EmailBatchJobData>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
  ) {}

  @Cron('0 8 1 1 *')
  async detectAndRun(): Promise<void> {
    this.logger.log('Annual statement cron triggered');
    await this.run();
  }

  async run(): Promise<void> {
    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';
    const lastYear = new Date().getFullYear() - 1;

    const allStaff = await this.staffModel.find({ status: StaffStatus.Active }).exec();

    let enqueued = 0;
    let skipped = 0;

    for (const staff of allStaff) {
      if (!staff.email) {
        skipped++;
        this.logger.warn(`Skipping ${staff.staffId} — no email on record`);
        continue;
      }

      const rows = await this.contribModel
        .aggregate([
          { $match: { staffId: staff._id.toString(), year: lastYear, isDebit: { $ne: true } } },
          { $project: { month: 1, expectedAmount: 1, paidAmount: 1, surplusCarriedForward: 1, status: 1 } },
          { $sort: { month: 1 } },
        ])
        .exec();

      const totalExpected = rows.reduce((s: number, r: any) => s + r.expectedAmount, 0);
      const totalPaid = rows.reduce((s: number, r: any) => s + r.paidAmount, 0);
      const totalMissed = rows.reduce((s: number, r: any) => s + Math.max(0, r.expectedAmount - r.paidAmount), 0);
      const netSurplus = rows.reduce((s: number, r: any) => s + r.surplusCarriedForward, 0);

      // Fetch guarantor offsets for this staff over lastYear
      const offsets = await this.repaymentModel
        .find({
          guarantorStaffId: staff._id.toString(),
          source: RepaymentSource.GuarantorOffset,
          paidDate: { $gte: new Date(lastYear, 0, 1), $lt: new Date(lastYear + 1, 0, 1) },
        })
        .exec();

      const offsetByMonth = new Map<number, number>();
      for (const o of offsets) {
        if (!o.paidDate) continue;
        const m = new Date(o.paidDate).getMonth() + 1;
        offsetByMonth.set(m, (offsetByMonth.get(m) ?? 0) + o.paidAmount);
      }
      const offsetRows = Array.from(offsetByMonth.entries())
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => a.month - b.month);
      const totalOffsets = offsets.reduce((s, o) => s + o.paidAmount, 0);

      // Borrower lookup for detail rows
      const borrowerIds = [...new Set(offsets.map(o => o.staffId).filter(Boolean))];
      const borrowers = borrowerIds.length
        ? await this.staffModel.find({ _id: { $in: borrowerIds } }).exec()
        : [];
      const borrowerMap = new Map(borrowers.map(b => [b._id.toString(), b]));

      const offsetDetail = offsets
        .filter(o => o.paidDate)
        .map(o => {
          const b = borrowerMap.get(o.staffId);
          return {
            paidDate: new Date(o.paidDate as Date).toLocaleDateString('en-GB'),
            borrowerName: b ? `${b.fullName} (${b.staffId})` : 'Unknown',
            loanRef: o.loanId.slice(-6).toUpperCase(),
            amount: o.paidAmount,
          };
        })
        .sort((a, b) => a.paidDate.localeCompare(b.paidDate));

      const subject = `Your Welfare Contribution Statement — ${lastYear}`;
      const html = await renderContributionStatement({
        staffName: staff.fullName,
        staffNo: staff.staffId,
        year: lastYear,
        organisationName,
        rows,
        totalExpected,
        totalPaid,
        totalMissed,
        netSurplus,
        offsetRows,
        totalOffsets,
        offsetDetail,
      });

      await this.emailQueue.add(
        'send-statement',
        {
          recipient: { staffId: staff._id.toString(), staffName: staff.fullName, email: staff.email },
          type: EmailLogType.ContributionStatement,
          subject,
          html,
          triggeredBy: EmailTriggerSource.Cron,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
      enqueued++;
    }

    this.logger.log(`Annual statement: enqueued=${enqueued}, skipped=${skipped}`);
    await this.auditService.log(
      'system',
      'System',
      AuditAction.GenerateStatement,
      AuditEntity.Contribution,
      'annual-statement-job',
      undefined,
      { year: lastYear, enqueued, skipped },
    );
  }
}
