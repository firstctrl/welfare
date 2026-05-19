import { ReportsClient } from './reports-client';

export const metadata = { title: 'Reports — Welfare' };

export default function ReportsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Reports</h1>
      <ReportsClient />
    </div>
  );
}
