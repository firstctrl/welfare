export interface IRemittanceFlaggedRow {
  rowNumber: number;
  month: number;
  year: number;
  flagReason: string;
}

export interface IRemittanceImportBatch {
  _id: string;
  fileName: string;
  recordedBy: string;
  total: number;
  imported: number;
  flagged: number;
  flaggedRows: IRemittanceFlaggedRow[];
  createdAt: string;
}
