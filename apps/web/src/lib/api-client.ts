import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — inject auth token
apiClient.interceptors.request.use((config) => {
  // Token retrieved from localStorage to avoid SSR issues
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('welfare_auth_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('welfare_auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
