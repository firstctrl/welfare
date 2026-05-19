import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth.store';

interface RetryConfig extends InternalAxiosRequestConfig {
  _isRetry?: boolean;
}

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — inject auth token from Zustand memory store
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = useAuthStore.getState().token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — 401 refresh, 403 permission toast, 500 server error toast
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetryConfig | undefined;
    const status: number | undefined = error.response?.status;

    if (status === 401 && !config?._isRetry && typeof window !== 'undefined') {
      if (config) config._isRetry = true;
      const { refreshAccessToken } = await import('./auth');
      const newToken = await refreshAccessToken();
      if (newToken && config) {
        config.headers.Authorization = `Bearer ${newToken}`;
        return apiClient.request(config);
      }
      window.location.href = '/login';
    }

    if (status === 403 && typeof window !== 'undefined') {
      const { toast } = await import('sonner');
      toast.error('Access denied — you do not have permission for this action.');
    }

    if (status !== undefined && status >= 500 && typeof window !== 'undefined') {
      const { toast } = await import('sonner');
      toast.error('Server error — please try again or contact support.');
    }

    return Promise.reject(error);
  },
);
