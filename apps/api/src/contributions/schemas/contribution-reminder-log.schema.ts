import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContributionReminderLogDocument = HydratedDocument<ContributionReminderLog>;

/**
 * Tracks a sent missed-contribution reminder for a staff-month that has no
 * Contribution document at all (a "missed" month is an absent document, not
 * a status on one — there is nothing else to stamp a send-marker onto).
 */
@Schema({ timestamps: true, collection: 'contribution_reminder_logs' })
export class ContributionReminderLog {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true }) sentAt!: Date;
}

export const ContributionReminderLogSchema = SchemaFactory.createForClass(ContributionReminderLog);
ContributionReminderLogSchema.index({ staffId: 1, month: 1, year: 1 }, { unique: true });
