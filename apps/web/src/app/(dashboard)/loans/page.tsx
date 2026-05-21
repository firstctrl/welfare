import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { LoansListClient } from './loans-list-client';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Plus, Upload } from 'lucide-react';

export const metadata: Metadata = { title: 'Loans — NACOC Welfare' };

export default function LoansPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Loans</h1>
        <div className="flex gap-2">
          <Link
            href="/loans/import"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-white border border-neutral-200 text-neutral-700 text-sm font-semibold rounded-sm hover:bg-neutral-50 transition-colors duration-fast"
          >
            <Upload size={16} strokeWidth={1.75} />
            Import Repayments
          </Link>
          <Link
            href="/loans/new"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-primary-600 text-white text-sm font-semibold rounded-sm hover:bg-primary-700 transition-colors duration-fast"
          >
            <Plus size={16} strokeWidth={1.75} />
            Record New Loan
          </Link>
        </div>
      </div>
      <Suspense fallback={<div className="bg-white border border-neutral-200 rounded-md"><TableSkeleton rows={8} cols={7} /></div>}>
        <LoansListClient />
      </Suspense>
    </div>
  );
}
