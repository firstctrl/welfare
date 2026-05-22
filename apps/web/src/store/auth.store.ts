import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
  id: string;      // MongoDB _id
  username: string;
  displayName: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setToken: (token: string) => void;
  setUser: (user: AuthUser) => void;
  setTokenAndUser: (token: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setToken: (token) => set({ token }),
      setUser: (user) => set({ user }),
      setTokenAndUser: (token: string) => {
        try {
          const parts = token.split('.');
          if (parts.length < 3) throw new Error('malformed token');
          const payload = JSON.parse(atob(parts[1])) as {
            sub: string;
            username: string;
            displayName: string;
            role: string;
          };
          set({
            token,
            user: { id: payload.sub, username: payload.username, displayName: payload.displayName ?? payload.username, role: payload.role },
          });
        } catch {
          throw new Error('Invalid token received from server');
        }
      },
      clearAuth: () => set({ token: null, user: null }),
    }),
    {
      name: 'welfare_auth_store',
      skipHydration: true,
    },
  ),
);
