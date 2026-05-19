import { ContributionStatus } from '../enums/contribution-status.enum';
import { LoanRepaymentStatus } from '../enums/loan-repayment-status.enum';
import { LoanStatus } from '../enums/loan-status.enum';
import { StaffStatus } from '../enums/staff-status.enum';

export interface IMonthlyContributionRow {
  staffId: string;
  staffName: string;
  staffNo: string;
  expectedAmount: number;
  paidAmount: number;
  surplusCarriedForward: number;
  status: ContributionStatus;
}

export interface IMonthlyContributionReport {
  month: number;
  year: number;
  rows: IMonthlyContributionRow[];
  totalExpected: number;
  totalPaid: number;
  totalSurplus: number;
}

export interface IArrearRow {
  staffId: string;
  staffName: string;
  staffNo: string;
  month: number;
  year: number;
  expectedAmount: number;
  paidAmount: number;
  shortfall: number;
  status: ContributionStatus;
}

export interface IGuarantorOffsetRow {
  guarantorStaffId: string;
  guarantorName: string;
  borrowerStaffId: string;
  borrowerName: string;
  loanId: string;
  instalmentNumber: number;
  offsetAmount: number;
  offsetDate: string;
}

export interface IActiveLoanRow {
  loanId: string;
  staffId: string;
  staffName: string;
  staffNo: string;
  guarantorId: string;
  guarantorName: string;
  principalAmount: number;
  outstandingBalance: number;
  nextDueDate: string | null;
  nextDueAmount: number | null;
  disbursedDate: string;
}

export interface IOverdueLoanRow {
  loanId: string;
  staffId: string;
  staffName: string;
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  penaltyAmount: number;
  daysOverdue: number;
  status: LoanRepaymentStatus;
}

export interface IRepaidLoanRow {
  loanId: string;
  staffId: string;
  staffName: string;
  principalAmount: number;
  totalRepayable: number;
  settledAt: string;
  disbursedDate: string;
  tenureMonths: number;
}

export interface IGuarantorExposureRow {
  guarantorId: string;
  guarantorName: string;
  guarantorStaffNo: string;
  totalOutstanding: number;
  activeLoansCount: number;
  totalOffsetAmount: number;
  offsetHistory: Array<{
    loanId: string;
    borrowerName: string;
    offsetAmount: number;
    offsetDate: string;
  }>;
}

export interface IBadDebtRow {
  loanId: string;
  staffId: string;
  staffName: string;
  principalAmount: number;
  totalRepayable: number;
  exitDeductionAmount: number;
  guarantorOffsetAmount: number;
  badDebtAmount: number;
  settledAt: string;
}

export interface IExitClearanceRow {
  staffId: string;
  staffName: string;
  staffNo: string;
  status: StaffStatus;
  outstandingLoanBalance: number;
  missedContributionsCount: number;
  activeLoanIds: string[];
}

export interface IDashboardStats {
  thisMonth: {
    year: number;
    month: number;
    collected: number;
    expected: number;
    collectionRate: number;
  };
  loans: {
    activeCount: number;
    totalOutstanding: number;
  };
  overdueInstalments: number;
  membersInArrears: number;
  monthlyTrend: Array<{
    year: number;
    month: number;
    label: string;
    collected: number;
    expected: number;
  }>;
  loanStatusDistribution: Array<{
    status: LoanStatus;
    count: number;
  }>;
  upcomingPayments: Array<{
    loanId: string;
    staffName: string;
    dueDate: string;
    dueAmount: number;
    instalmentNumber: number;
  }>;
  recentFlaggedBatches: Array<{
    batchId: string;
    month: number;
    year: number;
    flaggedRows: number;
    fileName: string;
    uploadedAt: string;
  }>;
}
