import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface IFlaggedEntry {
  staffId: string;
  employeeName: string;
  amount: number;
  reason: string;
}

export interface IImportBatch {
  _id: string;
  month: number;
  year: number;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: IFlaggedEntry[];
  status: ImportBatchStatus;
  createdAt: string;
}
