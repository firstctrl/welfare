import { apiClient } from './api-client';
import type { IEmailLog } from '@welfare/shared';
import { EmailLogStatus, EmailLogType } from '@welfare/shared';

export { EmailLogStatus, EmailLogType };

export interface EmailLogFilters {
  staffId?: string;
  type?: EmailLogType;
  status?: EmailLogStatus;
  page?: number;
  limit?: number;
}

export interface PaginatedEmailLogs {
  items: IEmailLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listEmailLogs(filters: EmailLogFilters = {}): Promise<PaginatedEmailLogs> {
  const params: Record<string, string> = {};
  if (filters.staffId) params['staffId'] = filters.staffId;
  if (filters.type) params['type'] = filters.type;
  if (filters.status) params['status'] = filters.status;
  if (filters.page) params['page'] = String(filters.page);
  if (filters.limit) params['limit'] = String(filters.limit);
  const { data } = await apiClient.get<PaginatedEmailLogs>('/email/logs', { params });
  return data;
}

export async function sendContributionStatement(staffId: string, year: number): Promise<void> {
  await apiClient.post(`/email/contribution-statement/${staffId}`, null, { params: { year } });
}

export async function sendLoanSchedule(loanId: string): Promise<void> {
  await apiClient.post(`/email/loan-schedule/${loanId}`);
}

export async function runBulkAnnualStatement(): Promise<void> {
  await apiClient.post('/email/contribution-statement/bulk');
}
