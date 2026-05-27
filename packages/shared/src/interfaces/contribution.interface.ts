import { ContributionStatus } from '../enums/contribution-status.enum';
import { ContributionSource } from '../enums/contribution-source.enum';

export interface IContribution {
  _id: string;
  staffId: string;
  month: number;
  year: number;
  expectedAmount: number;
  paidAmount: number;
  surplusCarriedForward: number;
  status: ContributionStatus;
  source: ContributionSource;
  isDebit?: boolean;
  loanId?: string;
  borrowerStaffId?: string;
  instalmentNumber?: number;
  importBatchId?: string;
  recordedBy: string;
  createdAt: string;
}
