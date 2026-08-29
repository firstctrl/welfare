import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ClaimType, CessationReason, ClaimStatus, ClaimSource } from '@welfare/shared';

export type ClaimDocument = HydratedDocument<Claim>;

@Schema({ timestamps: true, collection: 'claims' })
export class Claim {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, enum: ClaimType }) claimType!: ClaimType;
  @Prop({ enum: CessationReason }) subReason?: CessationReason;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0 }) amount!: number;
  @Prop({ required: true, enum: ClaimStatus, default: ClaimStatus.Pending })
  status!: ClaimStatus;
  @Prop({ required: true, enum: ClaimSource }) source!: ClaimSource;
  @Prop() importBatchId?: string;
  @Prop() approvedBy?: string;
  @Prop() approvedAt?: Date;
  @Prop() rejectedReason?: string;
  @Prop({ required: true }) recordedBy!: string;
}

export const ClaimSchema = SchemaFactory.createForClass(Claim);

ClaimSchema.index({ staffId: 1 });
ClaimSchema.index({ status: 1 });
ClaimSchema.index({ year: 1, claimType: 1 });
