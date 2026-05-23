import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type LoanRecordsImportBatchDocument = HydratedDocument<LoanRecordsImportBatch>;

@Schema({ _id: false })
class LoanRecordFlaggedEntry {
  @Prop({ required: true }) rowNumber!: number;
  @Prop({ default: '' }) staffId!: string;
  @Prop({ default: '' }) guarantorId!: string;
  @Prop({ default: 0 }) principalAmount!: number;
  @Prop({ default: '' }) disbursedDate!: string;
  @Prop({ required: true }) reason!: string;
}

@Schema({ timestamps: true, collection: 'loan_records_import_batches' })
export class LoanRecordsImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, default: 0 }) totalRows!: number;
  @Prop({ required: true, default: 0 }) matchedRows!: number;
  @Prop({ required: true, default: 0 }) flaggedRows!: number;
  @Prop({ type: [LoanRecordFlaggedEntry], default: [] }) flaggedEntries!: LoanRecordFlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const LoanRecordsImportBatchSchema = SchemaFactory.createForClass(LoanRecordsImportBatch);
LoanRecordsImportBatchSchema.index({ status: 1 });
LoanRecordsImportBatchSchema.index({ createdAt: -1 });
