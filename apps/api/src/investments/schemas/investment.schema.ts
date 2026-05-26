import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InvestmentDocument = HydratedDocument<Investment>;

interface EditHistoryEntry {
  editedBy: string;
  editedAt: Date;
  reason: string;
  snapshot: Record<string, unknown>;
}

@Schema({ timestamps: true, collection: 'investments' })
export class Investment {
  @Prop({ required: true }) purchaseDate!: Date;
  @Prop({ required: true }) description!: string;
  @Prop({ required: true, min: 0 }) cost!: number;
  @Prop({ required: true }) maturityDate!: Date;
  @Prop({ required: true, min: 0 }) faceValue!: number;
  @Prop({ required: true, min: 0 }) interest!: number;
  @Prop({ required: true, min: 0 }) rate!: number;
  @Prop({ required: true, enum: ['One-Time', 'Roll-Over'] }) instruction!: 'One-Time' | 'Roll-Over';
  @Prop({ required: true }) recordedBy!: string;
  @Prop() importBatchId?: string;
  @Prop({ type: [Object], default: [] }) editHistory!: EditHistoryEntry[];
  @Prop() deletedAt?: Date;
  @Prop() deletedBy?: string;
  @Prop() deletionReason?: string;
}

export const InvestmentSchema = SchemaFactory.createForClass(Investment);
InvestmentSchema.index({ deletedAt: 1 });
