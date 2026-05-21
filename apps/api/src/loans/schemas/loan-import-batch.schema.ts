import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type LoanImportBatchDocument = HydratedDocument<LoanImportBatch>;

@Schema({ _id: false })
class LoanRepaymentFlaggedEntry {
  @Prop({ required: true }) rowNumber!: number;
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) staffName!: string;
  @Prop({ required: true }) loanId!: string;
  @Prop({ required: true }) amount!: number;
  @Prop({ required: true }) paidDate!: string;
  @Prop() notes?: string;
  @Prop({ required: true }) reason!: string;
}

@Schema({ timestamps: true, collection: 'loan_import_batches' })
export class LoanImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, min: 0 }) totalRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) matchedRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) flaggedRows!: number;
  @Prop({ type: [LoanRepaymentFlaggedEntry], default: [] }) flaggedEntries!: LoanRepaymentFlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const LoanImportBatchSchema = SchemaFactory.createForClass(LoanImportBatch);
LoanImportBatchSchema.index({ status: 1 });
LoanImportBatchSchema.index({ createdAt: -1 });
