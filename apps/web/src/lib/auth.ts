import { useAuthStore } from '../store/auth.store';

interface LoginCredentials {
  username: string;
  password: string;
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

  const data = await res.json() as { accessToken: string };

  // Parse JWT and store access token + user info in memory (Zustand)
  useAuthStore.getState().setTokenAndUser(data.accessToken);
  // Store userId for refresh calls (non-sensitive)
  const store = useAuthStore.getState();
  if (store.user?.id) localStorage.setItem('welfare_user_id', store.user.id);
  // httpOnly cookies (access + refresh) are set by the route handler — middleware reads them
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  useAuthStore.getState().clearAuth();
  localStorage.removeItem('welfare_user_id');
  localStorage.removeItem('welfare_auth_store');
}

export async function refreshAccessToken(): Promise<string | null> {
  const userId = localStorage.getItem('welfare_user_id');
  if (!userId) return null;

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
    // welfare_refresh_token cookie is sent automatically
  });

  if (!res.ok) {
    await logout();
    return null;
  }

  const data = await res.json() as { accessToken: string };
  useAuthStore.getState().setTokenAndUser(data.accessToken);
  return data.accessToken;
}
