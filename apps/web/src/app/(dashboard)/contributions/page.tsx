import { Suspense } from 'react';
import Link from 'next/link';
import { Upload, PenLine } from 'lucide-react';
import ContributionsListClient from './contributions-list-client';
import { TableSkeleton } from '@/components/ui/skeleton';

export const metadata = { title: 'Contributions - Welfare Department' };

export default function ContributionsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Contributions</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/contributions/import"
            className="inline-flex items-center gap-2 px-4 h-[var(--row-default)] rounded-sm border border-neutral-200 bg-white text-base font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-700 transition-colors duration-fast"
          >
            <Upload size={16} strokeWidth={1.75} />
            Payroll Import
          </Link>
          <Link
            href="/contributions/manual"
            className="inline-flex items-center gap-2 px-4 h-[var(--row-default)] rounded-sm border border-neutral-200 bg-white text-base font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-700 transition-colors duration-fast"
          >
            <PenLine size={16} strokeWidth={1.75} />
            Manual Entry
          </Link>
        </div>
      </div>

      <Suspense fallback={<div className="bg-white border border-neutral-200 rounded-md"><TableSkeleton rows={8} cols={7} /></div>}>
        <ContributionsListClient />
      </Suspense>
    </div>
  );
}
