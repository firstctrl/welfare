'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AuditEntity, AuditAction } from '@welfare/shared';
import { listAuditLogs, type AuditLog } from '@/lib/audit';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const inputClass =
  'border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function DiffCell({
  before,
  after,
}: {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}) {
  if (!before && !after) return <span className="text-gray-400">—</span>;
  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]),
  );
  if (!changed.length) return <span className="text-gray-400">—</span>;
  return (
    <div className="max-w-xs space-y-0.5 text-xs text-gray-600">
      {changed.slice(0, 3).map((k) => (
        <div key={k}>
          <span className="font-medium">{k}:</span>{' '}
          <span className="line-through text-red-500">
            {String(before?.[k] ?? '∅').slice(0, 20)}
          </span>
          {' → '}
          <span className="text-green-600">
            {String(after?.[k] ?? '∅').slice(0, 20)}
          </span>
        </div>
      ))}
      {changed.length > 3 && (
        <span className="text-gray-400">+{changed.length - 3} more</span>
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
      <div className="flex flex-wrap gap-2 items-center bg-white p-3 rounded-lg border border-gray-200">
        <select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value as AuditEntity | '');
            setPage(1);
          }}
          className={inputClass}
        >
          <option value="">All Entities</option>
          {Object.values(AuditEntity).map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value as AuditAction | '');
            setPage(1);
          }}
          className={inputClass}
        >
          <option value="">All Actions</option>
          {Object.values(AuditAction).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className={inputClass}
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className={inputClass}
        />
        {hasFilters && (
          <button
            onClick={() => {
              setEntity('');
              setAction('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear
          </button>
        )}
        {data && (
          <span className="ml-auto text-xs text-gray-500">{data.total} records</span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Timestamp', 'Actor', 'Action', 'Entity', 'Entity ID', 'Changes'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
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
                      title="No audit logs found"
                      description={
                        hasFilters
                          ? 'Try adjusting your filters.'
                          : 'Actions will appear here as they occur.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                data.data.map((log: AuditLog) => (
                  <tr key={log._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{log.actorName}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{log.entity}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                      {log.entityId.slice(-8)}
                    </td>
                    <td className="px-4 py-3">
                      <DiffCell before={log.before} after={log.after} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
