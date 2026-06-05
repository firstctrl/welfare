import { Suspense } from 'react';
import AuditClient from './audit-client';

export const metadata = { title: 'Audit Log - Welfare Department' };

export default function AuditPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Audit Log</h1>
      <Suspense fallback={<div className="text-sm text-neutral-500">Loading…</div>}>
        <AuditClient />
      </Suspense>
    </div>
  );
}
