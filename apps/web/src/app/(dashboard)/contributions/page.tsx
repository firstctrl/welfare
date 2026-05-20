import Link from 'next/link';
import { Upload, PenLine } from 'lucide-react';

export const metadata = { title: 'Contributions — NCC Welfare' };

export default function ContributionsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-neutral-900">Contributions</h1>
      <div className="grid grid-cols-2 gap-4 max-w-xl">
        <Link
          href="/contributions/import"
          className="block p-6 bg-white border border-neutral-200 rounded-md hover:border-primary-300 hover:shadow-raised transition-all group"
        >
          <div className="w-10 h-10 rounded-md bg-primary-50 text-primary-700 flex items-center justify-center mb-3 group-hover:bg-primary-100 transition-colors">
            <Upload size={20} strokeWidth={1.75} />
          </div>
          <p className="font-semibold text-neutral-900">Payroll Import</p>
          <p className="text-sm text-neutral-500 mt-1">Upload Excel file from payroll</p>
        </Link>
        <Link
          href="/contributions/manual"
          className="block p-6 bg-white border border-neutral-200 rounded-md hover:border-primary-300 hover:shadow-raised transition-all group"
        >
          <div className="w-10 h-10 rounded-md bg-accent-50 text-accent-700 flex items-center justify-center mb-3 group-hover:bg-accent-100 transition-colors">
            <PenLine size={20} strokeWidth={1.75} />
          </div>
          <p className="font-semibold text-neutral-900">Manual Entry</p>
          <p className="text-sm text-neutral-500 mt-1">Record a single or lump-sum payment</p>
        </Link>
      </div>
    </div>
  );
}
