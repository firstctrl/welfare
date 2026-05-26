import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RemittanceDocument = HydratedDocument<Remittance>;

@Schema({ timestamps: true, collection: 'remittances' })
export class Remittance {
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0 }) grossAmount!: number;
  @Prop({ required: true, min: 0 }) chargeRate!: number;
  @Prop({ required: true, min: 0 }) charges!: number;
  @Prop({ required: true, min: 0 }) netPayable!: number;
  @Prop({ required: true }) receiptDate!: Date;
  @Prop({ required: true }) recordedBy!: string;
  @Prop() importBatchId?: string;
}

export const RemittanceSchema = SchemaFactory.createForClass(Remittance);
RemittanceSchema.index({ month: 1, year: 1 }, { unique: true });
