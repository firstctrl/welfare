import { Suspense } from 'react';
import StaffDetailClient from './staff-detail-client';

export default function StaffDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="p-6">
      <Suspense fallback={<div className="text-sm text-gray-500">Loading staff profile...</div>}>
        <StaffDetailClient id={params.id} />
      </Suspense>
    </div>
  );
}
