'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { ImportBatchStatus } from '@welfare/shared';
import type { IStaffImportBatch } from '@welfare/shared';
import { importStaff, listStaffImportBatches, dismissStaffFlaggedEntry, deleteStaffImportBatch } from '@/lib/staff';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { normalizeExcelDate } from '@/lib/excel-date';
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';

const statusKind: Record<ImportBatchStatus, 'success' | 'warning' | 'info'> = {
  [ImportBatchStatus.Pending]:   'warning',
  [ImportBatchStatus.Resolved]:  'info',
  [ImportBatchStatus.Completed]: 'success',
};

interface PreviewRow {
  staffId: string;
  fullName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  dateOfEmployment: string;
}

function maskDate(value: string): string {
  return value.replace(/\d/g, '•');
}

export default function StaffImportClient() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<{ batchId: string; created: number; flagged: number; total: number } | null>(null);
  const [activeBatch, setActiveBatch] = useState<IStaffImportBatch | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);

  const { data: batchHistory } = useQuery({
    queryKey: ['staff-import-batches'],
    queryFn: () => listStaffImportBatches(),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importStaff(file!, id);
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['staff-import-batches'] });
      toast.success(`Imported: ${data.created} created, ${data.flagged} flagged`);
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Import failed');
    },
  });

  const progress = useImportProgress(importMutation.isPending ? jobId : null);

  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissStaffFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['staff-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteStaffImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['staff-import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });

  function handleFileChange(f: File) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target?.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      setPreview(
        rows.map((r) => ({
          staffId: String(r['Staff ID'] ?? ''),
          fullName: String(r['Full Name'] ?? ''),
          dateOfBirth: normalizeExcelDate(r['Date of Birth'] as string | number | undefined),
          email: String(r['Email'] ?? ''),
          phone: String(r['Phone'] ?? ''),
          dateOfEmployment: normalizeExcelDate(r['Date of Employment'] as string | number | undefined),
        })),
      );
    };
    reader.readAsArrayBuffer(f);
  }

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Upload */}
      <Card>
        <CardHeader
          title="Upload Excel File"
          subtitle="Required columns: Staff ID, Full Name, Date of Birth, Phone, Email, Date of Employment — Optional: PF No, Date of First Contribution, Level, Point"
        />
        <CardBody className="space-y-4">
          <div
            className={cn(
              'border-2 border-dashed border-neutral-200 rounded-sm p-10 text-center cursor-pointer',
              'hover:border-primary-400 hover:bg-primary-50 transition-colors duration-fast',
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFileChange(f);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            />
            <Upload size={32} strokeWidth={1.5} className="mx-auto text-neutral-300 mb-3" />
            {file ? (
              <p className="text-sm text-neutral-700 font-medium">
                {file.name} — {preview.length} rows parsed
              </p>
            ) : (
              <p className="text-sm text-neutral-400">Drop .xlsx file here or click to browse</p>
            )}
          </div>

          {preview.length > 0 && (
            <div className="overflow-x-auto border border-neutral-200 rounded-sm max-h-60">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    {[
                      'Staff ID',
                      'Full Name',
                      'Date of Birth',
                      'Email',
                      'Phone',
                      'Date of Employment',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-semibold text-neutral-500 uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.slice(0, 50).map((row, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-3 py-1.5 font-mono text-neutral-600">
                        {row.staffId || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-700">{row.fullName || '—'}</td>
                      <td className="px-3 py-1.5 font-mono tracking-wide">
                        {row.dateOfBirth ? maskDate(row.dateOfBirth) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500">{row.email || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{row.phone || '—'}</td>
                      <td className="px-3 py-1.5">
                        {row.dateOfEmployment ? fmtDate(row.dateOfEmployment) : '—'}
                      </td>
                    </tr>
                  ))}
                  {preview.length > 50 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-2 text-center text-neutral-400">
                        …and {preview.length - 50} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <Button
            variant="primary"
            Icon={Upload}
            disabled={!file || importMutation.isPending}
            loading={importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            Import
          </Button>
          {importMutation.isPending && progress && (
            <ImportProgressBar processed={progress.processed} total={progress.total} />
          )}
        </CardBody>
      </Card>

      {/* Import result summary */}
      {result && (
        <Card>
          <CardBody className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-success-700">
              <CheckCircle size={18} strokeWidth={1.75} />
              <span className="font-medium">{result.created} created</span>
            </div>
            {result.flagged > 0 && (
              <div className="flex items-center gap-2 text-warning-700">
                <AlertTriangle size={18} strokeWidth={1.75} />
                <span className="font-medium">{result.flagged} flagged</span>
              </div>
            )}
            <span className="text-neutral-500">{result.total} total rows</span>
          </CardBody>
        </Card>
      )}

      {/* Flagged entries for active batch */}
      {activeBatch && activeBatch.flaggedEntries.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader
            title="Flagged Entries"
            subtitle={`${activeBatch.flaggedEntries.length} rows could not be imported`}
          />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Row', 'Staff ID', 'Full Name', 'Reason', ''].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedEntries.map((entry, index) => (
                    <tr key={entry.rowNumber} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-400 text-xs">{entry.rowNumber}</td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">
                        {entry.staffId || '—'}
                      </td>
                      <td className="px-4 py-2 text-neutral-700">{entry.fullName || '—'}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.reason}</td>
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

      {/* Import history */}
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
                    {['File', 'Date', 'Created', 'Flagged', 'Status', ''].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">
                        {batch.fileName}
                      </td>
                      <td className="px-4 py-2 text-neutral-500 text-xs font-mono">
                        {fmtDate(batch.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-success-700 font-medium">
                        {batch.matchedRows}
                      </td>
                      <td className="px-4 py-2 text-warning-700 font-medium">
                        {batch.flaggedRows}
                      </td>
                      <td className="px-4 py-2">
                        <Badge kind={statusKind[batch.status]}>{batch.status}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flaggedRows > 0 && (
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
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Staff already created from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
