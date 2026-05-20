'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ContributionStatus } from '@welfare/shared';
import type { IContribution, IStaff } from '@welfare/shared';
import { manualContribution, getContributionSummary } from '@/lib/contributions';
import { searchStaff } from '@/lib/staff';
import { contributionSchema, type ContributionFormValues } from '@/lib/form-schemas';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fmtGHS } from '@/lib/format';
import { cn } from '@/lib/utils';

type FormValues = ContributionFormValues;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const statusKind: Record<ContributionStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  [ContributionStatus.Paid]:          'success',
  [ContributionStatus.Partial]:       'warning',
  [ContributionStatus.Missed]:        'danger',
  [ContributionStatus.CarriedForward]:'info',
};

export default function ManualEntryClient() {
  const qc = useQueryClient();
  const now = new Date();
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<IStaff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<IStaff | null>(null);
  const [submittedResults, setSubmittedResults] = useState<IContribution[] | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(contributionSchema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear() },
  });

  const watchMonth = watch('month');
  const watchYear = watch('year');
  const watchAmount = watch('amount');
  const watchStaffId = watch('staffId');

  const { data: summary } = useQuery({
    queryKey: ['contribution-summary', watchMonth, watchYear],
    queryFn: () => getContributionSummary(watchMonth, watchYear),
    enabled: !!watchMonth && !!watchYear,
  });

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 2) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data);
  }

  function selectStaff(staff: IStaff) {
    setSelectedStaff(staff);
    setValue('staffId', staff._id);
    setStaffSearch(staff.fullName);
    setStaffOptions([]);
  }

  const mutation = useMutation({
    mutationFn: (values: FormValues) => manualContribution(values),
    onSuccess: (data) => {
      setSubmittedResults(data);
      qc.invalidateQueries({ queryKey: ['contribution-summary'] });
      toast.success(`Recorded ${data.length} month(s)`);
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Entry failed');
    },
  });

  const totalCount = (summary?.countPaid ?? 0) + (summary?.countPartial ?? 0) + (summary?.countMissed ?? 0);
  const expectedAmount = summary && totalCount > 0 ? summary.totalExpected / totalCount : null;

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardHeader title="Record Manual Contribution" />
        <CardBody>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            {/* Staff picker */}
            <div className="relative space-y-1.5">
              <label className="text-base font-medium text-neutral-700">Staff Member <span className="text-danger-500">*</span></label>
              <div className="relative">
                <Input
                  placeholder="Search by name or staff ID…"
                  value={staffSearch}
                  onChange={(e) => handleStaffSearch(e.target.value)}
                />
                {staffOptions.length > 0 && (
                  <ul className="absolute z-10 w-full border border-neutral-200 bg-white rounded-sm shadow-floating max-h-48 overflow-y-auto mt-1">
                    {staffOptions.map((s) => (
                      <li key={s._id}>
                        <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 transition-colors" onClick={() => selectStaff(s)}>
                          <span className="font-medium text-neutral-900">{s.fullName}</span>
                          <span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <input type="hidden" {...register('staffId')} />
              {errors.staffId && <p className="text-sm text-danger-700">{errors.staffId.message}</p>}
              {selectedStaff && <p className="text-xs text-neutral-500">Selected: {selectedStaff.fullName} ({selectedStaff.staffId})</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Month" required>
                <Select {...register('month')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
              </Field>
              <Field label="Year" required>
                <Input {...register('year')} type="number" />
              </Field>
            </div>

            <Field label="Amount" required error={errors.amount?.message}>
              <Input {...register('amount')} type="number" min="1" prefix="₵" error={!!errors.amount} />
            </Field>

            <Field label="Note">
              <Input {...register('note')} type="text" />
            </Field>

            {watchAmount > 0 && watchStaffId && (
              <div className="bg-primary-50 border border-primary-200 rounded-sm p-4 text-sm space-y-1">
                <p className="font-semibold text-primary-800">Preview</p>
                <p className="text-neutral-600">Amount entered: <strong className="font-mono tabular">{fmtGHS(Number(watchAmount))}</strong></p>
                {expectedAmount && (
                  <p className="text-neutral-600">Expected/month: <strong className="font-mono tabular">{fmtGHS(expectedAmount)}</strong></p>
                )}
                {expectedAmount && watchAmount >= expectedAmount && (
                  <p className="text-primary-700 font-medium">
                    Lump sum — will split across ~{Math.ceil(watchAmount / expectedAmount)} month(s)
                  </p>
                )}
              </div>
            )}

            <Button type="submit" variant="primary" loading={isSubmitting}>Record Payment</Button>
          </form>
        </CardBody>
      </Card>

      {submittedResults && (
        <Card>
          <CardHeader title="Payment Recorded" />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Month','Year','Paid','Expected','Surplus C/F','Status'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {submittedResults.map((c) => (
                    <tr key={c._id}>
                      <td className="px-4 py-2">{MONTHS[c.month - 1]}</td>
                      <td className="px-4 py-2">{c.year}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(c.paidAmount)}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(c.expectedAmount)}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(c.surplusCarriedForward)}</td>
                      <td className="px-4 py-2"><Badge kind={statusKind[c.status]}>{c.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
