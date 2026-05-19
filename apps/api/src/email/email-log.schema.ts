import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { EmailLogStatus, EmailLogType, EmailProvider, EmailTriggerSource } from '@welfare/shared';

@Schema({ _id: false })
class EmailRecipient {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) staffName!: string;
  @Prop({ required: true }) email!: string;
}
const EmailRecipientSchema = SchemaFactory.createForClass(EmailRecipient);

export type EmailLogDocument = HydratedDocument<EmailLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'email_logs' })
export class EmailLog {
  @Prop({ type: EmailRecipientSchema, required: true }) recipient!: EmailRecipient;
  @Prop({ required: true, enum: Object.values(EmailLogType) }) type!: EmailLogType;
  @Prop({ required: true }) subject!: string;
  @Prop({ required: true, enum: Object.values(EmailLogStatus), default: EmailLogStatus.Sent })
  status!: EmailLogStatus;
  @Prop({ required: true, enum: Object.values(EmailProvider) }) provider!: EmailProvider;
  @Prop({ required: true, enum: Object.values(EmailTriggerSource) }) triggeredBy!: EmailTriggerSource;
  @Prop() sentAt?: Date;
  @Prop() errorMessage?: string;
}

export const EmailLogSchema = SchemaFactory.createForClass(EmailLog);
EmailLogSchema.index({ 'recipient.staffId': 1, createdAt: -1 });
EmailLogSchema.index({ status: 1 });
EmailLogSchema.index({ type: 1 });
