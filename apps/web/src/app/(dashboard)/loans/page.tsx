import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoansListClient } from './loans-list-client';
import { TableSkeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Loans — NACOC Welfare' };

export default function LoansPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Loans</h1>
      </div>
      <Suspense fallback={<div className="bg-white border border-neutral-200 rounded-md"><TableSkeleton rows={8} cols={7} /></div>}>
        <LoansListClient />
      </Suspense>
    </div>
  );
}
