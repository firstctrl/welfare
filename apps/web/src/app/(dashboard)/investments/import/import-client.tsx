'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { importInvestments } from '@/lib/investments';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function InvestmentsImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ batchId: string; imported: number; flagged: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: () => importInvestments(file!),
    onSuccess: (data) => {
      setResult(data);
      if (data.flagged === 0) toast.success(`${data.imported} investments imported`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Import failed'),
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Bulk Import Investments</h1>
      </div>

      <Card>
        <CardHeader title="XLSX Template" />
        <CardBody>
          <p className="text-sm text-neutral-500">Required columns: <strong>Purchase Date</strong>, <strong>Description</strong>, <strong>Cost</strong>, <strong>Maturity Date</strong>, <strong>Face Value</strong>, <strong>Instruction</strong> (One-Time or Roll-Over)</p>
          <p className="text-sm text-neutral-400 mt-2">Interest and rate are computed automatically from Cost and Face Value.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Upload File" />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div
            className="border-2 border-dashed border-neutral-200 rounded-md p-8 text-center cursor-pointer hover:border-primary-300 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={24} className="mx-auto text-neutral-400 mb-2" />
            <p className="text-sm text-neutral-500">{file ? file.name : 'Click to select an XLSX file'}</p>
          </div>

          {file && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} Icon={Upload}>
              {mutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}

          {result && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm"><CheckCircle size={16} className="text-success-600" /><span><strong>{result.imported}</strong> imported of {result.total}</span></div>
              {result.flagged > 0 && (
                <div className="flex items-center gap-2 text-sm text-warning-700"><AlertTriangle size={16} /><span><strong>{result.flagged}</strong> rows flagged</span></div>
              )}
              <Button variant="secondary" size="sm" onClick={() => router.push('/investments')}>View Investments</Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
