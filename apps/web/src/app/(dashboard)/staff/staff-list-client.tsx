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
import Link from 'next/link';
import { toast } from 'sonner';
import { Search, Upload, UserPlus } from 'lucide-react';
import type { IStaff } from '@welfare/shared';
import { StaffStatus, AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { listStaff, searchStaff } from '@/lib/staff';
import AddStaffModal from './add-staff-modal';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Pagination } from '@/components/ui/data-table';
import { Avatar } from '@/components/ui/avatar';
import { fmtDate } from '@/lib/format';

const col = createColumnHelper<IStaff>();

const columns = [
  col.display({
    id: 'avatar',
    header: '',
    cell: (info) => <Avatar name={info.row.original.fullName} size="sm" />,
  }),
  col.accessor('fullName', { header: 'Full Name' }),
  col.accessor('staffId', { header: 'Staff ID' }),
  col.accessor('level', { header: 'Level' }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  col.accessor('dateOfEmployment', {
    header: 'Employed',
    cell: (info) => <span className="font-mono tabular">{fmtDate(info.getValue())}</span>,
  }),
];

export default function StaffListClient() {
  const router = useRouter();
  const permission = usePermission(AppModule.Staff);
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
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StaffStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Statuses' },
            ...Object.values(StaffStatus).map((s) => ({ value: s, label: s })),
          ]}
          style={{ width: 160 }}
        />
        <Input
          placeholder="Level (e.g. GL 10)"
          value={level}
          onChange={(e) => {
            setLevel(e.target.value);
            setPage(1);
          }}
          style={{ width: 140 }}
        />
        <span className="inline-flex items-center w-72 rounded-sm border border-neutral-200 bg-white h-[var(--row-default)] focus-within:border-primary-500 focus-within:shadow-focus overflow-hidden">
          <input
            placeholder="Search name, staff ID, PF No..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 px-3 h-full bg-transparent outline-none placeholder:text-neutral-400 text-base"
          />
          <button
            onClick={handleSearch}
            className="px-3 h-full border-l border-neutral-200 bg-neutral-50 text-neutral-500 hover:text-neutral-700 transition-colors duration-fast"
            aria-label="Search"
          >
            <Search size={16} strokeWidth={1.75} />
          </button>
        </span>
        {permission === 'full' && (
          <div className="ml-auto flex gap-2">
            <Link
              href="/staff/import"
              className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-white border border-neutral-200 text-neutral-700 text-sm font-semibold rounded-sm hover:bg-neutral-50 transition-colors duration-fast"
            >
              <Upload size={16} strokeWidth={1.75} />
              Import Staff
            </Link>
            <Button variant="primary" Icon={UserPlus} onClick={() => setShowAddModal(true)}>
              Add Staff
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-4 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap"
                      style={{ height: 'var(--row-default)' }}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="p-0">
                    <TableSkeleton rows={5} cols={columns.length} />
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState
                      heading="No staff members found"
                      body={
                        q || status
                          ? 'Try adjusting your filters.'
                          : 'Add the first staff member to get started.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-neutral-50 cursor-pointer transition-colors duration-fast"
                    style={{ height: 'var(--row-default)' }}
                    onClick={() => router.push(`/staff/${row.original._id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 text-neutral-800">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > limit && (
          <Pagination page={page} total={data.total} limit={limit} onPageChange={setPage} />
        )}
      </div>

      {showAddModal && (
        <AddStaffModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
