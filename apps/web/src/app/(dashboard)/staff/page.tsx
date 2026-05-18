import { Suspense } from 'react';
import StaffListClient from './staff-list-client';

export const metadata = { title: 'Staff Registry' };

export default function StaffPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Staff Registry</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading staff...</div>}>
        <StaffListClient />
      </Suspense>
    </div>
  );
}
