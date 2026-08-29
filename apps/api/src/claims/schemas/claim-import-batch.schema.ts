import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type ClaimImportBatchDocument = HydratedDocument<ClaimImportBatch>;

@Schema({ _id: false })
class ClaimFlaggedEntry {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) employeeName!: string;
  @Prop({ required: true }) amount!: number;
  @Prop({ required: true }) reason!: string;
  // Carried so a resolved entry can be recreated as a real Claim (unlike contributions'
  // FlaggedEntry, a Claim needs claimType/month/year/subReason beyond staffId+amount).
  @Prop() claimType?: string;
  @Prop() month?: number;
  @Prop() year?: number;
  @Prop() subReason?: string;
}

@Schema({ timestamps: true, collection: 'claim_import_batches' })
export class ClaimImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, min: 0 }) totalRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) matchedRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) flaggedRows!: number;
  @Prop({ type: [ClaimFlaggedEntry], default: [] }) flaggedEntries!: ClaimFlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const ClaimImportBatchSchema = SchemaFactory.createForClass(ClaimImportBatch);
ClaimImportBatchSchema.index({ status: 1 });
