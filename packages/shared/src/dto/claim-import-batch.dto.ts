import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface ClaimFlaggedEntryDto {
  staffId: string;
  employeeName: string;
  amount: number;
  reason: string;
  claimType?: string;
  month?: number;
  year?: number;
  subReason?: string;
}

export interface ClaimImportBatchResponseDto {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: ClaimFlaggedEntryDto[];
  status: ImportBatchStatus;
  createdAt: string;
}
