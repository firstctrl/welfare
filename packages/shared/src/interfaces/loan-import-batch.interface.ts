import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface ILoanRepaymentFlaggedEntry {
  rowNumber: number;
  staffId: string;
  staffName: string;
  loanId: string;
  amount: number;
  paidDate: string;
  notes?: string;
  reason: string;
}

export interface ILoanRepaymentImportBatch {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: ILoanRepaymentFlaggedEntry[];
  status: ImportBatchStatus;
  createdAt: string;
}
