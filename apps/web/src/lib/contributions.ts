import { apiClient } from './api-client';
import type { IContribution, IImportBatch, PaginatedResult } from '@welfare/shared';

export interface ContributionFilters {
  staffId?: string;
  month?: number;
  year?: number;
  status?: string;
  page?: number;
  limit?: number;
}

export interface ContributionSummary {
  totalExpected: number;
  totalPaid: number;
  totalSurplus: number;
  countPaid: number;
  countPartial: number;
  countMissed: number;
}

export interface ImportResult {
  batchId: string;
  matched: number;
  flagged: number;
  total: number;
}

export async function listContributions(
  filters: ContributionFilters = {},
): Promise<PaginatedResult<IContribution>> {
  const { data } = await apiClient.get('/contributions', { params: filters });
  return data;
}

export async function getContributionsByStaff(staffId: string): Promise<IContribution[]> {
  const { data } = await apiClient.get(`/contributions/staff/${staffId}`);
  return data;
}

export async function getContributionSummary(
  month: number,
  year: number,
): Promise<ContributionSummary> {
  const { data } = await apiClient.get('/contributions/summary', { params: { month, year } });
  return data;
}

export async function importContributions(
  file: File,
  month?: number,
  year?: number,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (month) form.append('month', String(month));
  if (year) form.append('year', String(year));
  const { data } = await apiClient.post('/contributions/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listImportBatches(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<IImportBatch>> {
  const { data } = await apiClient.get('/contributions/import', { params: { page, limit } });
  return data;
}

export async function getImportBatch(batchId: string): Promise<IImportBatch> {
  const { data } = await apiClient.get(`/contributions/import/${batchId}`);
  return data;
}

export async function resolveFlaggedEntry(
  batchId: string,
  originalStaffId: string,
  resolvedStaffMongoId: string,
): Promise<IImportBatch> {
  const { data } = await apiClient.patch(`/contributions/import/${batchId}/resolve`, {
    originalStaffId,
    resolvedStaffMongoId,
  });
  return data;
}

export async function manualContribution(payload: {
  staffId: string;
  amount: number;
  month: number;
  year: number;
  note?: string;
}): Promise<IContribution[]> {
  const { data } = await apiClient.post('/contributions/manual', payload);
  return data;
}
