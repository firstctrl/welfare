export interface IInvestmentFlaggedRow {
  rowNumber: number;
  description: string;
  flagReason: string;
}

export interface IInvestmentImportBatch {
  _id: string;
  fileName: string;
  recordedBy: string;
  total: number;
  imported: number;
  flagged: number;
  flaggedRows: IInvestmentFlaggedRow[];
  createdAt: string;
}
