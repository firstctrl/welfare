'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { ImportBatchStatus } from '@welfare/shared';
import type { IClaimImportBatch } from '@welfare/shared';
import {
  importClaims, listClaimImportBatches, resolveClaimFlaggedEntry,
  resolveClaimsByStaffId, dismissClaimFlaggedEntry, clearClaimFlaggedEntries,
} from '@/lib/claims';
import { searchStaff } from '@/lib/staff';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Badge } from '@/components/ui/badge';
import { fmtGHS } from '@/lib/format';
import { cn } from '@/lib/utils';
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
  claimType: string;
  month: number;
  year: number;
  amount: number;
  subReason: string;
}

export default function ImportClient() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<{ batchId: string; matched: number; flagged: number; total: number } | null>(null);
  const [activeBatch, setActiveBatch] = useState<IClaimImportBatch | null>(null);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [bulkResolveTarget, setBulkResolveTarget] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<{ _id: string; fullName: string; staffId: string }[]>([]);
  const [clearTarget, setClearTarget] = useState<{ batchId: string; fileName: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const { data: batchHistory } = useQuery({ queryKey: ['claim-import-batches'], queryFn: () => listClaimImportBatches() });

  interface AggregatedFlag { staffId: string; employeeName: string; occurrences: number; }
  const aggregatedFlags: AggregatedFlag[] = (() => {
    const byStaffId = new Map<string, AggregatedFlag>();
    for (const batch of batchHistory?.data ?? []) {
      if (batch.status === ImportBatchStatus.Completed) continue;
      for (const entry of batch.flaggedEntries) {
        if (!entry.staffId) continue;
        const existing = byStaffId.get(entry.staffId);
        if (existing) existing.occurrences++;
        else byStaffId.set(entry.staffId, { staffId: entry.staffId, employeeName: entry.employeeName, occurrences: 1 });
      }
    }
    return Array.from(byStaffId.values());
  })();

  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importClaims(file!, id);
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success(`Imported: ${data.matched} matched, ${data.flagged} flagged`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Import failed'),
  });

  const progress = useImportProgress(importMutation.isPending ? jobId : null);

  const resolveMutation = useMutation({
    mutationFn: ({ originalId, resolvedId }: { originalId: string; resolvedId: string }) =>
      resolveClaimFlaggedEntry(activeBatch!._id, originalId, resolvedId),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      setResolveTarget(null);
      setStaffSearch(''); setStaffOptions([]);
      toast.success('Entry resolved');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Resolve failed'),
  });

  const bulkResolveMutation = useMutation({
    mutationFn: ({ originalStaffId, resolvedId }: { originalStaffId: string; resolvedId: string }) =>
      resolveClaimsByStaffId(originalStaffId, resolvedId),
    onSuccess: (result) => {
      setBulkResolveTarget(null);
      setStaffSearch(''); setStaffOptions([]);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success(`Mapped ${result.resolvedCount} entries across ${result.batchesUpdated} imports`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Resolve failed'),
  });

  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissClaimFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Dismiss failed'),
  });

  const clearMutation = useMutation({
    mutationFn: (batchId: string) => clearClaimFlaggedEntries(batchId),
    onSuccess: (updated) => {
      setClearTarget(null);
      if (activeBatch && clearTarget?.batchId === activeBatch._id) setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success('Flagged entries cleared');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Clear failed'),
  });

  function handleFileChange(f: File) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target?.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      setPreview(rows.map((r) => ({
        staffId:   String(r['Staff ID'] ?? ''),
        fullName:  String(r['Full Name'] ?? ''),
        claimType: String(r['Claim Type'] ?? ''),
        month:     Number(r['Month'] ?? 0),
        year:      Number(r['Year'] ?? 0),
        amount:    Number(r['Amount'] ?? 0),
        subReason: String(r['Sub Reason'] ?? ''),
      })));
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 1) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data.map((s) => ({ _id: s._id, fullName: s.fullName, staffId: s.staffId })));
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <Card>
        <CardHeader title="Upload Excel File" subtitle="Expected columns: Staff ID, Full Name, Claim Type, Month, Year, Amount, Sub Reason (required only for Cessation)" />
        <CardBody className="space-y-4">
          <div
            className={cn('border-2 border-dashed border-neutral-200 rounded-sm p-10 text-center cursor-pointer', 'hover:border-primary-400 hover:bg-primary-50 transition-colors duration-fast')}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f); }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])} />
            <Upload size={32} strokeWidth={1.5} className="mx-auto text-neutral-300 mb-3" />
            {file ? <p className="text-sm text-neutral-700 font-medium">{file.name} — {preview.length} rows parsed</p> : <p className="text-sm text-neutral-400">Drop .xlsx file here or click to browse</p>}
          </div>

          {preview.length > 0 && (
            <div className="overflow-x-auto border border-neutral-200 rounded-sm max-h-60">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>{['Staff ID','Full Name','Claim Type','Month','Year','Amount','Sub Reason'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.slice(0, 50).map((row, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-3 py-1.5 font-mono text-neutral-600">{row.staffId}</td>
                      <td className="px-3 py-1.5 text-neutral-700">{row.fullName}</td>
                      <td className="px-3 py-1.5">{row.claimType}</td>
                      <td className="px-3 py-1.5">{row.month}</td>
                      <td className="px-3 py-1.5">{row.year}</td>
                      <td className="px-3 py-1.5 font-mono tabular">{fmtGHS(row.amount)}</td>
                      <td className="px-3 py-1.5">{row.subReason}</td>
                    </tr>
                  ))}
                  {preview.length > 50 && <tr><td colSpan={7} className="px-3 py-2 text-center text-neutral-400">…and {preview.length - 50} more rows</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          <Button variant="primary" Icon={Upload} disabled={!file || importMutation.isPending} loading={importMutation.isPending} onClick={() => importMutation.mutate()}>
            Import
          </Button>
          {importMutation.isPending && progress && <ImportProgressBar processed={progress.processed} total={progress.total} />}
        </CardBody>
      </Card>

      {result && (
        <Card>
          <CardBody className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-success-700"><CheckCircle size={18} strokeWidth={1.75} /><span className="font-medium">{result.matched} matched</span></div>
            {result.flagged > 0 && <div className="flex items-center gap-2 text-warning-700"><AlertTriangle size={18} strokeWidth={1.75} /><span className="font-medium">{result.flagged} flagged</span></div>}
            <span className="text-neutral-500">{result.total} total rows</span>
          </CardBody>
        </Card>
      )}

      {activeBatch && activeBatch.flaggedEntries.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries" subtitle={`${activeBatch.flaggedEntries.length} entries need mapping`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b border-neutral-200 bg-neutral-50">{['Staff ID','Employee Name','Amount','Reason','Action'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                ))}</tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedEntries.map((entry, idx) => (
                    <tr key={`${entry.staffId}-${idx}`} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.staffId}</td>
                      <td className="px-4 py-2 text-neutral-700">{entry.employeeName}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(Number(entry.amount))}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.reason}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <button onClick={() => setResolveTarget(entry.staffId)} className="text-primary-600 hover:underline text-xs font-medium">Map to Staff</button>
                          <button onClick={() => dismissMutation.mutate(idx)} disabled={dismissMutation.isPending} className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium">Dismiss</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {aggregatedFlags.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries (All Pending Imports)" subtitle={`${aggregatedFlags.length} Staff IDs need mapping across one or more imports`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b border-neutral-200 bg-neutral-50">{['Staff ID', 'Employee Name', 'Occurrences', 'Action'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                ))}</tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {aggregatedFlags.map((flag) => (
                    <tr key={flag.staffId} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{flag.staffId}</td>
                      <td className="px-4 py-2 text-neutral-700">{flag.employeeName}</td>
                      <td className="px-4 py-2 text-neutral-500">{flag.occurrences} import{flag.occurrences === 1 ? '' : 's'}</td>
                      <td className="px-4 py-2"><button onClick={() => setBulkResolveTarget(flag.staffId)} className="text-primary-600 hover:underline text-xs font-medium">Map to Staff (all imports)</button></td>
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
                <thead><tr className="border-b border-neutral-200 bg-neutral-50">{['File','Matched','Flagged','Status',''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                ))}</tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">{batch.fileName}</td>
                      <td className="px-4 py-2 text-success-700 font-medium">{batch.matchedRows}</td>
                      <td className="px-4 py-2 text-warning-700 font-medium">{batch.flaggedRows}</td>
                      <td className="px-4 py-2"><Badge kind={statusKind[batch.status]}>{batch.status}</Badge></td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flaggedRows > 0 && <button onClick={() => setActiveBatch(batch)} className="text-primary-600 hover:underline text-xs font-medium">Resolve</button>}
                          {batch.flaggedRows > 0 && <button onClick={() => setClearTarget({ batchId: batch._id, fileName: batch.fileName })} className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium">Clear Flagged</button>}
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

      {resolveTarget && (
        <Modal open onClose={() => { setResolveTarget(null); setStaffSearch(''); setStaffOptions([]); }} title={`Map "${resolveTarget}" to Staff`} size="sm" iconKind="warning">
          <div className="mt-3 space-y-3">
            <Input placeholder="Search staff name or ID…" value={staffSearch} onChange={(e) => handleStaffSearch(e.target.value)} autoFocus />
            {staffOptions.length > 0 && (
              <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100 max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <li key={s._id}>
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast" onClick={() => resolveMutation.mutate({ originalId: resolveTarget, resolvedId: s._id })}>
                      <span className="font-medium text-neutral-900">{s.fullName}</span><span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {bulkResolveTarget && (
        <Modal open onClose={() => { setBulkResolveTarget(null); setStaffSearch(''); setStaffOptions([]); }} title={`Map "${bulkResolveTarget}" to Staff (all imports)`} size="sm" iconKind="warning">
          <div className="mt-3 space-y-3">
            <Input placeholder="Search staff name or ID…" value={staffSearch} onChange={(e) => handleStaffSearch(e.target.value)} autoFocus />
            {staffOptions.length > 0 && (
              <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100 max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <li key={s._id}>
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast" disabled={bulkResolveMutation.isPending} onClick={() => bulkResolveMutation.mutate({ originalStaffId: bulkResolveTarget, resolvedId: s._id })}>
                      <span className="font-medium text-neutral-900">{s.fullName}</span><span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!clearTarget}
        title="Clear flagged entries?"
        body={`This clears all flagged rows for "${clearTarget?.fileName}" and marks the import completed. This does not undo any claims already recorded.`}
        confirmLabel="Clear Flagged"
        isPending={clearMutation.isPending}
        onConfirm={() => clearMutation.mutate(clearTarget!.batchId)}
        onClose={() => setClearTarget(null)}
      />
    </div>
  );
}
