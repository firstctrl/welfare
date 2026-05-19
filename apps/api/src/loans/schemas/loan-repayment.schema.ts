import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LoanRepaymentStatus, RepaymentSource } from '@welfare/shared';

export type LoanRepaymentDocument = HydratedDocument<LoanRepayment>;

@Schema({ timestamps: true, collection: 'loan_repayments' })
export class LoanRepayment {
  @Prop({ required: true }) loanId!: string;
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, min: 1 }) instalmentNumber!: number;
  @Prop({ required: true }) dueDate!: Date;
  @Prop({ required: true, min: 0 }) dueAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) penaltyAmount!: number;
  @Prop({ required: true, enum: LoanRepaymentStatus, default: LoanRepaymentStatus.Pending })
  status!: LoanRepaymentStatus;
  @Prop() paidDate?: Date;
  @Prop({ enum: Object.values(RepaymentSource) }) source?: RepaymentSource;
  @Prop() guarantorStaffId?: string;
  @Prop() notes?: string;
}

export const LoanRepaymentSchema = SchemaFactory.createForClass(LoanRepayment);
LoanRepaymentSchema.index({ loanId: 1, instalmentNumber: 1 }, { unique: true });
LoanRepaymentSchema.index({ loanId: 1, status: 1 });
LoanRepaymentSchema.index({ staffId: 1 });
LoanRepaymentSchema.index({ dueDate: 1, status: 1 });
