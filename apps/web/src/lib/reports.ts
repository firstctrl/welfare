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

export function buildDownloadUrl(path: string, format: 'csv' | 'pdf'): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  return `${base}/reports/${path}?format=${format}`;
}
