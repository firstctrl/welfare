'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Upload, Download, CheckCircle, AlertTriangle } from 'lucide-react';
import { ImportBatchStatus } from '@welfare/shared';
import type { ILoanLegacyImportBatch } from '@welfare/shared';
import { importLegacyLoans, listLegacyImportBatches, dismissLegacyFlaggedEntry, clearLegacyFlaggedEntries } from '@/lib/loans';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { fmtGHS, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';

const statusKind: Record<ImportBatchStatus, 'success' | 'warning' | 'info'> = {
  [ImportBatchStatus.Pending]:   'warning',
  [ImportBatchStatus.Resolved]:  'info',
  [ImportBatchStatus.Completed]: 'success',
};

function downloadSampleTemplate() {
  const loanRows = [
    {
      'Loan Ref': 'L1',
      'Staff ID': 'S001',
      'Guarantor Staff ID': 'S002',
      'Principal Amount': 6000,
      'Tenure Months': 2,
      'Disbursed Date': '15/06/2024',
      'Status': 'Active',
      'Cutover Date': '01/01/2026',
      'Guarantor Restitution Owed': 0,
      'Guarantor Restitution Paid': 0,
      'Cheque No': 'CHQ-1001',
      'PV No': 'PV-2001',
      'Notes': 'Migrated from old system',
    },
    {
      'Loan Ref': 'L2',
      'Staff ID': 'S003',
      'Guarantor Staff ID': 'S004',
      'Principal Amount': 4000,
      'Tenure Months': 1,
      'Disbursed Date': '01/03/2024',
      'Status': 'Completed',
      'Cutover Date': '01/01/2026',
      'Guarantor Restitution Owed': 0,
      'Guarantor Restitution Paid': 0,
      'Cheque No': 'CHQ-1002',
      'PV No': 'PV-2002',
      'Notes': '',
    },
  ];
  const instalmentRows = [
    { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/07/2024', 'Due Amount': 3000, 'Paid Amount': 3000, 'Paid Date': '03/07/2024', 'Status': 'Paid' },
    { 'Loan Ref': 'L1', 'Instalment Number': 2, 'Due Date': '05/08/2024', 'Due Amount': 3000, 'Paid Amount': 0, 'Paid Date': '', 'Status': 'Pending' },
    { 'Loan Ref': 'L2', 'Instalment Number': 1, 'Due Date': '05/04/2024', 'Due Amount': 4000, 'Paid Amount': 4000, 'Paid Date': '03/04/2024', 'Status': 'Paid' },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loanRows), 'Loans');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instalmentRows), 'Instalments');
  XLSX.writeFile(wb, 'legacy-loan-import-sample.xlsx');
}

const FIELD_REFERENCE: { sheet: string; field: string; rule: string }[] = [
  { sheet: 'Loans', field: 'Loan Ref', rule: 'Your own choice per loan (e.g. "L1", or the old system’s loan number). Must be unique within the Loans sheet and match exactly on that loan’s Instalments rows.' },
  { sheet: 'Loans', field: 'Staff ID / Guarantor Staff ID', rule: 'Must match an existing staff member’s Staff ID (the business ID on their profile, not their name).' },
  { sheet: 'Loans', field: 'Principal Amount', rule: 'Number greater than 0.' },
  { sheet: 'Loans', field: 'Tenure Months', rule: 'Whole number, 1 or more.' },
  { sheet: 'Loans', field: 'Disbursed Date', rule: 'Required. Use a real Excel date, or text as DD/MM/YYYY.' },
  { sheet: 'Loans', field: 'Status', rule: 'Exact match, one of: Active, Completed, Defaulted, WrittenOff, BadDebt.' },
  { sheet: 'Loans', field: 'Cutover Date', rule: 'Required. Arrears dated before this are frozen from automated overdue/default jobs; on or after it, they’re treated like a normal loan.' },
  { sheet: 'Loans', field: 'Guarantor Restitution Owed / Paid', rule: 'Optional numbers, default 0 if left blank.' },
  { sheet: 'Loans', field: 'Cheque No / PV No / Notes', rule: 'Optional free text.' },
  { sheet: 'Instalments', field: 'Loan Ref', rule: 'Must exactly match a Loan Ref from the Loans sheet. A ref that matches nothing is flagged, not silently dropped.' },
  { sheet: 'Instalments', field: 'Instalment Number', rule: 'Whole number starting at 1 (not 0). Must be unique within the same Loan Ref.' },
  { sheet: 'Instalments', field: 'Due Date', rule: 'Required. Same date format as above.' },
  { sheet: 'Instalments', field: 'Due Amount', rule: 'Number greater than 0.' },
  { sheet: 'Instalments', field: 'Paid Amount', rule: 'Number, 0 or more (blank = 0). Not checked against Due Amount — your figures are trusted as-is.' },
  { sheet: 'Instalments', field: 'Paid Date', rule: 'Required only when Status is Paid or Partial; otherwise leave blank.' },
  { sheet: 'Instalments', field: 'Status', rule: 'Exact match, one of: Pending, Paid, Partial, Overdue, Waived.' },
];

interface PreviewRow {
  loanRef: string;
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  tenureMonths: number;
  disbursedDate: string;
  status: string;
  cutoverDate: string;
  instalmentCount: number;
}

export default function LoanLegacyImportClient() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<{ batchId: string; created: number; flagged: number; total: number } | null>(null);
  const [activeBatch, setActiveBatch] = useState<ILoanLegacyImportBatch | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<{ batchId: string; fileName: string } | null>(null);

  const { data: batchHistory } = useQuery({
    queryKey: ['loan-legacy-import-batches'],
    queryFn: () => listLegacyImportBatches(),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importLegacyLoans(file!, id);
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['loan-legacy-import-batches'] });
      toast.success(`Imported: ${data.created} created, ${data.flagged} flagged`);
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Import failed');
    },
  });

  const progress = useImportProgress(importMutation.isPending ? jobId : null);

  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissLegacyFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['loan-legacy-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const clearMutation = useMutation({
    mutationFn: (batchId: string) => clearLegacyFlaggedEntries(batchId),
    onSuccess: (updated) => {
      setClearTarget(null);
      if (activeBatch && clearTarget?.batchId === activeBatch._id) setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['loan-legacy-import-batches'] });
      toast.success('Flagged entries cleared');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Clear failed');
    },
  });

  function handleFileChange(f: File) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target?.result, { type: 'array' });
      const loansSheet = wb.Sheets['Loans'];
      const instalmentsSheet = wb.Sheets['Instalments'];
      if (!loansSheet) { setPreview([]); return; }

      const loanRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(loansSheet);
      const instalmentRows = instalmentsSheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(instalmentsSheet) : [];

      const instalmentCounts = new Map<string, number>();
      for (const row of instalmentRows) {
        const ref = String(row['Loan Ref'] ?? '').trim();
        if (!ref) continue;
        instalmentCounts.set(ref, (instalmentCounts.get(ref) ?? 0) + 1);
      }

      setPreview(loanRows.map((r) => {
        const loanRef = String(r['Loan Ref'] ?? '').trim();
        return {
          loanRef,
          staffId:         String(r['Staff ID']               ?? ''),
          guarantorId:     String(r['Guarantor Staff ID']      ?? ''),
          principalAmount: Number(r['Principal Amount']        ?? 0),
          tenureMonths:    Number(r['Tenure Months']           ?? 0),
          disbursedDate:   String(r['Disbursed Date']          ?? ''),
          status:          String(r['Status']                 ?? ''),
          cutoverDate:     String(r['Cutover Date']            ?? ''),
          instalmentCount: instalmentCounts.get(loanRef) ?? 0,
        };
      }));
    };
    reader.readAsArrayBuffer(f);
  }

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Upload */}
      <Card>
        <CardHeader
          title="Upload Excel File"
          subtitle='Two sheets required: "Loans" (Loan Ref, Staff ID, Guarantor Staff ID, Principal Amount, Tenure Months, Disbursed Date, Status, Cutover Date, Guarantor Restitution Owed, Guarantor Restitution Paid, Cheque No, PV No) and "Instalments" (Loan Ref, Instalment Number, Due Date, Due Amount, Paid Amount, Paid Date, Status)'
          action={
            <Button variant="secondary" size="sm" Icon={Download} onClick={downloadSampleTemplate}>
              Download Sample Template
            </Button>
          }
        />
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
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            />
            <Upload size={32} strokeWidth={1.5} className="mx-auto text-neutral-300 mb-3" />
            {file ? (
              <p className="text-sm text-neutral-700 font-medium">{file.name} — {preview.length} loans parsed</p>
            ) : (
              <p className="text-sm text-neutral-400">Drop .xlsx file here or click to browse</p>
            )}
          </div>

          {preview.length > 0 && (
            <div className="overflow-x-auto border border-neutral-200 rounded-sm max-h-60">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    {['Loan Ref', 'Staff ID', 'Guarantor ID', 'Principal', 'Tenure', 'Disbursed', 'Status', 'Cutover', 'Instalments'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.slice(0, 50).map((row, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-3 py-1.5 font-mono text-xs text-neutral-600">{row.loanRef || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-neutral-600">{row.staffId || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-neutral-600">{row.guarantorId || '—'}</td>
                      <td className="px-3 py-1.5 font-mono tabular">{fmtGHS(row.principalAmount)}</td>
                      <td className="px-3 py-1.5 text-center">{row.tenureMonths || '—'}</td>
                      <td className="px-3 py-1.5">{row.disbursedDate || '—'}</td>
                      <td className="px-3 py-1.5">{row.status || '—'}</td>
                      <td className="px-3 py-1.5">{row.cutoverDate || '—'}</td>
                      <td className={cn('px-3 py-1.5 text-center', row.instalmentCount === 0 && 'text-danger-600 font-medium')}>
                        {row.instalmentCount}
                      </td>
                    </tr>
                  ))}
                  {preview.length > 50 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-2 text-center text-neutral-400">
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

      {/* Field reference */}
      <Card>
        <CardHeader title="Field Reference" subtitle="Column rules for both sheets. Sheet names and column headers must match exactly (case-sensitive)." />
        <CardBody noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  {['Sheet', 'Field', 'Rule'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {FIELD_REFERENCE.map((row, i) => (
                  <tr key={i} className="hover:bg-neutral-50 align-top">
                    <td className="px-4 py-2 text-xs text-neutral-400 whitespace-nowrap">{row.sheet}</td>
                    <td className="px-4 py-2 text-xs font-mono text-neutral-700 whitespace-nowrap">{row.field}</td>
                    <td className="px-4 py-2 text-xs text-neutral-600">{row.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-neutral-500 border-t border-neutral-100">
            Duplicate Loan Refs on the Loans sheet flag both rows and create neither loan. Re-uploading a whole file after
            fixing one flagged loan re-creates loans that already succeeded — only re-upload the corrected rows, or dismiss
            the flagged entries and upload just those.
          </p>
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
            subtitle={`${activeBatch.flaggedEntries.length} loans could not be imported`}
          />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Loan Ref', 'Staff ID', 'Guarantor ID', 'Amount', 'Disbursed', 'Reason', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedEntries.map((entry, index) => (
                    <tr key={`${entry.loanRef}-${index}`} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.loanRef || '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.staffId || '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.guarantorId || '—'}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(Number(entry.principalAmount))}</td>
                      <td className="px-4 py-2 text-xs">{entry.disbursedDate ? fmtDate(entry.disbursedDate) : '—'}</td>
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
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">{batch.fileName}</td>
                      <td className="px-4 py-2 text-neutral-500 text-xs font-mono">{fmtDate(batch.createdAt)}</td>
                      <td className="px-4 py-2 text-success-700 font-medium">{batch.matchedRows}</td>
                      <td className="px-4 py-2 text-warning-700 font-medium">{batch.flaggedRows}</td>
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
                          {batch.flaggedRows > 0 && (
                            <button
                              onClick={() => setClearTarget({ batchId: batch._id, fileName: batch.fileName })}
                              className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                            >
                              Clear Flagged
                            </button>
                          )}
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
        open={!!clearTarget}
        title="Clear flagged entries?"
        body={`This clears all flagged loans for "${clearTarget?.fileName}" and marks the import completed. The import stays in history — this does not undo any loans already created.`}
        confirmLabel="Clear Flagged"
        isPending={clearMutation.isPending}
        onConfirm={() => clearMutation.mutate(clearTarget!.batchId)}
        onClose={() => setClearTarget(null)}
      />
    </div>
  );
}
