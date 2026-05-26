'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { importRemittances } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function RemittancesImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ batchId: string; imported: number; flagged: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: () => importRemittances(file!),
    onSuccess: (data) => {
      setResult(data);
      if (data.flagged === 0) toast.success(`${data.imported} remittances imported successfully`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Import failed');
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Bulk Import Remittances</h1>
      </div>

      <Card>
        <CardHeader title="XLSX Template" />
        <CardBody>
          <p className="text-sm text-neutral-500 mb-3">Required columns: <strong>Month</strong> (1–12), <strong>Year</strong>, <strong>Receipt Date</strong> (dd/mm/yyyy)</p>
          <p className="text-sm text-neutral-500">Gross amount, charges, and net payable are computed automatically from contribution records.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Upload File" />
        <CardBody className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
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
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle size={16} className="text-success-600" />
                <span><strong>{result.imported}</strong> imported of {result.total} rows</span>
              </div>
              {result.flagged > 0 && (
                <div className="flex items-center gap-2 text-sm text-warning-700">
                  <AlertTriangle size={16} />
                  <span><strong>{result.flagged}</strong> rows flagged (duplicate period or validation errors)</span>
                </div>
              )}
              <Button variant="secondary" size="sm" onClick={() => router.push('/remittances')}>
                View Remittances
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
