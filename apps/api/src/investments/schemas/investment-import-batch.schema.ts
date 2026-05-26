import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InvestmentImportBatchDocument = HydratedDocument<InvestmentImportBatch>;

interface InvestmentFlaggedRow {
  rowNumber: number;
  description: string;
  flagReason: string;
}

@Schema({ timestamps: true, collection: 'investment_import_batches' })
export class InvestmentImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) recordedBy!: string;
  @Prop({ required: true, default: 0 }) total!: number;
  @Prop({ required: true, default: 0 }) imported!: number;
  @Prop({ required: true, default: 0 }) flagged!: number;
  @Prop({ type: [Object], default: [] }) flaggedRows!: InvestmentFlaggedRow[];
}

export const InvestmentImportBatchSchema = SchemaFactory.createForClass(InvestmentImportBatch);
