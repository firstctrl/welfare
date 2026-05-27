import { apiClient } from './api-client';
import type {
  IMonthlyContributionReport,
  IArrearRow,
  IGuarantorOffsetRow,
  IActiveLoanRow,
  IOverdueLoanRow,
  IRepaidLoanRow,
  IGuarantorExposureRow,
  IBadDebtRow,
  IExitClearanceRow,
  IDashboardStats,
  ILoanBorrower,
  ILoanStatement,
  IFundSummaryReport,
} from '@welfare/shared';

export interface MonthlyContribParams {
  month?: number;
  year?: number;
}

export interface ArrearsParams {
  fromMonth?: number;
  fromYear?: number;
  toMonth?: number;
  toYear?: number;
}

export async function getDashboardStats(): Promise<IDashboardStats> {
  const { data } = await apiClient.get('/reports/dashboard');
  return data;
}

export async function getMonthlyContributions(
  params: MonthlyContribParams = {},
): Promise<IMonthlyContributionReport> {
  const { data } = await apiClient.get('/reports/contributions/monthly', { params });
  return data;
}

export async function getArrears(params: ArrearsParams = {}): Promise<IArrearRow[]> {
  const { data } = await apiClient.get('/reports/contributions/arrears', { params });
  return data;
}

export async function getGuarantorOffsets(): Promise<IGuarantorOffsetRow[]> {
  const { data } = await apiClient.get('/reports/contributions/guarantor-offsets');
  return data;
}

export async function getActiveLoans(): Promise<IActiveLoanRow[]> {
  const { data } = await apiClient.get('/reports/loans/active');
  return data;
}

export async function getOverdueLoans(): Promise<IOverdueLoanRow[]> {
  const { data } = await apiClient.get('/reports/loans/overdue');
  return data;
}

export async function getRepaidLoans(): Promise<IRepaidLoanRow[]> {
  const { data } = await apiClient.get('/reports/loans/repaid');
  return data;
}

export async function getGuarantorExposure(): Promise<IGuarantorExposureRow[]> {
  const { data } = await apiClient.get('/reports/loans/guarantor-exposure');
  return data;
}

export async function getBadDebt(): Promise<IBadDebtRow[]> {
  const { data } = await apiClient.get('/reports/loans/bad-debt');
  return data;
}

export async function getExitClearance(): Promise<IExitClearanceRow[]> {
  const { data } = await apiClient.get('/reports/staff/exit');
  return data;
}

export interface StaffStatementCell {
  paidAmount: number;
  expectedAmount: number;
  status: string;
}

export interface StaffStatementOffsetItem {
  kind?: 'Guarantor' | 'Defaulter';
  borrowerName: string;
  borrowerStaffNo: string;
  loanId: string;
  amount: number;
}

export interface StaffStatementOffsetCell {
  totalAmount: number;
  items: StaffStatementOffsetItem[];
}

export interface StaffStatementRow {
  year: number;
  cells: Record<number, StaffStatementCell | null>;
  offsetCells?: Record<number, StaffStatementOffsetCell | null>;
  yearTotal: number;
  yearOffsetTotal?: number;
}

export interface StaffStatement {
  staff: { _id: string; fullName: string; staffId: string; email?: string };
  kpis: { totalPaid: number; totalExpected: number; missedMonths: number; totalSurplus: number; collectionRate: number; totalOffsets?: number };
  years: number[];
  rows: StaffStatementRow[];
}

export async function getStaffStatement(staffMongoId: string): Promise<StaffStatement> {
  const { data } = await apiClient.get('/reports/contributions/staff-statement', { params: { staffId: staffMongoId } });
  return data;
}

export async function sendStaffStatement(staffMongoId: string): Promise<{ sent: boolean; email: string }> {
  const { data } = await apiClient.post('/reports/contributions/staff-statement/send', { staffId: staffMongoId });
  return data;
}

export async function downloadStatementPdf(staffMongoId: string, staffNo: string): Promise<void> {
  const { data } = await apiClient.get('/reports/contributions/staff-statement/pdf', {
    params: { staffId: staffMongoId },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `statement-${staffNo}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadStaffRecordPdf(staffMongoId: string, staffNo: string): Promise<void> {
  const { data } = await apiClient.get('/reports/staff-record/pdf', {
    params: { staffId: staffMongoId },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `staff-record-${staffNo}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface BulkSendParams {
  year: number;
  sendTo: 'all' | 'selected';
  staffIds?: string[];
}

export interface BulkSendJob {
  jobId: string;
  queued: number;
}

export interface BulkSendStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  progress: number;
  queued: number;
  result: { sent: number; failed: number; total: number } | null;
  failedReason: string | null;
  createdAt: string;
}

export async function triggerBulkSend(params: BulkSendParams): Promise<BulkSendJob> {
  const { data } = await apiClient.post('/reports/contributions/bulk-send', params);
  return data;
}

export async function getBulkSendStatus(jobId: string): Promise<BulkSendStatus> {
  const { data } = await apiClient.get('/reports/contributions/bulk-send/status', { params: { jobId } });
  return data;
}

export function buildDownloadUrl(path: string, format: 'csv' | 'pdf'): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  return `${base}/reports/${path}?format=${format}`;
}

export async function getLoanBorrowers(): Promise<ILoanBorrower[]> {
  const { data } = await apiClient.get('/reports/loans/borrowers');
  return data;
}

export async function getLoanStatement(staffId: string, loanId: string): Promise<ILoanStatement> {
  const { data } = await apiClient.get('/reports/loans/staff-statement', {
    params: { staffId, loanId },
  });
  return data;
}

export async function downloadLoanStatementPdf(
  staffId: string,
  loanId: string,
  staffNo: string,
): Promise<void> {
  const { data } = await apiClient.get('/reports/loans/staff-statement/pdf', {
    params: { staffId, loanId },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `loan-statement-${staffNo}-${loanId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function sendLoanStatement(
  staffId: string,
  loanId: string,
): Promise<{ sent: boolean; email: string }> {
  const { data } = await apiClient.post('/reports/loans/staff-statement/send', { staffId, loanId });
  return data;
}

export interface FundSummaryParams {
  year: number;
  fromMonth?: number;
  toMonth?: number;
  quarter?: 1 | 2 | 3 | 4;
}

export async function getFundSummary(params: FundSummaryParams): Promise<IFundSummaryReport> {
  const { data } = await apiClient.get('/reports/fund-summary', { params });
  return data;
}

export async function downloadFundSummaryFile(
  sub: 'contributions' | 'loans' | 'defaults',
  params: FundSummaryParams,
  format: 'csv' | 'pdf',
): Promise<void> {
  const { data, headers } = await apiClient.get(`/reports/fund-summary/${sub}`, {
    params: { year: params.year, ...(params.fromMonth ? { fromMonth: params.fromMonth } : {}), ...(params.toMonth ? { toMonth: params.toMonth } : {}), ...(params.quarter ? { quarter: params.quarter } : {}), format },
    responseType: 'blob',
  });
  const mime = String(headers['content-type'] ?? (format === 'pdf' ? 'application/pdf' : 'text/csv'));
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fund-summary-${sub}-${params.year}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
