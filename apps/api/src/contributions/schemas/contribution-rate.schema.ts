import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'contribution_rates' })
export class ContributionRate {
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0.01 }) amount!: number;
  @Prop({ required: true }) effectiveKey!: number;
  @Prop({ required: true }) createdBy!: string;
}

export type ContributionRateDocument = HydratedDocument<ContributionRate>;
export const ContributionRateSchema = SchemaFactory.createForClass(ContributionRate);

ContributionRateSchema.index({ year: 1, month: 1 }, { unique: true });
ContributionRateSchema.index({ effectiveKey: -1 });
