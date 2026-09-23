import { LoanRepaymentStatus } from '../enums/loan-repayment-status.enum';
import { RepaymentSource } from '../enums/repayment-source.enum';
import { PaymentEntryType } from '../enums/payment-entry-type.enum';

export interface IPaymentEntry {
  amount: number;
  paidDate: string;
  recordedAt: string;
  recordedById: string;
  recordedByName: string;
  source: RepaymentSource;
  notes?: string;
  type: PaymentEntryType;
}

export interface ILoanRepayment {
  _id: string;
  loanId: string;
  staffId: string;
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  principalAmount?: number;
  interestAmount?: number;
  paidAmount: number;
  penaltyAmount: number;
  status: LoanRepaymentStatus;
  paidDate?: string;
  source?: RepaymentSource;
  guarantorStaffId?: string;
  notes?: string;
  payments?: IPaymentEntry[];
  createdAt: string;
  updatedAt: string;
}
