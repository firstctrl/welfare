import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface ILoanLegacyFlaggedEntry {
  loanRef: string;
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  disbursedDate: string;
  reason: string;
}

export interface ILoanLegacyImportBatch {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: ILoanLegacyFlaggedEntry[];
  status: ImportBatchStatus;
  createdAt: string;
}
