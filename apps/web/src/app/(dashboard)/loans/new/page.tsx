import type { Metadata } from 'next';
import Link from 'next/link';
import { NewLoanClient } from './new-loan-client';

export const metadata: Metadata = { title: 'Record New Loan | Welfare Management System' };

export default function NewLoanPage() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/loans" className="text-sm text-gray-500 hover:text-gray-700">
          ← Loans
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Record New Loan</h1>
      </div>
      <NewLoanClient />
    </div>
  );
}
