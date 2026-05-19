import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectModel(EmailLog.name) private readonly emailLogModel: Model<EmailLogDocument>,
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
}
