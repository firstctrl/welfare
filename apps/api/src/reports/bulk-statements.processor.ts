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
  year: number;
  triggeredBy: 'manual' | 'cron';
}

export interface BulkSendJobResult {
  sent: number;
  failed: number;
  total: number;
}

@Processor('bulk-statements')
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
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < total; i++) {
      const staffId = staffIds[i];
      try {
        const staff = await this.staffModel.findById(staffId).exec();
        if (!staff?.email) {
          failed++;
        } else {
          const pdf = await this.reportsService.generateStatementPdf(staffId);
          await this.emailService.sendWithAttachment(
            { staffId, staffName: staff.fullName, email: staff.email },
            `Your Welfare Department Contribution Statement - ${year}`,
            `<p>Dear ${staff.fullName},</p><p>Please find attached your welfare contribution statement for ${year}.</p><p>Kind regards,<br/>Welfare Department</p>`,
            [{ filename: `statement-${staff.staffId}-${year}.pdf`, content: pdf }],
            triggeredBy === 'cron' ? EmailTriggerSource.Cron : EmailTriggerSource.Manual,
          );
          sent++;
        }
      } catch (err) {
        this.logger.error(`Failed sending statement to staff ${staffId}: ${(err as Error).message}`);
        failed++;
      }

      await job.updateProgress(Math.round(((i + 1) / total) * 100));
    }

    return { sent, failed, total };
  }
}
