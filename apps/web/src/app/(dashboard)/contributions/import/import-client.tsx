'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { ImportBatchStatus } from '@welfare/shared';
import type { IImportBatch } from '@welfare/shared';
import { importContributions, listImportBatches, resolveFlaggedEntry } from '@/lib/contributions';
import { searchStaff } from '@/lib/staff';

const STATUS_BADGE: Record<ImportBatchStatus, string> = {
  [ImportBatchStatus.Pending]:   'bg-yellow-100 text-yellow-800',
  [ImportBatchStatus.Resolved]:  'bg-blue-100 text-blue-700',
  [ImportBatchStatus.Completed]: 'bg-green-100 text-green-800',
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

  const { data: batchHistory } = useQuery({
    queryKey: ['import-batches'],
    queryFn: () => listImportBatches(),
  });

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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Import failed');
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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Resolve failed');
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
    <div className="space-y-6 max-w-5xl">
      {/* Upload section */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="font-medium text-gray-900">Upload Excel File</h2>
        <p className="text-sm text-gray-500">
          Expected columns: <code className="bg-gray-100 px-1 rounded">Staff ID</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Employee Name</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Month</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Year</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Amount</code>
        </p>

        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f); }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
          />
          {file ? (
            <p className="text-sm text-gray-700">{file.name} — {preview.length} rows parsed</p>
          ) : (
            <p className="text-sm text-gray-400">Drop .xlsx file here or click to browse</p>
          )}
        </div>

        <div className="flex gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Month override (optional)</label>
            <input
              type="number" min="1" max="12" value={monthOverride}
              onChange={(e) => setMonthOverride(e.target.value)}
              placeholder="From sheet"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Year override (optional)</label>
            <input
              type="number" min="2000" value={yearOverride}
              onChange={(e) => setYearOverride(e.target.value)}
              placeholder="From sheet"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {preview.length > 0 && (
          <div className="overflow-x-auto rounded border border-gray-200 max-h-64">
            <table className="min-w-full text-xs divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['Staff ID', 'Employee Name', 'Month', 'Year', 'Amount'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {preview.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-gray-700">{row.staffId}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.employeeName}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.month}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.year}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.amount.toLocaleString()}</td>
                  </tr>
                ))}
                {preview.length > 50 && (
                  <tr><td colSpan={5} className="px-3 py-2 text-center text-gray-400">...and {preview.length - 50} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <button
          disabled={!file || importMutation.isPending}
          onClick={() => importMutation.mutate()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {importMutation.isPending ? 'Importing...' : 'Import'}
        </button>
      </div>

      {result && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-2">
          <h2 className="font-medium text-gray-900">Import Result</h2>
          <div className="flex gap-6 text-sm">
            <span className="text-green-700">✓ {result.matched} matched</span>
            {result.flagged > 0 && <span className="text-yellow-700">⚠ {result.flagged} flagged</span>}
            <span className="text-gray-500">{result.total} total rows</span>
          </div>
        </div>
      )}

      {activeBatch && activeBatch.flaggedEntries.length > 0 && (
        <div className="bg-white border border-yellow-200 rounded-xl p-6 space-y-4">
          <h2 className="font-medium text-yellow-800">Flagged Entries — {activeBatch.flaggedEntries.length} remaining</h2>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Staff ID', 'Employee Name', 'Amount', 'Reason', 'Action'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeBatch.flaggedEntries.map((entry) => (
                  <tr key={entry.staffId}>
                    <td className="px-3 py-2 text-gray-700">{entry.staffId}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.employeeName}</td>
                    <td className="px-3 py-2 text-gray-700">{Number(entry.amount).toLocaleString()}</td>
                    <td className="px-3 py-2 text-red-600 text-xs">{entry.reason}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setResolveTarget(entry.staffId)}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Map to Staff
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {resolveTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
                <h3 className="font-semibold text-gray-900">Map &quot;{resolveTarget}&quot; to Staff</h3>
                <input
                  placeholder="Search staff name or ID..."
                  value={staffSearch}
                  onChange={(e) => handleStaffSearch(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                {staffOptions.length > 0 && (
                  <ul className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {staffOptions.map((s) => (
                      <li key={s._id}>
                        <button
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                          onClick={() => resolveMutation.mutate({ originalId: resolveTarget, resolvedId: s._id })}
                        >
                          {s.fullName} <span className="text-gray-400 text-xs">{s.staffId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex justify-end">
                  <button onClick={() => setResolveTarget(null)} className="text-sm text-gray-500 hover:text-gray-700">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
        <h2 className="font-medium text-gray-900">Import History</h2>
        {batchHistory?.data.length === 0 ? (
          <p className="text-sm text-gray-400">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['File', 'Period', 'Matched', 'Flagged', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batchHistory?.data.map((batch) => (
                  <tr key={batch._id}>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-xs">{batch.fileName}</td>
                    <td className="px-3 py-2 text-gray-700">{batch.month}/{batch.year}</td>
                    <td className="px-3 py-2 text-green-700">{batch.matchedRows}</td>
                    <td className="px-3 py-2 text-yellow-700">{batch.flaggedRows}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[batch.status]}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {batch.flaggedRows > 0 && (
                        <button
                          onClick={() => setActiveBatch(batch)}
                          className="text-blue-600 hover:underline text-xs"
                        >
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
      </div>
    </div>
  );
}
