import type { Metadata } from 'next';
import { SettingsClient } from './settings-client';

export const metadata: Metadata = {
  title: 'Settings — NCC Welfare',
};

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Settings</h1>
      <SettingsClient />
    </div>
  );
}
