'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Upload, UserPlus, Trash2 } from 'lucide-react';
import type { IStaff } from '@welfare/shared';
import { StaffStatus, AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { listStaff, bulkDeleteStaff } from '@/lib/staff';
import AddStaffModal from './add-staff-modal';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Pagination, SortableTh } from '@/components/ui/data-table';
import { Avatar } from '@/components/ui/avatar';
import { Modal } from '@/components/ui/modal';
import { fmtDate } from '@/lib/format';

const col = createColumnHelper<IStaff>();

export default function StaffListClient() {
  const router = useRouter();
  const qc = useQueryClient();
  const permission = usePermission(AppModule.Staff);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StaffStatus | ''>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [limit, setLimit] = useState(20);

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff', { page, status, limit }],
    queryFn: () =>
      listStaff({
        page,
        limit,
        status: status || undefined,
      }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteStaff(ids),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setRowSelection({});
      setConfirmBulkDelete(false);
      toast.success(`${result.deleted} staff record${result.deleted === 1 ? '' : 's'} deleted`);
    },
    onError: () => toast.error('Failed to delete selected staff records'),
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

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
      id: 'avatar',
      header: '',
      enableSorting: false,
      cell: (info) => <Avatar name={info.row.original.fullName} size="sm" />,
    }),
    col.accessor('fullName', { header: 'Full Name' }),
    col.accessor('staffId', { header: 'Staff ID' }),
    col.accessor('pfNo', { header: 'PF No' }),
    col.accessor('status', {
      header: 'Status',
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    col.accessor('dateOfEmployment', {
      header: 'Employed',
      cell: (info) => <span className="font-mono tabular">{fmtDate(info.getValue())}</span>,
    }),
  ];

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / limit) : 0,
    getRowId: (row) => row._id,
    enableRowSelection: permission === 'full',
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: { pagination: { pageIndex: page - 1, pageSize: limit }, rowSelection, sorting },
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
        {selectedIds.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-neutral-600">{selectedIds.length} selected</span>
            <Button variant="danger" Icon={Trash2} onClick={() => setConfirmBulkDelete(true)}>
              Delete Selected
            </Button>
          </div>
        )}
        {permission === 'full' && selectedIds.length === 0 && (
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
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState
                      heading="No staff members found"
                      body={
                        status
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

      {showAddModal && (
        <AddStaffModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => setShowAddModal(false)}
        />
      )}

      {confirmBulkDelete && (
        <Modal
          open
          onClose={() => setConfirmBulkDelete(false)}
          title="Delete Staff Records"
          size="sm"
          iconKind="danger"
        >
          <p className="mt-2 text-sm text-neutral-600">
            Delete <strong>{selectedIds.length}</strong> selected staff record{selectedIds.length === 1 ? '' : 's'}?
            Staff with associated loan records cannot be deleted. This cannot be undone.
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
