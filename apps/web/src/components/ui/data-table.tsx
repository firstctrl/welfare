'use client';

import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Table as TTable,
  type RowData,
  type Header,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Select } from './field';

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function SortIcon({ dir }: { dir: false | 'asc' | 'desc' }) {
  if (dir === 'asc') return <ChevronUp size={13} strokeWidth={2} />;
  if (dir === 'desc') return <ChevronDown size={13} strokeWidth={2} />;
  return <ChevronsUpDown size={13} strokeWidth={1.75} className="opacity-30" />;
}

export function SortableTh<TData extends RowData>({ header }: { header: Header<TData, unknown> }) {
  const canSort = header.column.getCanSort();
  return (
    <th
      className="px-4 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap"
      style={{ height: 'var(--row-default)' }}
    >
      {header.isPlaceholder ? null : canSort ? (
        <button
          type="button"
          onClick={header.column.getToggleSortingHandler()}
          className="inline-flex items-center gap-1 hover:text-neutral-800 transition-colors duration-fast"
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
          <SortIcon dir={header.column.getIsSorted()} />
        </button>
      ) : (
        flexRender(header.column.columnDef.header, header.getContext())
      )}
    </th>
  );
}

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
  className?: string;
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  onRowClick,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable<TData>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-base">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
              {hg.headers.map((header) => (
                <SortableTh key={header.id} header={header} />
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                'transition-colors duration-fast',
                onRowClick && 'cursor-pointer hover:bg-neutral-50',
              )}
              style={{ height: 'var(--row-default)' }}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 text-neutral-800">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
}

export function Pagination({
  page,
  total,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = Math.min((page - 1) * limit + 1, total);
  const to = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200">
      <div className="flex items-center gap-4">
        <span className="text-sm text-neutral-500">
          {total === 0 ? 'No results' : `${from}–${to} of ${total}`}
        </span>
        {onLimitChange && (
          <label className="flex items-center gap-2 text-sm text-neutral-500">
            Records per page
            <Select
              value={String(limit)}
              onChange={(e) => onLimitChange(parseInt(e.target.value, 10))}
              options={limitOptions.map((n) => ({ value: String(n), label: String(n) }))}
              style={{ width: 80, height: 32 }}
            />
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} strokeWidth={1.75} />
        </Button>
        <span className="px-3 text-sm text-neutral-700 font-medium">
          {page} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={16} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}
