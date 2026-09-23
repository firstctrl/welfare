import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LoanRepaymentStatus, PaymentEntryType, RepaymentSource } from '@welfare/shared';

export type LoanRepaymentDocument = HydratedDocument<LoanRepayment>;

@Schema({ _id: false })
export class PaymentEntry {
  @Prop({ required: true }) amount!: number;
  @Prop({ required: true }) paidDate!: Date;
  @Prop({ required: true, default: () => new Date() }) recordedAt!: Date;
  @Prop({ required: true }) recordedById!: string;
  @Prop({ required: true }) recordedByName!: string;
  @Prop({ required: true, enum: RepaymentSource }) source!: RepaymentSource;
  @Prop() notes?: string;
  @Prop({ required: true, enum: PaymentEntryType, default: PaymentEntryType.Payment })
  type!: PaymentEntryType;
}

export const PaymentEntrySchema = SchemaFactory.createForClass(PaymentEntry);

@Schema({ timestamps: true, collection: 'loan_repayments' })
export class LoanRepayment {
  @Prop({ required: true }) loanId!: string;
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, min: 1 }) instalmentNumber!: number;
  @Prop({ required: true }) dueDate!: Date;
  @Prop({ required: true, min: 0 }) dueAmount!: number;
  @Prop({ min: 0 }) principalAmount?: number;
  @Prop({ min: 0 }) interestAmount?: number;
  @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) penaltyAmount!: number;
  @Prop({ required: true, enum: LoanRepaymentStatus, default: LoanRepaymentStatus.Pending })
  status!: LoanRepaymentStatus;
  @Prop() paidDate?: Date;
  @Prop({ enum: RepaymentSource }) source?: RepaymentSource;
  @Prop() guarantorStaffId?: string;
  @Prop() notes?: string;
  @Prop({ type: [PaymentEntrySchema], default: [] }) payments!: PaymentEntry[];
}

export const LoanRepaymentSchema = SchemaFactory.createForClass(LoanRepayment);
LoanRepaymentSchema.index({ loanId: 1, instalmentNumber: 1 }, { unique: true });
LoanRepaymentSchema.index({ loanId: 1, status: 1 });
LoanRepaymentSchema.index({ staffId: 1 });
LoanRepaymentSchema.index({ dueDate: 1, status: 1 });
