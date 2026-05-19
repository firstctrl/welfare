'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '../../lib/auth';
import { CommandPalette } from '../search/command-palette';

export function Topbar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <>
      <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Welfare Management System</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
            </svg>
            <span>Search</span>
            <kbd className="ml-1 text-xs bg-white border border-gray-300 rounded px-1 py-0.5 font-mono">⌘K</kbd>
          </button>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}
