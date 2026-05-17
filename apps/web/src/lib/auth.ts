import { useAuthStore } from '../store/auth.store';

interface LoginCredentials {
  username: string;
  password: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export async function login(credentials: LoginCredentials): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!res.ok) {
    const error = await res.json() as { message?: string };
    throw new Error(error.message || 'Login failed');
  }

  const data = await res.json() as LoginResponse;

  // Parse JWT and store access token + user info in memory (Zustand)
  useAuthStore.getState().setTokenAndUser(data.accessToken);
  // Store refresh token in localStorage (for session persistence)
  localStorage.setItem('welfare_refresh_token', data.refreshToken);
  // httpOnly cookie is set by the route handler — middleware reads it
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  useAuthStore.getState().clearAuth();
  localStorage.removeItem('welfare_refresh_token');
  localStorage.removeItem('welfare_auth_store');
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('welfare_refresh_token');
  if (!refreshToken) return null;

  const store = useAuthStore.getState();
  const userId = store.user?.id;
  if (!userId) return null;

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, refreshToken }),
  });

  if (!res.ok) {
    await logout();
    return null;
  }

  const data = await res.json() as { accessToken: string; refreshToken: string };
  store.setTokenAndUser(data.accessToken);
  localStorage.setItem('welfare_refresh_token', data.refreshToken);
  return data.accessToken;
}
