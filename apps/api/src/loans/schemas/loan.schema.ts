import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LoanStatus } from '@welfare/shared';

export type LoanDocument = HydratedDocument<Loan>;

@Schema({ timestamps: true, collection: 'loans' })
export class Loan {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) guarantorId!: string;
  @Prop({ required: true, min: 0 }) principalAmount!: number;
  @Prop({ required: true, min: 0 }) interestRate!: number;
  @Prop({ required: true, min: 0 }) totalRepayable!: number;
  @Prop({ required: true, min: 0 }) monthlyInstalment!: number;
  @Prop({ required: true, min: 1 }) tenureMonths!: number;
  @Prop({ required: true }) disbursedDate!: Date;
  @Prop({ required: true, enum: LoanStatus, default: LoanStatus.Active }) status!: LoanStatus;
  @Prop() documentKey?: string;
  @Prop({ min: 0, default: 0 }) exitDeductionAmount?: number;
  @Prop({ min: 0, default: 0 }) guarantorOffsetAmount?: number;
  @Prop({ min: 0, default: 0 }) badDebtAmount?: number;
  @Prop() settledAt?: Date;
  @Prop() notes?: string;
  @Prop({ required: true }) recordedBy!: string;
}

export const LoanSchema = SchemaFactory.createForClass(Loan);
LoanSchema.index({ staffId: 1, status: 1 });
LoanSchema.index({ guarantorId: 1 });
LoanSchema.index({ status: 1 });
