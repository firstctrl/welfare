'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  listEmailLogs,
  runBulkAnnualStatement,
  EmailLogStatus,
  EmailLogType,
  type EmailLogFilters,
} from '../../../lib/email';
import type { IEmailLog } from '@welfare/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, Input } from '@/components/ui/field';
import { fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

const STATUS_KIND: Record<EmailLogStatus, 'success' | 'danger' | 'warning'> = {
  [EmailLogStatus.Sent]:    'success',
  [EmailLogStatus.Failed]:  'danger',
  [EmailLogStatus.Bounced]: 'warning',
};

export function EmailLogClient() {
  const [filters, setFilters] = useState<EmailLogFilters>({ page: 1, limit: 50 });
  const [bulkLoading, setBulkLoading] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['email-logs', filters],
    queryFn: () => listEmailLogs(filters),
  });

  async function handleBulkStatement() {
    setBulkLoading(true);
    try {
      await runBulkAnnualStatement();
      toast.success('Annual statement batch enqueued');
    } catch {
      toast.error('Failed to enqueue batch');
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-white px-4 py-3 rounded-md border border-neutral-200">
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-600">Type</label>
          <Select
            value={filters.type ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, type: (e.target.value as EmailLogType) || undefined, page: 1 }))}
            options={[
              { value: '', label: 'All Types' },
              ...Object.values(EmailLogType).map((t) => ({ value: t, label: t })),
            ]}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-600">Status</label>
          <Select
            value={filters.status ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value as EmailLogStatus) || undefined, page: 1 }))}
            options={[
              { value: '', label: 'All Statuses' },
              ...Object.values(EmailLogStatus).map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-600">Staff ID</label>
          <Input
            placeholder="Filter by staff ID"
            value={filters.staffId ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, staffId: e.target.value || undefined, page: 1 }))}
            style={{ width: 160 }}
          />
        </div>

        <Button variant="secondary" size="sm" Icon={RefreshCw} onClick={() => refetch()}>
          Refresh
        </Button>

        <div className="ml-auto">
          <Button variant="primary" onClick={handleBulkStatement} disabled={bulkLoading} loading={bulkLoading}>
            Run Annual Statement
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
      {isError && <p className="text-sm text-danger-600">Failed to load email logs.</p>}

      {data && (
        <>
          <div className="bg-white rounded-md border border-neutral-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Date', 'Recipient', 'Type', 'Subject', 'Status', 'Triggered By', 'Error'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-neutral-400 text-sm">
                        No email logs found.
                      </td>
                    </tr>
                  ) : (
                    data.items.map((log: IEmailLog) => (
                      <tr key={log._id} className="hover:bg-neutral-50" style={{ height: 'var(--row-compact)' }}>
                        <td className="px-4 py-2 whitespace-nowrap text-neutral-500 text-xs font-mono tabular">
                          {fmtDateTime(new Date(log.createdAt))}
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-neutral-900">{log.recipient.staffName}</div>
                          <div className="text-xs text-neutral-400">{log.recipient.email}</div>
                        </td>
                        <td className="px-4 py-2 text-neutral-600">{log.type}</td>
                        <td className="px-4 py-2 max-w-xs truncate text-neutral-700" title={log.subject}>
                          {log.subject}
                        </td>
                        <td className="px-4 py-2">
                          <Badge kind={STATUS_KIND[log.status]}>{log.status}</Badge>
                        </td>
                        <td className="px-4 py-2 text-neutral-500">{log.triggeredBy}</td>
                        <td className="px-4 py-2 text-danger-600 text-xs max-w-xs truncate">
                          {log.errorMessage ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between text-sm text-neutral-500">
            <span>{data.total} total · page {data.page} of {data.totalPages}</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
