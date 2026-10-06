import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Model } from 'mongoose';
import { EmailTriggerSource } from '@welfare/shared';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { EmailService } from '../email/email.service';
import { ReportsService } from './reports.service';

export interface BulkSendJobData {
  staffIds: string[];
  /** Scopes the statement to one year (manual send). Omitted by the scheduled send, which mails full history. */
  year?: number;
  triggeredBy: 'manual' | 'cron';
  // Progress saved after each staff member, so a job restarted by a deploy
  // resumes where it stopped instead of re-emailing everyone from the start.
  nextIndex?: number;
  sent?: number;
  failed?: number;
}

export interface BulkSendJobResult {
  sent: number;
  failed: number;
  total: number;
}

// Allow the job to survive several API restarts mid-send; it resumes from nextIndex.
@Processor('bulk-statements', { maxStalledCount: 10 })
export class BulkStatementsProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkStatementsProcessor.name);

  constructor(
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly reportsService: ReportsService,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  async process(job: Job<BulkSendJobData>): Promise<BulkSendJobResult> {
    const { staffIds, year, triggeredBy } = job.data;
    const total = staffIds.length;
    const start = job.data.nextIndex ?? 0;
    let sent = job.data.sent ?? 0;
    let failed = job.data.failed ?? 0;
    if (start > 0) this.logger.log(`Job ${job.id} resuming at ${start}/${total}`);

    for (let i = start; i < total; i++) {
      const staffId = staffIds[i];
      try {
        const staff = await this.staffModel.findById(staffId).exec();
        if (!staff?.email) {
          failed++;
        } else {
          const pdf = await this.reportsService.generateStatementPdf(staffId, year);
          await this.emailService.sendWithAttachment(
            { staffId, staffName: staff.fullName, email: staff.email },
            year ? `Your Welfare Department Contribution Statement - ${year}` : `Your Welfare Department Contribution Statement`,
            `<p>Dear ${staff.fullName},</p><p>Please find attached your welfare contribution statement${year ? ` for ${year}` : ''}.</p><p>Kind regards,<br/>Welfare Department</p>`,
            [{ filename: year ? `statement-${staff.staffId}-${year}.pdf` : `statement-${staff.staffId}.pdf`, content: pdf }],
            triggeredBy === 'cron' ? EmailTriggerSource.Cron : EmailTriggerSource.Manual,
          );
          sent++;
        }
      } catch (err) {
        this.logger.error(`Failed sending statement to staff ${staffId}: ${(err as Error).message}`);
        failed++;
      }

      await job.updateData({ ...job.data, nextIndex: i + 1, sent, failed });
      await job.updateProgress(Math.round(((i + 1) / total) * 100));
    }

    return { sent, failed, total };
  }
}
