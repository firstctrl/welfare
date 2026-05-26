import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RemittanceImportBatchDocument = HydratedDocument<RemittanceImportBatch>;

interface RemittanceFlaggedRow {
  rowNumber: number;
  month: number;
  year: number;
  flagReason: string;
}

@Schema({ timestamps: true, collection: 'remittance_import_batches' })
export class RemittanceImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) recordedBy!: string;
  @Prop({ required: true, default: 0 }) total!: number;
  @Prop({ required: true, default: 0 }) imported!: number;
  @Prop({ required: true, default: 0 }) flagged!: number;
  @Prop({ type: [Object], default: [] }) flaggedRows!: RemittanceFlaggedRow[];
}

export const RemittanceImportBatchSchema = SchemaFactory.createForClass(RemittanceImportBatch);
