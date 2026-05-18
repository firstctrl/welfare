import { ContributionStatus } from '../enums/contribution-status.enum';
import { ContributionSource } from '../enums/contribution-source.enum';
export interface CreateContributionDto {
    staffId: string;
    month: number;
    year: number;
    expectedAmount: number;
    paidAmount: number;
    surplusCarriedForward?: number;
    status: ContributionStatus;
    source: ContributionSource;
    importBatchId?: string;
}
export interface ContributionResponseDto {
    _id: string;
    staffId: string;
    month: number;
    year: number;
    expectedAmount: number;
    paidAmount: number;
    surplusCarriedForward: number;
    status: ContributionStatus;
    source: ContributionSource;
    importBatchId?: string;
    recordedBy: string;
    createdAt: string;
}
//# sourceMappingURL=contribution.dto.d.ts.map