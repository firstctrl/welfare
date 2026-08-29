import { Suspense } from 'react';
import CreateClaimClient from './create-claim-client';

export const metadata = { title: 'New Claim - Welfare Department' };

export default function NewClaimPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <a href="/claims" className="text-sm text-gray-500 hover:text-gray-700">← Claims</a>
        <h1 className="text-2xl font-semibold text-gray-900">New Welfare Claim</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading...</div>}>
        <CreateClaimClient />
      </Suspense>
    </div>
  );
}
