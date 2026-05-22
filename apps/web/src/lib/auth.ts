import { useAuthStore } from '../store/auth.store';

interface LoginCredentials {
  username: string;
  password: string;
  mode?: 'ad' | 'local';
}

export async function login(credentials: LoginCredentials): Promise<void> {
  const endpoint = credentials.mode === 'local' ? '/api/auth/login' : '/api/auth/login/ldap';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });

  if (!res.ok) {
    const error = await res.json() as { message?: string };
    throw new Error(error.message || 'Login failed');
  }

  const data = await res.json() as { accessToken: string };
  useAuthStore.getState().setTokenAndUser(data.accessToken);
  const store = useAuthStore.getState();
  if (store.user?.id) localStorage.setItem('welfare_user_id', store.user.id);
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
  });

  if (!res.ok) {
    await logout();
    return null;
  }

  const data = await res.json() as { accessToken: string };
  useAuthStore.getState().setTokenAndUser(data.accessToken);
  return data.accessToken;
}
