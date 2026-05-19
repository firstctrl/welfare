import { apiClient } from './api-client';
import { AuditAction, AuditEntity } from '@welfare/shared';

export interface AuditLog {
  _id: string;
  actorId: string;
  actorName: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface AuditLogsResult {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditQuery {
  page?: number;
  limit?: number;
  actorId?: string;
  entity?: AuditEntity;
  action?: AuditAction;
  from?: string;
  to?: string;
}

export async function listAuditLogs(query: AuditQuery = {}): Promise<AuditLogsResult> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  if (query.actorId) params.set('actorId', query.actorId);
  if (query.entity) params.set('entity', query.entity);
  if (query.action) params.set('action', query.action);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);

  const { data } = await apiClient.get<AuditLogsResult>(`/audit?${params.toString()}`);
  return data;
}
