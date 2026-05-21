import { apiClient } from './api-client';
import type { IStaff, PaginatedResult, StaffStatus } from '@welfare/shared';

export interface StaffFilters {
  page?: number;
  limit?: number;
  status?: StaffStatus;
  level?: string;
}

export interface CreateStaffPayload {
  fullName: string;
  staffId: string;
  pfNo?: string;
  dateOfBirth: string;
  phoneNumber: string;
  email: string;
  dateOfEmployment: string;
  dateOfFirstContribution?: string;
  level?: string;
  point?: number;
}

export interface ChangeStatusPayload {
  status: StaffStatus;
  effectiveDate: string;
  notes?: string;
}

export interface ChangeStatusResult {
  staff: IStaff;
  requiresSettlement: boolean;
}

export async function listStaff(filters: StaffFilters = {}): Promise<PaginatedResult<IStaff>> {
  const { data } = await apiClient.get('/staff', { params: filters });
  return data;
}

export async function searchStaff(
  q: string,
  filters: StaffFilters = {},
): Promise<PaginatedResult<IStaff>> {
  const { data } = await apiClient.get('/staff', { params: { q, limit: 10, ...filters } });
  return data;
}

export async function getStaff(id: string): Promise<IStaff> {
  const { data } = await apiClient.get(`/staff/${id}`);
  return data;
}

export async function createStaff(payload: CreateStaffPayload): Promise<IStaff> {
  const { data } = await apiClient.post('/staff', payload);
  return data;
}

export async function updateStaff(
  id: string,
  payload: Partial<CreateStaffPayload>,
): Promise<IStaff> {
  const { data } = await apiClient.patch(`/staff/${id}`, payload);
  return data;
}

export async function changeStaffStatus(
  id: string,
  payload: ChangeStatusPayload,
): Promise<ChangeStatusResult> {
  const { data } = await apiClient.patch(`/staff/${id}/status`, payload);
  return data;
}

export async function uploadStaffPhoto(id: string, file: File): Promise<IStaff> {
  const form = new FormData();
  form.append('photo', file);
  const { data } = await apiClient.post(`/staff/${id}/photo`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function getStaffPhotoUrl(id: string): Promise<string> {
  const { data } = await apiClient.get(`/staff/${id}/photo`);
  return data;
}

export async function getLoanEligibility(
  id: string,
): Promise<{ eligible: boolean; reason?: string }> {
  const { data } = await apiClient.get(`/staff/${id}/eligibility`);
  return data;
}
