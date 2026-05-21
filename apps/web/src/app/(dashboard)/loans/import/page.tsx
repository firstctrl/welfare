import { Suspense } from 'react';
import LoanImportClient from './import-client';

export const metadata = { title: 'Import Loan Repayments' };

export default function LoanImportPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <a href="/loans" className="text-sm text-neutral-500 hover:text-neutral-700">
          ← Loans
        </a>
        <h1 className="text-2xl font-semibold text-neutral-900">Import Repayments</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-neutral-400">Loading…</div>}>
        <LoanImportClient />
      </Suspense>
    </div>
  );
}
