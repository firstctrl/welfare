'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueries } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { LoanStatus } from '@welfare/shared';
import type { ILoan } from '@welfare/shared';
import { listLoans, getLoanSchedule } from '@/lib/loans';
import { listStaff } from '@/lib/staff';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const LOAN_STATUS_BADGE: Record<LoanStatus, string> = {
  [LoanStatus.Active]:    'bg-green-100 text-green-800',
  [LoanStatus.Completed]: 'bg-blue-100 text-blue-700',
  [LoanStatus.Defaulted]: 'bg-orange-100 text-orange-700',
  [LoanStatus.WrittenOff]:'bg-gray-100 text-gray-600',
  [LoanStatus.BadDebt]:   'bg-red-100 text-red-700',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const col = createColumnHelper<ILoan>();

export function LoansListClient() {
  const router = useRouter();
  const [page, setPage]               = useState(1);
  const [status, setStatus]           = useState<LoanStatus | ''>('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear]   = useState('');
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['loans', { page, status }],
    queryFn: () => listLoans({ page, limit, status: status || undefined }),
  });

  // Staff name lookup — one request, cached 10 min
  const { data: staffData } = useQuery({
    queryKey: ['staff', 'all'],
    queryFn: () => listStaff({ limit: 1000 }),
    staleTime: 10 * 60 * 1000,
  });
  const staffMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staffData?.data ?? []) m.set(s._id, s.fullName);
    return m;
  }, [staffData]);

  // Outstanding balance — one schedule query per visible loan
  const scheduleQueries = useQueries({
    queries: (data?.data ?? []).map((loan) => ({
      queryKey: ['loans', loan._id, 'schedule'],
      queryFn: () => getLoanSchedule(loan._id),
      enabled: !!data,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const outstandingMap = useMemo(() => {
    const m = new Map<string, number | null>();
    (data?.data ?? []).forEach((loan, i) => {
      const schedule = scheduleQueries[i]?.data;
      if (!schedule) { m.set(loan._id, null); return; }
      const val = schedule.reduce(
        (sum, r) => sum + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount),
        0,
      );
      m.set(loan._id, Math.round(val * 100) / 100);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, JSON.stringify(scheduleQueries.map((q) => q.status))]);

  // Client-side disbursed date filter
  const filtered = useMemo(() => {
    const loans = data?.data ?? [];
    if (!filterMonth && !filterYear) return loans;
    return loans.filter((loan) => {
      const d = new Date(loan.disbursedDate);
      if (filterMonth && d.getMonth() + 1 !== parseInt(filterMonth, 10)) return false;
      if (filterYear && d.getFullYear() !== parseInt(filterYear, 10)) return false;
      return true;
    });
  }, [data, filterMonth, filterYear]);

  const columns = useMemo(() => [
    col.accessor('staffId', {
      header: 'Staff',
      cell: (info) => (
        <div>
          <div className="font-medium text-gray-900 text-sm">
            {staffMap.get(info.getValue()) ?? '—'}
          </div>
          <div className="text-xs text-gray-400 font-mono">{info.getValue().slice(-8)}</div>
        </div>
      ),
    }),
    col.accessor('principalAmount', {
      header: 'Principal',
      cell: (info) => info.getValue().toLocaleString(),
    }),
    col.accessor('totalRepayable', {
      header: 'Total Repayable',
      cell: (info) => info.getValue().toLocaleString(),
    }),
    col.accessor('disbursedDate', {
      header: 'Disbursed',
      cell: (info) => new Date(info.getValue()).toLocaleDateString('en-GB'),
    }),
    col.accessor('tenureMonths', {
      header: 'Tenure',
      cell: (info) => `${info.getValue()}mo`,
    }),
    col.display({
      id: 'outstanding',
      header: 'Outstanding',
      cell: ({ row }) => {
        const val = outstandingMap.get(row.original._id);
        if (val === null || val === undefined)
          return <span className="text-gray-300 text-xs">…</span>;
        return <span className="font-medium">{val.toLocaleString()}</span>;
      },
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (info) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LOAN_STATUS_BADGE[info.getValue()]}`}>
          {info.getValue()}
        </span>
      ),
    }),
  ], [staffMap, outstandingMap]);

  const table = useReactTable({ data: filtered, columns, getCoreRowModel: getCoreRowModel() });

  if (error) return <div className="text-sm text-red-500">Failed to load loans.</div>;

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as LoanStatus | ''); setPage(1); }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          {Object.values(LoanStatus).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Months</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Years</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {(filterMonth || filterYear) && (
          <button
            onClick={() => { setFilterMonth(''); setFilterYear(''); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="p-2">
                  <TableSkeleton rows={5} cols={columns.length} />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    title="No loans found"
                    description={status || filterMonth || filterYear ? 'Try adjusting your filters.' : 'Record the first loan to get started.'}
                  />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/loans/${row.original._id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-gray-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data?.total ?? 0)} of {data?.total ?? 0}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= (data?.totalPages ?? 1)}
              className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
