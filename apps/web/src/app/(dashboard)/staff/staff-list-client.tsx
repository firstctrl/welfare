'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { IStaff } from '@welfare/shared';
import { StaffStatus } from '@welfare/shared';
import { listStaff, searchStaff } from '@/lib/staff';
import AddStaffModal from './add-staff-modal';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const STATUS_BADGE: Record<StaffStatus, string> = {
  [StaffStatus.Active]:    'bg-green-100 text-green-800',
  [StaffStatus.Resigned]:  'bg-gray-100 text-gray-600',
  [StaffStatus.Retired]:   'bg-blue-100 text-blue-700',
  [StaffStatus.Dismissed]: 'bg-red-100 text-red-700',
  [StaffStatus.Deceased]:  'bg-black text-white',
};

const col = createColumnHelper<IStaff>();

const columns = [
  col.accessor('fullName', { header: 'Full Name' }),
  col.accessor('staffId', { header: 'Staff ID' }),
  col.accessor('level', { header: 'Level' }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => (
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[info.getValue()]}`}
      >
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor('dateOfEmployment', {
    header: 'Employed',
    cell: (info) => new Date(info.getValue()).toLocaleDateString('en-GB'),
  }),
];

export default function StaffListClient() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StaffStatus | ''>('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff', { page, status, level, q }],
    queryFn: () =>
      q
        ? searchStaff(q, {
            page,
            limit,
            status: status || undefined,
            level: level || undefined,
          })
        : listStaff({
            page,
            limit,
            status: status || undefined,
            level: level || undefined,
          }),
  });

  const handleSearch = useCallback(() => {
    setQ(searchInput);
    setPage(1);
  }, [searchInput]);

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / limit) : 0,
    state: { pagination: { pageIndex: page - 1, pageSize: limit } },
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const next = updater({ pageIndex: page - 1, pageSize: limit });
        setPage(next.pageIndex + 1);
      }
    },
  });

  if (error) toast.error('Failed to load staff');

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StaffStatus | '');
            setPage(1);
          }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          {Object.values(StaffStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          placeholder="Level (e.g. GL 10)"
          value={level}
          onChange={(e) => {
            setLevel(e.target.value);
            setPage(1);
          }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex">
          <input
            placeholder="Search name, staff ID, PF No..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="border border-gray-300 rounded-l-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          <button
            onClick={handleSearch}
            className="border border-l-0 border-gray-300 rounded-r-md px-3 py-1.5 text-sm bg-gray-50 hover:bg-gray-100"
          >
            Search
          </button>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            + Add Staff
          </button>
        </div>
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
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    title="No staff members found"
                    description={q || status ? 'Try adjusting your filters.' : 'Add the first staff member to get started.'}
                  />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/staff/${row.original._id}`)}
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
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of{' '}
            {data.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border rounded-md disabled:opacity-40 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border rounded-md disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddStaffModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
