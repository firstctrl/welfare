import { EmailLogStatus } from '../enums/email-log-status.enum';
import { EmailLogType } from '../enums/email-log-type.enum';
import { EmailProvider } from '../enums/email-provider.enum';
import { EmailTriggerSource } from '../enums/email-trigger-source.enum';

export interface IEmailRecipient {
  staffId: string;
  staffName: string;
  email: string;
}

export interface IEmailLog {
  _id: string;
  recipient: IEmailRecipient;
  type: EmailLogType;
  subject: string;
  status: EmailLogStatus;
  provider: EmailProvider;
  triggeredBy: EmailTriggerSource;
  scheduledFor?: string;
  sentAt?: string;
  errorMessage?: string;
  createdAt: string;
}
