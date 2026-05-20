'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { ImportBatchStatus } from '@welfare/shared';
import type { IImportBatch } from '@welfare/shared';
import { importContributions, listImportBatches, resolveFlaggedEntry } from '@/lib/contributions';
import { searchStaff } from '@/lib/staff';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { fmtGHS } from '@/lib/format';
import { cn } from '@/lib/utils';

const statusKind: Record<ImportBatchStatus, 'success' | 'warning' | 'info'> = {
  [ImportBatchStatus.Pending]:   'warning',
  [ImportBatchStatus.Resolved]:  'info',
  [ImportBatchStatus.Completed]: 'success',
};

interface PreviewRow {
  staffId: string;
  employeeName: string;
  month: number;
  year: number;
  amount: number;
}

export default function ImportClient() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [monthOverride, setMonthOverride] = useState('');
  const [yearOverride, setYearOverride] = useState('');
  const [result, setResult] = useState<{ batchId: string; matched: number; flagged: number; total: number } | null>(null);
  const [activeBatch, setActiveBatch] = useState<IImportBatch | null>(null);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<{ _id: string; fullName: string; staffId: string }[]>([]);

  const { data: batchHistory } = useQuery({ queryKey: ['import-batches'], queryFn: () => listImportBatches() });

  const importMutation = useMutation({
    mutationFn: () => importContributions(
      file!,
      monthOverride ? parseInt(monthOverride, 10) : undefined,
      yearOverride ? parseInt(yearOverride, 10) : undefined,
    ),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['import-batches'] });
      toast.success(`Imported: ${data.matched} matched, ${data.flagged} flagged`);
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Import failed');
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ originalId, resolvedId }: { originalId: string; resolvedId: string }) =>
      resolveFlaggedEntry(activeBatch!._id, originalId, resolvedId),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      setResolveTarget(null);
      setStaffSearch('');
      setStaffOptions([]);
      toast.success('Entry resolved');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Resolve failed');
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
      setPreview(rows.map((r) => ({
        staffId:      String(r['Staff ID'] ?? ''),
        employeeName: String(r['Employee Name'] ?? ''),
        month:        Number(r['Month'] ?? 0),
        year:         Number(r['Year'] ?? 0),
        amount:       Number(r['Amount'] ?? 0),
      })));
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 2) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data.map((s) => ({ _id: s._id, fullName: s.fullName, staffId: s.staffId })));
  }

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Upload */}
      <Card>
        <CardHeader title="Upload Excel File" subtitle="Expected columns: Staff ID, Employee Name, Month, Year, Amount" />
        <CardBody className="space-y-4">
          <div
            className={cn(
              'border-2 border-dashed border-neutral-200 rounded-sm p-10 text-center cursor-pointer',
              'hover:border-primary-400 hover:bg-primary-50 transition-colors duration-fast',
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f); }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])} />
            <Upload size={32} strokeWidth={1.5} className="mx-auto text-neutral-300 mb-3" />
            {file ? (
              <p className="text-sm text-neutral-700 font-medium">{file.name} — {preview.length} rows parsed</p>
            ) : (
              <p className="text-sm text-neutral-400">Drop .xlsx file here or click to browse</p>
            )}
          </div>

          <div className="flex gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-600">Month override (optional)</label>
              <Input type="number" min="1" max="12" value={monthOverride}
                onChange={(e) => setMonthOverride(e.target.value)} placeholder="From sheet" style={{ width: 130 }} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-600">Year override (optional)</label>
              <Input type="number" min="2000" value={yearOverride}
                onChange={(e) => setYearOverride(e.target.value)} placeholder="From sheet" style={{ width: 130 }} />
            </div>
          </div>

          {preview.length > 0 && (
            <div className="overflow-x-auto border border-neutral-200 rounded-sm max-h-60">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    {['Staff ID','Employee Name','Month','Year','Amount'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.slice(0, 50).map((row, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-3 py-1.5 font-mono text-neutral-600">{row.staffId}</td>
                      <td className="px-3 py-1.5 text-neutral-700">{row.employeeName}</td>
                      <td className="px-3 py-1.5">{row.month}</td>
                      <td className="px-3 py-1.5">{row.year}</td>
                      <td className="px-3 py-1.5 font-mono tabular">{fmtGHS(row.amount)}</td>
                    </tr>
                  ))}
                  {preview.length > 50 && (
                    <tr><td colSpan={5} className="px-3 py-2 text-center text-neutral-400">…and {preview.length - 50} more rows</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <Button variant="primary" Icon={Upload} disabled={!file || importMutation.isPending} loading={importMutation.isPending} onClick={() => importMutation.mutate()}>
            Import
          </Button>
        </CardBody>
      </Card>

      {result && (
        <Card>
          <CardBody className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-success-700">
              <CheckCircle size={18} strokeWidth={1.75} />
              <span className="font-medium">{result.matched} matched</span>
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

      {activeBatch && activeBatch.flaggedEntries.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title={`Flagged Entries`} subtitle={`${activeBatch.flaggedEntries.length} entries need mapping`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Staff ID','Employee Name','Amount','Reason','Action'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedEntries.map((entry) => (
                    <tr key={entry.staffId} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.staffId}</td>
                      <td className="px-4 py-2 text-neutral-700">{entry.employeeName}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(Number(entry.amount))}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.reason}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => setResolveTarget(entry.staffId)} className="text-primary-600 hover:underline text-xs font-medium">
                          Map to Staff
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
                    {['File','Period','Matched','Flagged','Status',''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">{batch.fileName}</td>
                      <td className="px-4 py-2 text-neutral-600">{batch.month}/{batch.year}</td>
                      <td className="px-4 py-2 text-success-700 font-medium">{batch.matchedRows}</td>
                      <td className="px-4 py-2 text-warning-700 font-medium">{batch.flaggedRows}</td>
                      <td className="px-4 py-2"><Badge kind={statusKind[batch.status]}>{batch.status}</Badge></td>
                      <td className="px-4 py-2">
                        {batch.flaggedRows > 0 && (
                          <button onClick={() => setActiveBatch(batch)} className="text-primary-600 hover:underline text-xs font-medium">
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Resolve Modal */}
      {resolveTarget && (
        <Modal
          open
          onClose={() => { setResolveTarget(null); setStaffSearch(''); setStaffOptions([]); }}
          title={`Map "${resolveTarget}" to Staff`}
          size="sm"
          iconKind="warning"
        >
          <div className="mt-3 space-y-3">
            <Input
              placeholder="Search staff name or ID…"
              value={staffSearch}
              onChange={(e) => handleStaffSearch(e.target.value)}
              autoFocus
            />
            {staffOptions.length > 0 && (
              <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100 max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <li key={s._id}>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast"
                      onClick={() => resolveMutation.mutate({ originalId: resolveTarget, resolvedId: s._id })}
                    >
                      <span className="font-medium text-neutral-900">{s.fullName}</span>
                      <span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
