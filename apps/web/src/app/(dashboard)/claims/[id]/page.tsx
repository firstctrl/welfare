import type { Metadata } from 'next';
import Link from 'next/link';
import { ClaimDetailClient } from './claim-detail-client';

export const metadata: Metadata = { title: 'Claim Detail | Welfare Management System' };

export default function ClaimDetailPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <Link href="/claims" className="text-sm text-gray-500 hover:text-gray-700">
          ← Claims
        </Link>
      </div>
      <ClaimDetailClient id={params.id} />
    </div>
  );
}
