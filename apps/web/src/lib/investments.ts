import { apiClient } from './api-client';
import type { IInvestmentRow } from '@welfare/shared';

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

export async function importInvestments(file: File): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/investments/import', form);
  return data;
}
