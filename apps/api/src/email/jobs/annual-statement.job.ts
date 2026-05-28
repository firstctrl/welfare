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
  StaffStatus,
} from '@welfare/shared';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { Contribution, ContributionDocument } from '../../contributions/schemas/contribution.schema';
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

      // Fetch loan-related deductions for this staff over lastYear
      // (stored as debit contributions): guarantor offsets + own defaulter deductions.
      const offsets = await this.contribModel
        .find({
          staffId: staff._id.toString(),
          isDebit: true,
          source: { $in: ['GuarantorOffset', 'DefaulterDeduction'] },
          year: lastYear,
        })
        .exec();

      const offsetByMonth = new Map<number, number>();
      for (const o of offsets) {
        offsetByMonth.set(o.month, (offsetByMonth.get(o.month) ?? 0) + o.paidAmount);
      }
      const offsetRows = Array.from(offsetByMonth.entries())
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => a.month - b.month);
      const totalOffsets = offsets.reduce((s, o) => s + o.paidAmount, 0);

      // Borrower lookup for detail rows (bulk)
      const borrowerIds = [...new Set(offsets.map(o => o.borrowerStaffId).filter(Boolean) as string[])];
      const borrowers = borrowerIds.length
        ? await this.staffModel.find({ _id: { $in: borrowerIds } }).exec()
        : [];
      const borrowerMap = new Map(borrowers.map(b => [b._id.toString(), b]));

      const offsetDetail = offsets
        .map(o => {
          const isGuarantor = o.source === 'GuarantorOffset';
          const b = isGuarantor && o.borrowerStaffId ? borrowerMap.get(o.borrowerStaffId) : undefined;
          const createdAt = (o as unknown as { createdAt?: Date }).createdAt;
          const paidDate = createdAt
            ? new Date(createdAt).toLocaleDateString('en-GB')
            : `${String(o.month).padStart(2, '0')}/${o.year}`;
          return {
            paidDate,
            borrowerName: isGuarantor
              ? (b ? `${b.fullName} (${b.staffId})` : 'Unknown')
              : 'Own missed instalment',
            loanRef: o.loanId ? o.loanId.slice(-6).toUpperCase() : '—',
            amount: o.paidAmount,
          };
        })
        .sort((a, b) => a.paidDate.localeCompare(b.paidDate));

      const subject = `Your Welfare Contribution Statement - ${lastYear}`;
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
