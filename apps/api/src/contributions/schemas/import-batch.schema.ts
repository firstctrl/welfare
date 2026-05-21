import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type ImportBatchDocument = HydratedDocument<ImportBatch>;

@Schema({ _id: false })
class FlaggedEntry {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) employeeName!: string;
  @Prop({ required: true }) amount!: number;
  @Prop({ required: true }) reason!: string;
}

@Schema({ timestamps: true, collection: 'import_batches' })
export class ImportBatch {
  @Prop({ required: true, min: 0, max: 12 }) month!: number;
  @Prop({ required: true, min: 0 }) year!: number;
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, min: 0 }) totalRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) matchedRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) flaggedRows!: number;
  @Prop({ type: [FlaggedEntry], default: [] }) flaggedEntries!: FlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const ImportBatchSchema = SchemaFactory.createForClass(ImportBatch);
ImportBatchSchema.index({ status: 1 });
ImportBatchSchema.index({ month: 1, year: 1 });
