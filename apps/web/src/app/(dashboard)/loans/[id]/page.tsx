import type { Metadata } from 'next';
import Link from 'next/link';
import { LoanDetailClient } from './loan-detail-client';

export const metadata: Metadata = { title: 'Loan Detail | Welfare Management System' };

export default function LoanDetailPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <Link href="/loans" className="text-sm text-gray-500 hover:text-gray-700">
          ← Loans
        </Link>
      </div>
      <LoanDetailClient id={params.id} />
    </div>
  );
}
