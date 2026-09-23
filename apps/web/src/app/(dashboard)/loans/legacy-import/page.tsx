import type { Metadata } from 'next';
import LoanLegacyImportClient from './legacy-import-client';

export const metadata: Metadata = { title: 'Import Legacy Loans' };

export default function LoanLegacyImportPage() {
  return <LoanLegacyImportClient />;
}
