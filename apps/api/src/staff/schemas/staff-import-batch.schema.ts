import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type StaffImportBatchDocument = HydratedDocument<StaffImportBatch>;

@Schema({ _id: false })
class StaffFlaggedEntry {
  @Prop({ required: true }) rowNumber!: number;
  @Prop({ default: '' }) staffId!: string;
  @Prop({ default: '' }) fullName!: string;
  @Prop({ required: true }) reason!: string;
}

@Schema({ timestamps: true, collection: 'staff_import_batches' })
export class StaffImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, default: 0 }) totalRows!: number;
  @Prop({ required: true, default: 0 }) matchedRows!: number;
  @Prop({ required: true, default: 0 }) flaggedRows!: number;
  @Prop({ type: [StaffFlaggedEntry], default: [] }) flaggedEntries!: StaffFlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const StaffImportBatchSchema = SchemaFactory.createForClass(StaffImportBatch);
StaffImportBatchSchema.index({ status: 1 });
StaffImportBatchSchema.index({ createdAt: -1 });
