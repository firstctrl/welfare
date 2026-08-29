import { Suspense } from 'react';
import ImportClient from './import-client';

export const metadata = { title: 'Claims Legacy Import - Welfare Department' };

export default function ClaimsImportPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <a href="/claims" className="text-sm text-neutral-500 hover:text-neutral-700">← Claims</a>
        <h1 className="text-xl font-bold text-neutral-900">Legacy Claims Import</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-neutral-400">Loading...</div>}>
        <ImportClient />
      </Suspense>
    </div>
  );
}
