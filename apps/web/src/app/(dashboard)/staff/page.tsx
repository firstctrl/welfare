import { Suspense } from 'react';
import StaffListClient from './staff-list-client';
import { TableSkeleton } from '@/components/ui/skeleton';

export const metadata = { title: 'Staff List - Welfare Department' };

export default function StaffPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Staff List</h1>
      </div>
      <Suspense
        fallback={
          <div className="bg-white border border-neutral-200 rounded-md">
            <TableSkeleton rows={8} cols={6} />
          </div>
        }
      >
        <StaffListClient />
      </Suspense>
    </div>
  );
}
