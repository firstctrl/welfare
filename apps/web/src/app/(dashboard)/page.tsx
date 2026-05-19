import { DashboardClient } from './dashboard-client';

export const metadata = { title: 'Dashboard — Welfare' };

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <DashboardClient />
    </div>
  );
}
