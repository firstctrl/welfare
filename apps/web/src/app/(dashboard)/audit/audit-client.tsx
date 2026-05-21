'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AuditEntity, AuditAction } from '@welfare/shared';
import { listAuditLogs, type AuditLog } from '@/lib/audit';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/format';

function DiffCell({
  before,
  after,
}: {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}) {
  if (!before && !after) return <span className="text-neutral-400">—</span>;
  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]),
  );
  if (!changed.length) return <span className="text-neutral-400">—</span>;
  return (
    <div className="max-w-xs space-y-0.5 text-xs text-neutral-600">
      {changed.slice(0, 3).map((k) => (
        <div key={k}>
          <span className="font-medium">{k}:</span>{' '}
          <span className="line-through text-danger-500">
            {String(before?.[k] ?? '∅').slice(0, 20)}
          </span>
          {' → '}
          <span className="text-success-600">
            {String(after?.[k] ?? '∅').slice(0, 20)}
          </span>
        </div>
      ))}
      {changed.length > 3 && (
        <span className="text-neutral-400">+{changed.length - 3} more</span>
      )}
    </div>
  );
}

export default function AuditClient() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState<AuditEntity | ''>('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['audit', { page, entity, action, from, to }],
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

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const hasFilters = !!(entity || action || from || to);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end bg-white px-4 py-3 rounded-md border border-neutral-200">
        <Select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value as AuditEntity | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Entities' },
            ...Object.values(AuditEntity).map((e) => ({ value: e, label: e })),
          ]}
        />
        <Select
          value={action}
          onChange={(e) => {
            setAction(e.target.value as AuditAction | '');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Actions' },
            ...Object.values(AuditAction).map((a) => ({ value: a, label: a })),
          ]}
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          style={{ width: 150 }}
        />
        <span className="text-xs text-neutral-400 self-center">to</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          style={{ width: 150 }}
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
          >
            Clear
          </Button>
        )}
        {data && (
          <span className="ml-auto text-xs text-neutral-500">
            {data.total.toLocaleString()} records
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-md border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                {['Timestamp', 'Actor', 'Action', 'Entity', 'Entity ID', 'Changes'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-2">
                    <TableSkeleton rows={8} cols={6} />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td colSpan={6}>
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
                data.data.map((log: AuditLog) => (
                  <tr
                    key={log._id}
                    className="hover:bg-neutral-50"
                    style={{ height: 'var(--row-default)' }}
                  >
                    <td className="px-4 py-2 text-xs text-neutral-600 whitespace-nowrap font-mono tabular">
                      {fmtDateTime(new Date(log.createdAt))}
                    </td>
                    <td className="px-4 py-2 text-neutral-700">{log.actorName}</td>
                    <td className="px-4 py-2">
                      <Badge kind="info">{log.action}</Badge>
                    </td>
                    <td className="px-4 py-2 text-neutral-700">{log.entity}</td>
                    <td className="px-4 py-2 text-xs text-neutral-500 font-mono">
                      {log.entityId.slice(-8)}
                    </td>
                    <td className="px-4 py-2">
                      <DiffCell before={log.before} after={log.after} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && totalPages > 1 && (
          <div className="px-4 py-3 border-t border-neutral-200">
            <Pagination page={page} total={data.total} limit={limit} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
