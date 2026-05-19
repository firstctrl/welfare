import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { LoansListClient } from './loans-list-client';

export const metadata: Metadata = { title: 'Loans | Welfare Management System' };

export default function LoansPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Loans</h1>
        <Link
          href="/loans/new"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          + Record New Loan
        </Link>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-400">Loading...</div>}>
        <LoansListClient />
      </Suspense>
    </div>
  );
}
