'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { X, Plus, Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { LoanStatus, AppModule } from '@welfare/shared';
import type { ILoan } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { listLoans, getLoanSchedule, bulkDeleteLoans } from '@/lib/loans';
import { listStaff } from '@/lib/staff';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Pagination, SortableTh } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { fmtGHS, fmtDate } from '@/lib/format';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const col = createColumnHelper<ILoan>();

export function LoansListClient() {
  const router = useRouter();
  const qc = useQueryClient();
  const permission = usePermission(AppModule.Loans);
  const [page, setPage]               = useState(1);
  const [status, setStatus]           = useState<LoanStatus | ''>('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear]   = useState('');
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [limit, setLimit] = useState(20);

  const { data, isLoading, error } = useQuery({
    queryKey: ['loans', { page, status, limit }],
    queryFn: () => listLoans({ page, limit, status: status || undefined }),
  });

  const { data: staffData } = useQuery({
    queryKey: ['staff', 'all'],
    queryFn: () => listStaff({ limit: 1000 }),
    staleTime: 10 * 60 * 1000,
  });
  const staffMap = useMemo(() => {
    const m = new Map<string, { fullName: string; staffId: string }>();
    for (const s of staffData?.data ?? []) m.set(s._id, { fullName: s.fullName, staffId: s.staffId });
    return m;
  }, [staffData]);

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
      const val = schedule.reduce((sum, r) => sum + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount), 0);
      m.set(loan._id, Math.round(val * 100) / 100);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, JSON.stringify(scheduleQueries.map((q) => q.status))]);

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

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteLoans(ids),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['loans'] });
      setRowSelection({});
      setConfirmBulkDelete(false);
      toast.success(`${result.deleted} loan${result.deleted === 1 ? '' : 's'} deleted`);
    },
    onError: () => toast.error('Failed to delete selected loans'),
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  const columns = useMemo(() => [
    ...(permission === 'full' ? [col.display({
      id: 'select',
      enableSorting: false,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="accent-primary-600"
          checked={table.getIsAllPageRowsSelected()}
          ref={(el) => { if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(); }}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="accent-primary-600"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    })] : []),
    col.accessor('staffId', {
      header: 'Staff',
      cell: (info) => {
        const s = staffMap.get(info.getValue());
        return (
          <div>
            <div className="font-medium text-neutral-900">{s?.fullName ?? '—'}</div>
            <div className="text-xs text-neutral-400 font-mono">{s?.staffId ?? '—'}</div>
          </div>
        );
      },
    }),
    col.accessor('principalAmount', {
      header: 'Principal',
      cell: (info) => <span className="font-mono tabular">{fmtGHS(info.getValue())}</span>,
    }),
    col.accessor('totalRepayable', {
      header: 'Total Repayable',
      cell: (info) => <span className="font-mono tabular">{fmtGHS(info.getValue())}</span>,
    }),
    col.accessor('disbursedDate', {
      header: 'Disbursed',
      cell: (info) => <span className="font-mono tabular">{fmtDate(info.getValue())}</span>,
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
        if (val === null || val === undefined) return <span className="text-neutral-300">…</span>;
        return <span className="font-mono tabular font-medium">{fmtGHS(val)}</span>;
      },
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
  ], [staffMap, outstandingMap, permission]);

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row._id,
    enableRowSelection: permission === 'full',
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: { rowSelection, sorting },
  });

  if (error) return <p className="text-sm text-danger-600">Failed to load loans.</p>;

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-4">
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 justify-end">
          <span className="text-sm text-neutral-600">{selectedIds.length} selected</span>
          <Button variant="danger" Icon={Trash2} onClick={() => setConfirmBulkDelete(true)}>
            Delete Selected
          </Button>
        </div>
      )}
      {permission === 'full' && selectedIds.length === 0 && (
        <div className="flex gap-2 justify-end">
          <Link
            href="/loans/records-import"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-white border border-neutral-200 text-neutral-700 text-sm font-semibold rounded-sm hover:bg-neutral-50 transition-colors duration-fast"
          >
            <Upload size={16} strokeWidth={1.75} />
            Import Loans
          </Link>
          <Link
            href="/loans/import"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-white border border-neutral-200 text-neutral-700 text-sm font-semibold rounded-sm hover:bg-neutral-50 transition-colors duration-fast"
          >
            <Upload size={16} strokeWidth={1.75} />
            Import Repayments
          </Link>
          <Link
            href="/loans/new"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-primary-600 text-white text-sm font-semibold rounded-sm hover:bg-primary-700 transition-colors duration-fast"
          >
            <Plus size={16} strokeWidth={1.75} />
            Record New Loan
          </Link>
        </div>
      )}
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as LoanStatus | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Statuses' },
            ...Object.values(LoanStatus).map((s) => ({ value: s, label: s })),
          ]}
          style={{ width: 160 }}
        />
        <Select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          options={[
            { value: '', label: 'All Months' },
            ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
          ]}
          style={{ width: 130 }}
        />
        <Select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          options={[
            { value: '', label: 'All Years' },
            ...yearOptions.map((y) => ({ value: String(y), label: String(y) })),
          ]}
          style={{ width: 110 }}
        />
        {(filterMonth || filterYear) && (
          <button
            onClick={() => {
              setFilterMonth('');
              setFilterYear('');
            }}
            className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-800"
          >
            <X size={14} strokeWidth={1.75} />
            Clear filters
          </button>
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
                    <SortableTh key={h.id} header={h} />
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
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState
                      heading="No loans found"
                      body={
                        status || filterMonth || filterYear
                          ? 'Try adjusting your filters.'
                          : 'Record the first loan to get started.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/loans/${row.original._id}`)}
                    className="hover:bg-neutral-50 cursor-pointer transition-colors duration-fast"
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
        {data && (
          <Pagination
            page={page}
            total={data.total}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={(n) => { setLimit(n); setPage(1); }}
          />
        )}
      </div>

      {confirmBulkDelete && (
        <Modal
          open
          onClose={() => setConfirmBulkDelete(false)}
          title="Delete Loans"
          size="sm"
          iconKind="danger"
        >
          <p className="mt-2 text-sm text-neutral-600">
            Delete <strong>{selectedIds.length}</strong> selected loan{selectedIds.length === 1 ? '' : 's'}?
            Active loans with recorded payments cannot be deleted. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={bulkDeleteMutation.isPending}
              onClick={() => bulkDeleteMutation.mutate(selectedIds)}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
