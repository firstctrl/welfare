import { apiClient } from './api-client';
import type { IRemittanceReport } from '@welfare/shared';

export interface RemittanceRecord {
  _id: string;
  month: number;
  year: number;
  grossAmount: number;
  chargeRate: number;
  charges: number;
  netPayable: number;
  receiptDate: string;
  recordedBy: string;
  createdAt: string;
}

export interface RemittanceGrossPreview {
  grossAmount: number;
  charges: number;
  netPayable: number;
}

export interface PaginatedRemittances {
  data: RemittanceRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RemittanceReportParams {
  fromMonth?: number;
  fromYear?: number;
  toMonth?: number;
  toYear?: number;
}

export async function getRemittanceGrossPreview(month: number, year: number): Promise<RemittanceGrossPreview> {
  const { data } = await apiClient.get('/remittances/gross', { params: { month, year } });
  return data;
}

export async function listRemittances(page = 1, limit = 20): Promise<PaginatedRemittances> {
  const { data } = await apiClient.get('/remittances', { params: { page, limit } });
  return data;
}

export async function createRemittance(payload: { month: number; year: number; receiptDate: string }): Promise<RemittanceRecord> {
  const { data } = await apiClient.post('/remittances', payload);
  return data;
}

export interface UpdateRemittancePayload {
  month?: number;
  year?: number;
  receiptDate?: string;
  reason: string;
}

export async function updateRemittance(id: string, payload: UpdateRemittancePayload): Promise<RemittanceRecord> {
  const { data } = await apiClient.patch(`/remittances/${id}`, payload);
  return data;
}

export async function deleteRemittance(id: string, reason: string): Promise<void> {
  await apiClient.delete(`/remittances/${id}`, { data: { reason } });
}

export async function importRemittances(file: File): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/remittances/import', form);
  return data;
}

export async function getRemittancesReport(params: RemittanceReportParams): Promise<IRemittanceReport> {
  const { data } = await apiClient.get('/remittances/report', { params });
  return data;
}

export function buildRemittancesReportDownloadUrl(params: RemittanceReportParams & { format: 'csv' | 'pdf' }): string {
  const base = apiClient.defaults.baseURL ?? '';
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
  ).toString();
  return `${base}/remittances/report?${q}`;
}
