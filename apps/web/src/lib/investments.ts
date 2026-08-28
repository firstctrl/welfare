import { apiClient } from './api-client';
import type { IInvestmentRow, IInvestmentImportBatch, PaginatedResult } from '@welfare/shared';

export interface PaginatedInvestments {
  data: IInvestmentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateInvestmentPayload {
  purchaseDate: string;
  description: string;
  cost: number;
  maturityDate: string;
  faceValue: number;
  instruction: 'One-Time' | 'Roll-Over';
}

export interface UpdateInvestmentPayload extends Partial<CreateInvestmentPayload> {
  reason: string;
}

export async function listInvestments(page = 1, limit = 20): Promise<PaginatedInvestments> {
  const { data } = await apiClient.get('/investments', { params: { page, limit } });
  return data;
}

export async function createInvestment(payload: CreateInvestmentPayload): Promise<IInvestmentRow> {
  const { data } = await apiClient.post('/investments', payload);
  return data;
}

export async function updateInvestment(id: string, payload: UpdateInvestmentPayload): Promise<IInvestmentRow> {
  const { data } = await apiClient.patch(`/investments/${id}`, payload);
  return data;
}

export async function deleteInvestment(id: string, reason: string): Promise<void> {
  await apiClient.delete(`/investments/${id}`, { data: { reason } });
}

export async function importInvestments(
  file: File,
  jobId?: string,
): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/investments/import', form);
  return data;
}

export async function listInvestmentImportBatches(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<IInvestmentImportBatch>> {
  const { data } = await apiClient.get('/investments/import', { params: { page, limit } });
  return data;
}

export async function getInvestmentImportBatch(batchId: string): Promise<IInvestmentImportBatch> {
  const { data } = await apiClient.get(`/investments/import/${batchId}`);
  return data;
}

export async function dismissInvestmentFlaggedEntry(batchId: string, index: number): Promise<IInvestmentImportBatch> {
  const { data } = await apiClient.patch(`/investments/import/${batchId}/dismiss`, { index });
  return data;
}

export async function clearInvestmentFlaggedEntries(batchId: string): Promise<IInvestmentImportBatch> {
  const { data } = await apiClient.patch(`/investments/import/${batchId}/clear-flagged`);
  return data;
}
