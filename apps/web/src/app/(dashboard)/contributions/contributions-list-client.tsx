'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { IContribution } from '@welfare/shared';
import { ContributionStatus, AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { listContributions, deleteContribution } from '@/lib/contributions';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Select, Input } from '@/components/ui/field';
import { Pagination } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const statusKind: Record<ContributionStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  [ContributionStatus.Paid]:            'success',
  [ContributionStatus.Partial]:         'warning',
  [ContributionStatus.Missed]:          'danger',
  [ContributionStatus.CarriedForward]:  'info',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

type ContributionRow = IContribution & {
  staffInfo?: { staffId: string; fullName: string };
};

const LIMIT = 20;

export default function ContributionsListClient() {
  const qc = useQueryClient();
  const permission = usePermission(AppModule.Contributions);
  const [page, setPage]       = useState(1);
  const [status, setStatus]   = useState<ContributionStatus | ''>('');
  const [month, setMonth]     = useState('');
  const [year, setYear]       = useState('');
  const [staffId, setStaffId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ContributionRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['contributions', { page, status, month, year, staffId }],
    queryFn: () => listContributions({
      page,
      limit: LIMIT,
      status: status || undefined,
      month: month ? parseInt(month, 10) : undefined,
      year:  year  ? parseInt(year, 10)  : undefined,
      staffId: staffId || undefined,
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteContribution(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributions'] });
      setDeleteTarget(null);
      toast.success('Contribution deleted');
    },
    onError: () => toast.error('Failed to delete contribution'),
  });

  if (error) toast.error('Failed to load contributions');

  const col = createColumnHelper<ContributionRow>();
  const columns = [
    col.display({
      id: 'staff',
      header: 'Staff',
      cell: (i) => {
        const info = i.row.original.staffInfo;
        return info ? (
          <span>
            <span className="font-medium text-neutral-900">{info.fullName}</span>
            <span className="ml-2 font-mono text-xs text-neutral-500">{info.staffId}</span>
          </span>
        ) : <span className="font-mono text-xs text-neutral-400">{i.row.original.staffId}</span>;
      },
    }),
    col.display({
      id: 'period',
      header: 'Period',
      cell: (i) => <span className="font-mono tabular">{MONTHS[i.row.original.month - 1]} {i.row.original.year}</span>,
    }),
    col.accessor('expectedAmount', { header: 'Expected', cell: (i) => <span className="font-mono tabular">{fmtGHS(i.getValue())}</span> }),
    col.accessor('paidAmount',     { header: 'Paid',     cell: (i) => <span className="font-mono tabular">{fmtGHS(i.getValue())}</span> }),
    col.accessor('surplusCarriedForward', { header: 'Surplus', cell: (i) => <span className="font-mono tabular text-neutral-500">{fmtGHS(i.getValue())}</span> }),
    col.accessor('source',         { header: 'Source',   cell: (i) => <span className="text-xs text-neutral-500">{i.getValue()}</span> }),
    col.accessor('status', {
      header: 'Status',
      cell: (i) => <Badge kind={statusKind[i.getValue()]}>{i.getValue()}</Badge>,
    }),
    ...(permission === 'full' ? [col.display({
      id: 'actions',
      header: '',
      cell: (i) => (
        <button
          onClick={() => setDeleteTarget(i.row.original)}
          className="text-neutral-400 hover:text-danger-600 transition-colors duration-fast p-1 rounded"
          title="Delete"
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      ),
    })] : []),
  ];

  const table = useReactTable({
    data: (data?.data ?? []) as ContributionRow[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / LIMIT) : 0,
    state: { pagination: { pageIndex: page - 1, pageSize: LIMIT } },
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const next = updater({ pageIndex: page - 1, pageSize: LIMIT });
        setPage(next.pageIndex + 1);
      }
    },
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Staff ID"
          value={staffId}
          onChange={(e) => { setStaffId(e.target.value); setPage(1); }}
          style={{ width: 130 }}
        />
        <Select
          value={month}
          onChange={(e) => { setMonth(e.target.value); setPage(1); }}
          options={[
            { value: '', label: 'All Months' },
            ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
          ]}
          style={{ width: 130 }}
        />
        <Input
          type="number"
          placeholder="Year"
          value={year}
          onChange={(e) => { setYear(e.target.value); setPage(1); }}
          style={{ width: 100 }}
        />
        <Select
          value={status}
          onChange={(e) => { setStatus(e.target.value as ContributionStatus | ''); setPage(1); }}
          options={[
            { value: '', label: 'All Statuses' },
            ...Object.values(ContributionStatus).map((s) => ({ value: s, label: s })),
          ]}
          style={{ width: 150 }}
        />
        {data && (
          <span className="ml-auto text-xs text-neutral-400">{data.total.toLocaleString()} records</span>
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
                      heading="No contributions found"
                      body={status || month || year || staffId ? 'Try adjusting your filters.' : 'Import payroll or record a manual entry to get started.'}
                    />
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-neutral-50 transition-colors duration-fast"
                    style={{ height: 'var(--row-default)' }}
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

        {data && data.total > LIMIT && (
          <Pagination page={page} total={data.total} limit={LIMIT} onPageChange={setPage} />
        )}
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title="Delete Contribution"
          size="sm"
          iconKind="danger"
        >
          <p className="mt-2 text-sm text-neutral-600">
            Delete{' '}
            <strong>{deleteTarget.staffInfo?.fullName ?? deleteTarget.staffId}</strong>
            {' '}— {MONTHS[deleteTarget.month - 1]} {deleteTarget.year}?
            This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deleteTarget._id)}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
