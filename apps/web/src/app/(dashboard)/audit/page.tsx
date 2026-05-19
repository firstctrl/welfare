import { Suspense } from 'react';
import AuditClient from './audit-client';

export const metadata = { title: 'Audit Log — Welfare System' };

export default function AuditPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">Audit Log</h1>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
        <AuditClient />
      </Suspense>
    </div>
  );
}
