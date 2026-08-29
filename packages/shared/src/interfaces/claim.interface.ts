import { ClaimType } from '../enums/claim-type.enum';
import { CessationReason } from '../enums/cessation-reason.enum';
import { ClaimStatus } from '../enums/claim-status.enum';
import { ClaimSource } from '../enums/claim-source.enum';

export interface IClaim {
  _id: string;
  staffId: string;
  claimType: ClaimType;
  subReason?: CessationReason;
  month: number;
  year: number;
  amount: number;
  status: ClaimStatus;
  source: ClaimSource;
  importBatchId?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  recordedBy: string;
  createdAt: string;
}
