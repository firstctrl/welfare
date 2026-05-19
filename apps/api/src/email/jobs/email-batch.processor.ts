import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailService } from '../email.service';
import { EmailLogType, EmailTriggerSource, IEmailRecipient } from '@welfare/shared';

export interface EmailBatchJobData {
  recipient: IEmailRecipient;
  type: EmailLogType;
  subject: string;
  html: string;
  triggeredBy: EmailTriggerSource;
}

@Processor('email-batch', { concurrency: 5 })
export class EmailBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailBatchProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job<EmailBatchJobData>): Promise<void> {
    const { recipient, type, subject, html, triggeredBy } = job.data;
    this.logger.debug(`Processing email job ${job.id} for ${recipient.email}`);
    await this.emailService.send(recipient, type, subject, html, triggeredBy);
  }
}
