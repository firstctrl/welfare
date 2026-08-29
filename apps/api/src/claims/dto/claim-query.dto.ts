import { ClaimType, ClaimStatus } from '@welfare/shared';

export class ClaimQueryDto {
  staffId?: string;
  claimType?: ClaimType;
  status?: ClaimStatus;
  year?: number;
  page?: number;
  limit?: number;
}
