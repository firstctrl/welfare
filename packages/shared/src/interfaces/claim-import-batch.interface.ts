import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface IClaimFlaggedEntry {
  staffId: string;
  employeeName: string;
  amount: number;
  reason: string;
  claimType?: string;
  month?: number;
  year?: number;
  subReason?: string;
}

export interface IClaimImportBatch {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: IClaimFlaggedEntry[];
  status: ImportBatchStatus;
  createdAt: string;
}
