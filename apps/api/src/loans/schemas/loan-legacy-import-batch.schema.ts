import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type LoanLegacyImportBatchDocument = HydratedDocument<LoanLegacyImportBatch>;

@Schema({ _id: false })
class LoanLegacyFlaggedEntry {
  @Prop({ default: '' }) loanRef!: string;
  @Prop({ default: '' }) staffId!: string;
  @Prop({ default: '' }) guarantorId!: string;
  @Prop({ default: 0 }) principalAmount!: number;
  @Prop({ default: '' }) disbursedDate!: string;
  @Prop({ required: true }) reason!: string;
}

@Schema({ timestamps: true, collection: 'loan_legacy_import_batches' })
export class LoanLegacyImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, default: 0 }) totalRows!: number;
  @Prop({ required: true, default: 0 }) matchedRows!: number;
  @Prop({ required: true, default: 0 }) flaggedRows!: number;
  @Prop({ type: [LoanLegacyFlaggedEntry], default: [] }) flaggedEntries!: LoanLegacyFlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const LoanLegacyImportBatchSchema = SchemaFactory.createForClass(LoanLegacyImportBatch);
LoanLegacyImportBatchSchema.index({ status: 1 });
LoanLegacyImportBatchSchema.index({ createdAt: -1 });
