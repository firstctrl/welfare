'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { IClaim } from '@welfare/shared';
import { ClaimStatus, ClaimType, AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { listClaims, deleteClaim, bulkDeleteClaims, approveClaim, rejectClaim } from '@/lib/claims';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Select, Input } from '@/components/ui/field';
import { Pagination, SortableTh } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const statusKind: Record<ClaimStatus, 'success' | 'warning' | 'danger'> = {
  [ClaimStatus.Approved]: 'success',
  [ClaimStatus.Pending]:  'warning',
  [ClaimStatus.Rejected]: 'danger',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

type ClaimRow = IClaim & { staffInfo?: { staffId: string; fullName: string } };

export default function ClaimsListClient() {
  const router = useRouter();
  const qc = useQueryClient();
  const permission = usePermission(AppModule.Claims);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<ClaimStatus | ''>('');
  const [claimType, setClaimType] = useState<ClaimType | ''>('');
  const [year, setYear] = useState('');
  const [staffId, setStaffId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ClaimRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ClaimRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['claims', { page, limit, status, claimType, year, staffId }],
    queryFn: () => listClaims({
      page, limit,
      status: status || undefined,
      claimType: claimType || undefined,
      year: year ? parseInt(year, 10) : undefined,
      staffId: staffId || undefined,
    }),
  });

  if (error) toast.error('Failed to load claims');

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveClaim(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['claims'] }); toast.success('Claim approved'); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Approval failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectClaim(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claims'] });
      setRejectTarget(null);
      setRejectReason('');
      toast.success('Claim rejected');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Rejection failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClaim(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['claims'] }); setDeleteTarget(null); toast.success('Claim deleted'); },
    onError: () => toast.error('Failed to delete claim'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteClaims(ids),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['claims'] });
      setRowSelection({});
      setConfirmBulkDelete(false);
      toast.success(`${result.deleted} claim${result.deleted === 1 ? '' : 's'} deleted`);
    },
    onError: () => toast.error('Failed to delete selected claims'),
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  const col = createColumnHelper<ClaimRow>();
  const columns = [
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
    col.display({
      id: 'staff',
      header: 'Staff',
      cell: (i) => {
        const info = i.row.original.staffInfo;
        return info ? (
          <span><span className="font-medium text-neutral-900">{info.fullName}</span><span className="ml-2 font-mono text-xs text-neutral-500">{info.staffId}</span></span>
        ) : <span className="font-mono text-xs text-neutral-400">{i.row.original.staffId}</span>;
      },
    }),
    col.accessor('claimType', { header: 'Type' }),
    col.display({
      id: 'period',
      header: 'Period',
      cell: (i) => <span className="font-mono tabular">{MONTHS[i.row.original.month - 1]} {i.row.original.year}</span>,
    }),
    col.accessor('amount', { header: 'Amount', cell: (i) => <span className="font-mono tabular">{fmtGHS(i.getValue())}</span> }),
    col.accessor('source', { header: 'Source', cell: (i) => <span className="text-xs text-neutral-500">{i.getValue()}</span> }),
    col.accessor('status', { header: 'Status', cell: (i) => <Badge kind={statusKind[i.getValue()]}>{i.getValue()}</Badge> }),
    ...(permission === 'full' ? [col.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: (i) => (
        <div className="flex items-center gap-2">
          {i.row.original.status === ClaimStatus.Pending && (
            <>
              <button onClick={() => approveMutation.mutate(i.row.original._id)} title="Approve" className="text-neutral-400 hover:text-success-600 transition-colors duration-fast p-1 rounded">
                <CheckCircle2 size={14} strokeWidth={1.75} />
              </button>
              <button onClick={() => setRejectTarget(i.row.original)} title="Reject" className="text-neutral-400 hover:text-danger-600 transition-colors duration-fast p-1 rounded">
                <XCircle size={14} strokeWidth={1.75} />
              </button>
            </>
          )}
          <button onClick={() => setDeleteTarget(i.row.original)} title="Delete" className="text-neutral-400 hover:text-danger-600 transition-colors duration-fast p-1 rounded">
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        </div>
      ),
    })] : []),
  ];

  const table = useReactTable({
    data: (data?.data ?? []) as ClaimRow[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / limit) : 0,
    getRowId: (row) => row._id,
    enableRowSelection: permission === 'full',
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: { rowSelection, sorting },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Staff ID" value={staffId} onChange={(e) => { setStaffId(e.target.value); setPage(1); }} style={{ width: 130 }} />
        <Select
          value={claimType}
          onChange={(e) => { setClaimType(e.target.value as ClaimType | ''); setPage(1); }}
          options={[{ value: '', label: 'All Types' }, ...Object.values(ClaimType).map((t) => ({ value: t, label: t }))]}
          style={{ width: 150 }}
        />
        <Input type="number" placeholder="Year" value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} style={{ width: 100 }} />
        <Select
          value={status}
          onChange={(e) => { setStatus(e.target.value as ClaimStatus | ''); setPage(1); }}
          options={[{ value: '', label: 'All Statuses' }, ...Object.values(ClaimStatus).map((s) => ({ value: s, label: s }))]}
          style={{ width: 150 }}
        />
        {selectedIds.length > 0 ? (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-neutral-600">{selectedIds.length} selected</span>
            <Button variant="danger" Icon={Trash2} onClick={() => setConfirmBulkDelete(true)}>
              Delete Selected
            </Button>
          </div>
        ) : (
          data && <span className="ml-auto text-xs text-neutral-400">{data.total.toLocaleString()} records</span>
        )}
      </div>

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
                <tr><td colSpan={columns.length} className="p-0"><TableSkeleton rows={5} cols={columns.length} /></td></tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr><td colSpan={columns.length}><EmptyState heading="No claims found" body="Import legacy claims or record a new one to get started." /></td></tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-neutral-50 cursor-pointer transition-colors duration-fast"
                    style={{ height: 'var(--row-default)' }}
                    onClick={() => router.push(`/claims/${row.original._id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-4 text-neutral-800"
                        onClick={cell.column.id === 'actions' ? (e) => e.stopPropagation() : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && <Pagination page={page} total={data.total} limit={limit} onPageChange={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />}
      </div>

      {rejectTarget && (
        <Modal open onClose={() => { setRejectTarget(null); setRejectReason(''); }} title="Reject Claim" size="sm" iconKind="danger">
          <div className="mt-3 space-y-3">
            <p className="text-sm text-neutral-600">Reject the {rejectTarget.claimType} claim for {rejectTarget.staffInfo?.fullName ?? rejectTarget.staffId}?</p>
            <Input placeholder="Reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason(''); }}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!rejectReason.trim()}
              loading={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ id: rejectTarget._id, reason: rejectReason.trim() })}
            >
              Reject
            </Button>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Claim"
        body={`Delete the ${deleteTarget?.claimType} claim for ${deleteTarget?.staffInfo?.fullName ?? deleteTarget?.staffId}? This cannot be undone.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!._id)}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        open={confirmBulkDelete}
        title="Delete Claims"
        body={`Delete ${selectedIds.length} selected claim${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Delete"
        isPending={bulkDeleteMutation.isPending}
        onConfirm={() => bulkDeleteMutation.mutate(selectedIds)}
        onClose={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
