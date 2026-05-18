import { Suspense } from 'react';
import ImportClient from './import-client';

export const metadata = { title: 'Import Contributions' };

export default function ImportPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <a href="/contributions" className="text-sm text-gray-500 hover:text-gray-700">
          ← Contributions
        </a>
        <h1 className="text-2xl font-semibold text-gray-900">Payroll Import</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading...</div>}>
        <ImportClient />
      </Suspense>
    </div>
  );
}
