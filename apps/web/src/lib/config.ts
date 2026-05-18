import { apiClient } from './api-client';

export type ConfigEntry = { value: string; updatedBy: string; updatedAt: string };
export type ConfigMap = Record<string, ConfigEntry>;

export async function getConfig(): Promise<ConfigMap> {
  const res = await apiClient.get<ConfigMap>('/config');
  return res.data;
}

export async function updateConfig(updates: Record<string, string>): Promise<ConfigMap> {
  const res = await apiClient.patch<ConfigMap>('/config', updates);
  return res.data;
}

export async function testEmail(provider: string, to: string): Promise<void> {
  await apiClient.post('/config/test-email', { provider, to });
}
