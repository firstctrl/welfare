import { apiClient } from './api-client';
import type { ILoan, ILoanRepayment, ILoanRepaymentImportBatch, ILoanRecordsImportBatch, PaginatedResult, LoanStatus } from '@welfare/shared';

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

export interface LoanImportResult {
  batchId: string;
  matched: number;
  flagged: number;
  total: number;
}

export async function importLoanRepayments(file: File): Promise<LoanImportResult> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/loans/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listLoanImportBatches(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<ILoanRepaymentImportBatch>> {
  const { data } = await apiClient.get('/loans/import', { params: { page, limit } });
  return data;
}

export async function getLoanImportBatch(batchId: string): Promise<ILoanRepaymentImportBatch> {
  const { data } = await apiClient.get(`/loans/import/${batchId}`);
  return data;
}

export async function resolveLoanFlaggedEntry(
  batchId: string,
  rowNumber: number,
  resolvedLoanId: string,
): Promise<ILoanRepaymentImportBatch> {
  const { data } = await apiClient.patch(`/loans/import/${batchId}/resolve`, { rowNumber, resolvedLoanId });
  return data;
}

export interface LoanRecordsImportResult {
  batchId: string;
  created: number;
  flagged: number;
  total: number;
}

export async function importLoanRecords(file: File): Promise<LoanRecordsImportResult> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/loans/records-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listLoanRecordsImportBatches(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<ILoanRecordsImportBatch>> {
  const { data } = await apiClient.get('/loans/records-import', { params: { page, limit } });
  return data;
}

export async function getLoanRecordsImportBatch(batchId: string): Promise<ILoanRecordsImportBatch> {
  const { data } = await apiClient.get(`/loans/records-import/${batchId}`);
  return data;
}

export async function deleteLoan(id: string): Promise<void> {
  await apiClient.delete(`/loans/${id}`);
}

export async function writeOffLoan(id: string): Promise<ILoan> {
  const { data } = await apiClient.patch(`/loans/${id}/write-off`);
  return data;
}

export async function deleteRepayment(loanId: string, repaymentId: string): Promise<void> {
  await apiClient.delete(`/loans/${loanId}/repayments/${repaymentId}`);
}

export async function getLoansByGuarantor(
  staffId: string,
  page = 1,
  limit = 50,
): Promise<PaginatedResult<ILoan>> {
  const { data } = await apiClient.get(`/loans/guarantor/${staffId}`, { params: { page, limit } });
  return data;
}
