import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface IStaffFlaggedEntry {
  rowNumber: number;
  staffId: string;
  fullName: string;
  reason: string;
}

export interface IStaffImportBatch {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: IStaffFlaggedEntry[];
  status: ImportBatchStatus;
  createdAt: string;
}
