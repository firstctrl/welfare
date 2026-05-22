import { useAuthStore } from '../store/auth.store';
import { PERMISSIONS, AppModule, AccessLevel, UserRole } from '@welfare/shared';

export function usePermission(module: AppModule): AccessLevel {
  const user = useAuthStore((s) => s.user);
  if (!user?.role) return 'none';
  const role = user.role as UserRole;
  return PERMISSIONS[role]?.[module] ?? 'none';
}
