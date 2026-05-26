'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { createRemittance, getRemittanceGrossPreview } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const now = new Date();

const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

const schema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2000),
  receiptDate: z.string().min(1, 'Required'),
});
type Form = z.infer<typeof schema>;

export function ManualEntryClient() {
  const router = useRouter();
  const [preview, setPreview] = useState<{ grossAmount: number; charges: number; netPayable: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear(), receiptDate: '' },
  });

  const { month, year } = form.watch();

  useEffect(() => {
    if (!month || !year || year < 2000) return;
    setLoadingPreview(true);
    getRemittanceGrossPreview(Number(month), Number(year))
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setLoadingPreview(false));
  }, [month, year]);

  const mutation = useMutation({
    mutationFn: (values: Form) => createRemittance(values),
    onSuccess: () => {
      toast.success('Remittance recorded successfully');
      router.push('/remittances');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to record remittance');
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">
          ← Back
        </Button>
        <h1 className="text-xl font-semibold">Record Remittance</h1>
      </div>

      <Card>
        <CardHeader title="Remittance Details" />
        <CardBody>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Month" error={form.formState.errors.month?.message}>
                <Select options={MONTH_OPTIONS} {...form.register('month')} value={String(month)} />
              </Field>
              <Field label="Year" error={form.formState.errors.year?.message}>
                <Input type="number" {...form.register('year')} />
              </Field>
            </div>

            {loadingPreview && <p className="text-sm text-neutral-400">Computing gross amount…</p>}
            {preview && (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Gross Amount</span>
                  <span className="font-medium">{fmtGHS(preview.grossAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">
                    Charges ({((preview.charges / (preview.grossAmount || 1)) * 100).toFixed(0)}%)
                  </span>
                  <span>{fmtGHS(preview.charges)}</span>
                </div>
                <div className="flex justify-between border-t border-neutral-200 pt-1.5">
                  <span className="font-semibold">Net Payable</span>
                  <span className="font-semibold text-primary-700">{fmtGHS(preview.netPayable)}</span>
                </div>
              </div>
            )}

            <Field label="Receipt Date" error={form.formState.errors.receiptDate?.message}>
              <Input type="date" {...form.register('receiptDate')} />
            </Field>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={mutation.isPending || !preview}>
                {mutation.isPending ? 'Saving…' : 'Record Remittance'}
              </Button>
              <Button variant="secondary" type="button" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
