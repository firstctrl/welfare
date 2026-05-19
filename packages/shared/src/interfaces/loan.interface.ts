import { LoanStatus } from '../enums/loan-status.enum';

export interface ILoan {
  _id: string;
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  tenureMonths: number;
  interestRate: number;
  totalRepayable: number;
  monthlyInstalment: number;
  disbursedDate: string;
  status: LoanStatus;
  documentKey?: string;
  exitDeductionAmount?: number;
  guarantorOffsetAmount?: number;
  badDebtAmount?: number;
  settledAt?: string;
  notes?: string;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}
