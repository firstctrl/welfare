import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ContributionStatus, ContributionSource } from '@welfare/shared';

export type ContributionDocument = HydratedDocument<Contribution>;

@Schema({ timestamps: true, collection: 'contributions' })
export class Contribution {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0 }) expectedAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) surplusCarriedForward!: number;
  @Prop({ required: true, enum: ContributionStatus, default: ContributionStatus.Missed })
  status!: ContributionStatus;
  @Prop({ required: true, enum: ContributionSource }) source!: ContributionSource;
  @Prop() importBatchId?: string;
  @Prop({ required: true }) recordedBy!: string;
}

export const ContributionSchema = SchemaFactory.createForClass(Contribution);
ContributionSchema.index({ staffId: 1, month: 1, year: 1 }, { unique: true });
ContributionSchema.index({ status: 1 });
ContributionSchema.index({ month: 1, year: 1 });
