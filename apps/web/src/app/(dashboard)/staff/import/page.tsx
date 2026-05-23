import type { Metadata } from 'next';
import StaffImportClient from './import-client';

export const metadata: Metadata = { title: 'Import Staff' };

export default function StaffImportPage() {
  return <StaffImportClient />;
}
