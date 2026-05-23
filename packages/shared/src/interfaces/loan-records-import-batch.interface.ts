import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface ILoanRecordFlaggedEntry {
  rowNumber: number;
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  disbursedDate: string;
  reason: string;
}

export interface ILoanRecordsImportBatch {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: ILoanRecordFlaggedEntry[];
  status: ImportBatchStatus;
  createdAt: string;
}
