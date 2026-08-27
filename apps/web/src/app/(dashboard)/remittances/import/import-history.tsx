'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IRemittanceImportBatch } from '@welfare/shared';
import {
  listRemittanceImportBatches,
  dismissRemittanceFlaggedEntry,
  deleteRemittanceImportBatch,
} from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { fmtDate } from '@/lib/format';

export function ImportHistory() {
  const qc = useQueryClient();
  const [activeBatch, setActiveBatch] = useState<IRemittanceImportBatch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);

  const { data: batchHistory } = useQuery({
    queryKey: ['remittance-import-batches'],
    queryFn: () => listRemittanceImportBatches(),
  });

  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissRemittanceFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['remittance-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteRemittanceImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['remittance-import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });

  return (
    <>
      {activeBatch && activeBatch.flaggedRows.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries" subtitle={`${activeBatch.flaggedRows.length} rows could not be imported`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Row', 'Period', 'Reason', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedRows.map((entry, index) => (
                    <tr key={entry.rowNumber} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-400 text-xs">{entry.rowNumber}</td>
                      <td className="px-4 py-2 text-neutral-700">{entry.month || '—'}/{entry.year || '—'}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.flagReason}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => dismissMutation.mutate(index)}
                          disabled={dismissMutation.isPending}
                          className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                        >
                          Dismiss
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Import History" />
        <CardBody noPadding>
          {!batchHistory?.data.length ? (
            <p className="px-5 py-4 text-sm text-neutral-400">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['File', 'Date', 'Imported', 'Flagged', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">{batch.fileName}</td>
                      <td className="px-4 py-2 text-neutral-500 text-xs font-mono">{fmtDate(batch.createdAt)}</td>
                      <td className="px-4 py-2 text-success-700 font-medium">{batch.imported}</td>
                      <td className="px-4 py-2 text-warning-700 font-medium">{batch.flagged}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flagged > 0 && (
                            <button
                              onClick={() => setActiveBatch(batch)}
                              className="text-primary-600 hover:underline text-xs font-medium"
                            >
                              View Flagged
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ batchId: batch._id, fileName: batch.fileName })}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this import?"
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Remittances already created from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
