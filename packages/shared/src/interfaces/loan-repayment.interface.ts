import { LoanRepaymentStatus } from '../enums/loan-repayment-status.enum';
import { RepaymentSource } from '../enums/repayment-source.enum';

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
  createdAt: string;
  updatedAt: string;
}
