import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth.store';

// Extend config type to include _isRetry flag
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

// Response interceptor — attempt refresh on 401 before redirecting
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetryConfig | undefined;
    if (error.response?.status === 401 && !config?._isRetry && typeof window !== 'undefined') {
      if (config) config._isRetry = true;
      const { refreshAccessToken } = await import('./auth');
      const newToken = await refreshAccessToken();
      if (newToken && config) {
        config.headers.Authorization = `Bearer ${newToken}`;
        return apiClient.request(config);
      }
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
