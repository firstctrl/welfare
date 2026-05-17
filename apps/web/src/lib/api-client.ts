import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — inject auth token
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('welfare_auth_store');
    const token = stored ? (JSON.parse(stored) as { state?: { token?: string } })?.state?.token : null;
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('welfare_auth_store');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
