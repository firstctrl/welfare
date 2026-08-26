'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { AuditEntity, AuditAction } from '@welfare/shared';
import { listAuditLogs, type AuditLog } from '@/lib/audit';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Pagination, SortableTh } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/format';

const FIELD_LABELS: Record<string, string> = {
  staffId: 'Staff ID', fullName: 'Full Name', email: 'Email', phoneNumber: 'Phone',
  dateOfBirth: 'Date of Birth', dateOfEmployment: 'Employment Date',
  dateOfFirstContribution: 'First Contribution', level: 'Level', point: 'Point',
  pfNo: 'PF Number', status: 'Status', paidAmount: 'Paid', expectedAmount: 'Expected',
  surplusCarriedForward: 'Surplus', month: 'Month', year: 'Year', source: 'Source',
  principalAmount: 'Principal', tenureMonths: 'Tenure', disbursedDate: 'Disbursed',
  chequeNo: 'Cheque No', pvNo: 'PV No', outstandingBalance: 'Balance',
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T|$)/;
// ALL_CAPS_UNDERSCORE key (config keys like EMAIL_FROM_ADDRESS)
const SCREAMING_SNAKE_RE = /^[A-Z][A-Z0-9_]+$/;

function fmtVal(v: unknown, field?: string): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') {
    if (ISO_DATE_RE.test(v))
      return new Date(v).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    return v.slice(0, 30);
  }
  if (typeof v === 'number') {
    if (field === 'month') return MONTH_NAMES[(v - 1) % 12] ?? String(v);
    if (field === 'year') return String(v);
    return v.toLocaleString();
  }
  return String(v).slice(0, 30);
}

function labelField(k: string): string {
  if (SCREAMING_SNAKE_RE.test(k))
    return k
      .split('_')
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' ');
  return FIELD_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// CamelCase enum value → spaced label (e.g. RecordPayment → Record Payment)
function fmtLabel(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').trim();
}

const SKIP_KEYS = new Set([
  '_id',
  '__v',
  'createdAt',
  'updatedAt',
  'importBatchId',
  'recordedBy',
  'isDebit',
]);

function DiffCell({
  before,
  after,
}: {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}) {
  if (!before && !after) return <span className="text-neutral-400">—</span>;
  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => !SKIP_KEYS.has(k) && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]),
  );
  if (!changed.length) return <span className="text-neutral-400">—</span>;
  return (
    <div className="max-w-xs space-y-0.5 text-xs text-neutral-600">
      {changed.slice(0, 3).map((k) => (
        <div key={k}>
          <span className="font-medium">{labelField(k)}:</span>{' '}
          {before && k in before && (
            <span className="line-through text-danger-500">{fmtVal(before[k], k)}</span>
          )}
          {before && k in before && after && k in after && ' → '}
          {after && k in after && <span className="text-success-600">{fmtVal(after[k], k)}</span>}
        </div>
      ))}
      {changed.length > 3 && <span className="text-neutral-400">+{changed.length - 3} more</span>}
    </div>
  );
}

const col = createColumnHelper<AuditLog>();

const columns = [
  col.accessor('createdAt', {
    header: 'Timestamp',
    cell: (info) => (
      <span className="text-xs text-neutral-600 whitespace-nowrap font-mono tabular">
        {fmtDateTime(new Date(info.getValue()))}
      </span>
    ),
  }),
  col.accessor('actorName', {
    header: 'Actor',
    cell: (info) => <span className="text-neutral-700">{info.getValue()}</span>,
  }),
  col.accessor('action', {
    header: 'Action',
    cell: (info) => <Badge kind="info">{fmtLabel(info.getValue())}</Badge>,
  }),
  col.accessor('entity', {
    header: 'Module',
    cell: (info) => <span className="text-neutral-700">{fmtLabel(info.getValue())}</span>,
  }),
  col.display({
    id: 'changes',
    header: 'Changes',
    enableSorting: false,
    cell: (info) => <DiffCell before={info.row.original.before} after={info.row.original.after} />,
  }),
];

export default function AuditClient() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState<AuditEntity | ''>('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(50);
  const [sorting, setSorting] = useState<SortingState>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', { page, entity, action, from, to, limit }],
    queryFn: () =>
      listAuditLogs({
        page,
        limit,
        entity: entity || undefined,
        action: action || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    staleTime: 30_000,
  });

  const hasFilters = !!(entity || action || from || to);

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row._id,
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 items-center bg-white px-4 py-3 rounded-md border border-neutral-200 overflow-x-auto">
        <Select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value as AuditEntity | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Modules' },
            ...Object.values(AuditEntity).map((e) => ({ value: e, label: fmtLabel(e) })),
          ]}
          style={{ width: 150, flexShrink: 0 }}
        />
        <Select
          value={action}
          onChange={(e) => {
            setAction(e.target.value as AuditAction | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Actions' },
            ...Object.values(AuditAction).map((a) => ({ value: a, label: fmtLabel(a) })),
          ]}
          style={{ width: 150, flexShrink: 0 }}
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          style={{ width: 140, flexShrink: 0 }}
        />
        <span className="text-xs text-neutral-400 whitespace-nowrap">to</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          style={{ width: 140, flexShrink: 0 }}
        />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEntity('');
              setAction('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
            style={{ flexShrink: 0 }}
          >
            Clear
          </Button>
        )}
        {data && (
          <span className="ml-auto text-xs text-neutral-500 whitespace-nowrap">
            {data.total.toLocaleString()} records
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-md border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
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
                  <td colSpan={columns.length} className="p-2">
                    <TableSkeleton rows={8} cols={columns.length} />
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState
                      heading="No audit logs found"
                      body={
                        hasFilters
                          ? 'Try adjusting your filters.'
                          : 'Actions will appear here as they occur.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-neutral-50"
                    style={{ height: 'var(--row-default)' }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2 text-neutral-800">
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
          <div className="px-4 py-3 border-t border-neutral-200">
            <Pagination
              page={page}
              total={data.total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(n) => { setLimit(n); setPage(1); }}
              limitOptions={[10, 20, 50, 100, 200]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
