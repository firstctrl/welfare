import { DashboardClient } from './dashboard-client';

export const metadata = { title: 'Dashboard - Welfare Department' };

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-900 mb-6">Dashboard</h1>
      <DashboardClient />
    </div>
  );
}
