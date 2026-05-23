import type { Metadata } from 'next';
import LoanRecordsImportClient from './import-client';

export const metadata: Metadata = { title: 'Import Loans' };

export default function LoanRecordsImportPage() {
  return <LoanRecordsImportClient />;
}
