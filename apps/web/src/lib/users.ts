import { apiClient } from './api-client';
import { UserRole } from '@welfare/shared';

export interface UserRecord {
  _id: string;
  username: string;
  displayName: string;
  email?: string;
  role: UserRole;
  source: 'ldap' | 'local';
  isActive: boolean;
  lastLogin?: string;
  createdAt?: string;
}

export interface CreateUserDto {
  username: string;
  displayName: string;
  email?: string;
  password: string;
  role?: UserRole;
}

export async function fetchUsers(): Promise<UserRecord[]> {
  const { data } = await apiClient.get<UserRecord[]>('/users');
  return data;
}

export async function createUser(dto: CreateUserDto): Promise<UserRecord> {
  const { data } = await apiClient.post<UserRecord>('/users', dto);
  return data;
}

export async function updateUser(
  id: string,
  dto: Partial<Pick<UserRecord, 'displayName' | 'email' | 'isActive'>>,
): Promise<UserRecord> {
  const { data } = await apiClient.patch<UserRecord>(`/users/${id}`, dto);
  return data;
}

export async function updateUserRole(id: string, role: UserRole): Promise<UserRecord> {
  const { data } = await apiClient.patch<UserRecord>(`/users/${id}/role`, { role });
  return data;
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await apiClient.post(`/users/${id}/reset-password`, { password });
}
