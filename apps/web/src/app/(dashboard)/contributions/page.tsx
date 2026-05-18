import Link from 'next/link';

export const metadata = { title: 'Contributions' };

export default function ContributionsPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Contributions</h1>
      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <Link
          href="/contributions/import"
          className="block p-6 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <p className="font-medium text-gray-900">Payroll Import</p>
          <p className="text-sm text-gray-500 mt-1">Upload Excel file from payroll</p>
        </Link>
        <Link
          href="/contributions/manual"
          className="block p-6 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <p className="font-medium text-gray-900">Manual Entry</p>
          <p className="text-sm text-gray-500 mt-1">Record a single or lump-sum payment</p>
        </Link>
      </div>
    </div>
  );
}
