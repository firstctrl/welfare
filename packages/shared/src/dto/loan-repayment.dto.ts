import { LoanRepaymentStatus } from '../enums/loan-repayment-status.enum';

export interface RecordPaymentDto {
  loanId: string;
  staffId: string;
  instalmentNumber: number;
  paidAmount: number;
  paidDate: string;
  surplusApplied?: number;
  penaltyApplied?: number;
}

export interface LoanRepaymentResponseDto {
  _id: string;
  loanId: string;
  staffId: string;
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  paidDate?: string;
  surplusApplied: number;
  penaltyApplied: number;
  status: LoanRepaymentStatus;
  recordedBy: string;
  createdAt: string;
}
