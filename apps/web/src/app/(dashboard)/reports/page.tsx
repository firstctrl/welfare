import { ReportsClient } from './reports-client';

export const metadata = { title: 'Reports - Welfare Department' };

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Reports</h1>
      <ReportsClient />
    </div>
  );
}
