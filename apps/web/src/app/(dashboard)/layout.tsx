import type { ReactNode } from 'react';
import { Sidebar } from '../../components/nav/sidebar';
import { Topbar } from '../../components/nav/topbar';
import { IdleLogout } from '../../components/idle-logout';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-[var(--surface-sunken)] overflow-hidden">
      <IdleLogout />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
