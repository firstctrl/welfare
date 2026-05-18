import { ImportBatchStatus } from '../enums/import-batch-status.enum';
export interface FlaggedEntryDto {
    staffId: string;
    employeeName: string;
    amount: number;
    reason: string;
}
export interface ImportBatchResponseDto {
    _id: string;
    month: number;
    year: number;
    fileName: string;
    uploadedBy: string;
    totalRows: number;
    matchedRows: number;
    flaggedRows: number;
    flaggedEntries: FlaggedEntryDto[];
    status: ImportBatchStatus;
    createdAt: string;
}
//# sourceMappingURL=import-batch.dto.d.ts.map