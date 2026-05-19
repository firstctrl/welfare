import { apiClient } from './api-client';
import type { ILoan, ILoanRepayment, PaginatedResult, LoanStatus } from '@welfare/shared';

export interface LoanFilters {
  staffId?: string;
  status?: LoanStatus;
  page?: number;
  limit?: number;
}

export interface CreateLoanPayload {
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  tenureMonths: number;
  disbursedDate: string;
}

export interface RecordPaymentPayload {
  amount: number;
  paidDate: string;
  notes?: string;
}

export interface ExitSettlementPayload {
  exitDeductionAmount: number;
  notes?: string;
}

export async function listLoans(filters: LoanFilters = {}): Promise<PaginatedResult<ILoan>> {
  const { data } = await apiClient.get('/loans', { params: filters });
  return data;
}

export async function getLoan(id: string): Promise<ILoan> {
  const { data } = await apiClient.get(`/loans/${id}`);
  return data;
}

export async function getLoanSchedule(id: string): Promise<ILoanRepayment[]> {
  const { data } = await apiClient.get(`/loans/${id}/schedule`);
  return data;
}

export async function getLoanDocumentUrl(id: string): Promise<string> {
  const { data } = await apiClient.get(`/loans/${id}/document`);
  return data;
}

export async function createLoan(payload: CreateLoanPayload): Promise<ILoan> {
  const { data } = await apiClient.post('/loans', payload);
  return data;
}

export async function uploadLoanDocument(loanId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await apiClient.post(`/loans/${loanId}/document`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function recordPayment(id: string, payload: RecordPaymentPayload): Promise<ILoan> {
  const { data } = await apiClient.post(`/loans/${id}/repayments`, payload);
  return data;
}

export async function exitSettle(id: string, payload: ExitSettlementPayload): Promise<ILoan> {
  const { data } = await apiClient.post(`/loans/${id}/settle-exit`, payload);
  return data;
}

export async function getLoansByStaff(
  staffId: string,
  page = 1,
  limit = 50,
): Promise<PaginatedResult<ILoan>> {
  const { data } = await apiClient.get(`/staff/${staffId}/loans`, { params: { page, limit } });
  return data;
}

export async function getLoansByGuarantor(
  staffId: string,
  page = 1,
  limit = 50,
): Promise<PaginatedResult<ILoan>> {
  const { data } = await apiClient.get(`/loans/guarantor/${staffId}`, { params: { page, limit } });
  return data;
}
