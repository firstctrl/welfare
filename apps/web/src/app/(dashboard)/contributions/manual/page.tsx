import { Suspense } from 'react';
import ManualEntryClient from './manual-entry-client';

export const metadata = { title: 'Manual Contribution Entry' };

export default function ManualEntryPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <a href="/contributions" className="text-sm text-gray-500 hover:text-gray-700">
          ← Contributions
        </a>
        <h1 className="text-2xl font-semibold text-gray-900">Manual / Lump-Sum Entry</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading...</div>}>
        <ManualEntryClient />
      </Suspense>
    </div>
  );
}
