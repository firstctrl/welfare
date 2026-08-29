import { apiClient } from './api-client';
import type { IClaim, IClaimImportBatch, PaginatedResult, ClaimType, ClaimStatus, CessationReason } from '@welfare/shared';

export interface ClaimFilters {
  staffId?: string;
  claimType?: ClaimType;
  status?: ClaimStatus;
  year?: number;
  page?: number;
  limit?: number;
}

export interface ImportResult {
  batchId: string;
  matched: number;
  flagged: number;
  total: number;
}

export async function listClaims(filters: ClaimFilters = {}): Promise<PaginatedResult<IClaim>> {
  const { data } = await apiClient.get('/claims', { params: filters });
  return data;
}

export async function getClaimsByStaff(staffId: string): Promise<IClaim[]> {
  const { data } = await apiClient.get(`/claims/staff/${staffId}`);
  return data;
}

export async function getStaffClaimBalance(staffId: string): Promise<{ balance: number }> {
  const { data } = await apiClient.get(`/claims/staff/${staffId}/balance`);
  return data;
}

export async function createClaim(payload: {
  staffId: string;
  claimType: ClaimType;
  subReason?: CessationReason;
  month: number;
  year: number;
  amount: number;
}): Promise<IClaim> {
  const { data } = await apiClient.post('/claims', payload);
  return data;
}

export async function approveClaim(id: string): Promise<IClaim> {
  const { data } = await apiClient.patch(`/claims/${id}/approve`);
  return data;
}

export async function rejectClaim(id: string, reason: string): Promise<IClaim> {
  const { data } = await apiClient.patch(`/claims/${id}/reject`, { reason });
  return data;
}

export async function deleteClaim(id: string): Promise<void> {
  await apiClient.delete(`/claims/${id}`);
}

export async function importClaims(file: File, jobId?: string): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/claims/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listClaimImportBatches(page = 1, limit = 20): Promise<PaginatedResult<IClaimImportBatch>> {
  const { data } = await apiClient.get('/claims/import', { params: { page, limit } });
  return data;
}

export async function getClaimImportBatch(batchId: string): Promise<IClaimImportBatch> {
  const { data } = await apiClient.get(`/claims/import/${batchId}`);
  return data;
}

export async function resolveClaimFlaggedEntry(
  batchId: string, originalStaffId: string, resolvedStaffMongoId: string,
): Promise<IClaimImportBatch> {
  const { data } = await apiClient.patch(`/claims/import/${batchId}/resolve`, { originalStaffId, resolvedStaffMongoId });
  return data;
}

export async function resolveClaimsByStaffId(
  originalStaffId: string, resolvedStaffMongoId: string,
): Promise<{ resolvedCount: number; batchesUpdated: number }> {
  const { data } = await apiClient.patch('/claims/import/resolve-by-staff-id', { originalStaffId, resolvedStaffMongoId });
  return data;
}

export async function dismissClaimFlaggedEntry(batchId: string, index: number): Promise<IClaimImportBatch> {
  const { data } = await apiClient.patch(`/claims/import/${batchId}/dismiss`, { index });
  return data;
}

export async function clearClaimFlaggedEntries(batchId: string): Promise<IClaimImportBatch> {
  const { data } = await apiClient.patch(`/claims/import/${batchId}/clear-flagged`);
  return data;
}
