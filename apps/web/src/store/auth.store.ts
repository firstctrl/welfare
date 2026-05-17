import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
  id: string;      // MongoDB _id
  name: string;
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
        // Parse JWT payload to extract user info
        const payload = JSON.parse(atob(token.split('.')[1])) as {
          sub: string;
          username: string;
          role: string;
        };
        set({
          token,
          user: { id: payload.sub, name: payload.username, role: payload.role },
        });
      },
      clearAuth: () => set({ token: null, user: null }),
    }),
    {
      name: 'welfare_auth_store',
      skipHydration: true,
    },
  ),
);
