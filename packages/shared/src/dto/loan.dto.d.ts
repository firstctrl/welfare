import { LoanStatus } from '../enums/loan-status.enum';
export interface CreateLoanDto {
    staffId: string;
    guarantorId: string;
    principalAmount: number;
    tenureMonths: number;
    interestRate: 10 | 15;
    disbursedDate: string;
    approvalDocumentKey?: string;
}
export interface UpdateLoanDto {
    status?: LoanStatus;
    exitDeductionAmount?: number;
    guarantorOffsetAmount?: number;
    badDebtAmount?: number;
    settledAt?: string;
    approvalDocumentKey?: string;
}
export interface LoanResponseDto {
    _id: string;
    staffId: string;
    guarantorId: string;
    principalAmount: number;
    tenureMonths: number;
    interestRate: 10 | 15;
    totalRepayable: number;
    monthlyInstalment: number;
    disbursedDate: string;
    status: LoanStatus;
    exitDeductionAmount?: number;
    guarantorOffsetAmount?: number;
    badDebtAmount?: number;
    settledAt?: string;
    approvalDocumentKey?: string;
    recordedBy: string;
    createdAt: string;
    updatedAt: string;
}
//# sourceMappingURL=loan.dto.d.ts.map