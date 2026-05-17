'use client';

import { useRouter } from 'next/navigation';
import { logout } from '../../lib/auth';

export function Topbar() {
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
      <h1 className="text-lg font-semibold text-gray-800">Welfare Management System</h1>
      <button
        onClick={handleLogout}
        className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        Sign out
      </button>
    </header>
  );
}
