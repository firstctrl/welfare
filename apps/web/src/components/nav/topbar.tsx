'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, LogOut } from 'lucide-react';
import { logout } from '../../lib/auth';
import { useAuthStore } from '../../store/auth.store';
import { CommandPalette } from '../search/command-palette';
import { Avatar } from '../ui/avatar';
import { cn } from '@/lib/utils';

export function Topbar() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
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
      <header className="bg-white border-b border-neutral-200 px-6 flex items-center justify-between shrink-0 h-[var(--row-relaxed)]">
        {/* Search trigger */}
        <button
          onClick={() => setOpen(true)}
          className={cn(
            'flex items-center gap-2 px-3 h-9 text-sm text-neutral-400 bg-neutral-50 border border-neutral-200 rounded-sm',
            'hover:border-neutral-300 hover:text-neutral-600 transition-colors duration-fast',
            'w-64',
          )}
        >
          <Search size={14} strokeWidth={1.75} />
          <span className="flex-1 text-left">Search&hellip;</span>
          <kbd className="text-xs bg-white border border-neutral-200 rounded-xs px-1 py-0.5 font-mono text-neutral-400">
            ⌘K
          </kbd>
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-4">
          {user && (
            <div className="flex items-center gap-2.5">
              <Avatar name={user.displayName} size="sm" />
              <span className="text-sm font-medium text-neutral-700">{user.displayName}</span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors duration-fast"
            aria-label="Sign out"
          >
            <LogOut size={16} strokeWidth={1.75} />
            <span>Sign out</span>
          </button>
        </div>
      </header>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}
