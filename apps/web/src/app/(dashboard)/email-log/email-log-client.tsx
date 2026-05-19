'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listEmailLogs,
  runBulkAnnualStatement,
  EmailLogStatus,
  EmailLogType,
  type EmailLogFilters,
} from '../../../lib/email';
import type { IEmailLog } from '@welfare/shared';

const STATUS_BADGE: Record<EmailLogStatus, string> = {
  [EmailLogStatus.Sent]: 'bg-green-100 text-green-700',
  [EmailLogStatus.Failed]: 'bg-red-100 text-red-700',
  [EmailLogStatus.Bounced]: 'bg-yellow-100 text-yellow-700',
};

export function EmailLogClient() {
  const [filters, setFilters] = useState<EmailLogFilters>({ page: 1, limit: 50 });
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['email-logs', filters],
    queryFn: () => listEmailLogs(filters),
  });

  async function handleBulkStatement() {
    setBulkLoading(true);
    setBulkMsg('');
    try {
      await runBulkAnnualStatement();
      setBulkMsg('Annual statement batch enqueued.');
    } catch {
      setBulkMsg('Failed to enqueue batch.');
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={filters.type ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                type: (e.target.value as EmailLogType) || undefined,
                page: 1,
              }))
            }
          >
            <option value="">All</option>
            {Object.values(EmailLogType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                status: (e.target.value as EmailLogStatus) || undefined,
                page: 1,
              }))
            }
          >
            <option value="">All</option>
            {Object.values(EmailLogStatus).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Staff ID</label>
          <input
            className="border rounded px-2 py-1 text-sm w-36"
            placeholder="Filter by staff ID"
            value={filters.staffId ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, staffId: e.target.value || undefined, page: 1 }))
            }
          />
        </div>

        <button
          onClick={() => refetch()}
          className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
        >
          Refresh
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleBulkStatement}
            disabled={bulkLoading}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {bulkLoading ? 'Enqueuing…' : 'Run Annual Statement'}
          </button>
          {bulkMsg && <span className="text-sm text-gray-600">{bulkMsg}</span>}
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && <p className="text-sm text-red-500">Failed to load email logs.</p>}

      {data && (
        <>
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Recipient</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Subject</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Triggered By</th>
                  <th className="px-4 py-2">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((log: IEmailLog) => (
                  <tr key={log._id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{log.recipient.staffName}</div>
                      <div className="text-xs text-gray-400">{log.recipient.email}</div>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{log.type}</td>
                    <td className="px-4 py-2 max-w-xs truncate" title={log.subject}>
                      {log.subject}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[log.status]}`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{log.triggeredBy}</td>
                    <td className="px-4 py-2 text-red-500 text-xs max-w-xs truncate">
                      {log.errorMessage ?? '—'}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      No email logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between text-sm text-gray-500">
            <span>
              {data.total} total · page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={data.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
                className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Prev
              </button>
              <button
                disabled={data.page >= data.totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
