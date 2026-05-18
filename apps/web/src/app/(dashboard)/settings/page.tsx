import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettingsClient } from './settings-client';

export const metadata: Metadata = {
  title: 'Settings | Welfare Management System',
};

function SettingsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-white rounded-lg shadow-sm p-6">
          <div className="h-5 bg-gray-200 rounded w-40 mb-6" />
          <div className="space-y-4">
            <div className="h-3 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-9 bg-gray-200 rounded" />
          </div>
          <div className="mt-6 flex justify-end">
            <div className="h-9 bg-gray-200 rounded w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsClient />
      </Suspense>
    </div>
  );
}
