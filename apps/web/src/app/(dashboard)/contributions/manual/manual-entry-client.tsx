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
type FormValues = ContributionFormValues;

const STATUS_COLOR: Record<ContributionStatus, string> = {
  [ContributionStatus.Paid]:          'text-green-700',
  [ContributionStatus.Partial]:       'text-yellow-700',
  [ContributionStatus.Missed]:        'text-red-700',
  [ContributionStatus.CarriedForward]:'text-blue-700',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const inputClass = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ManualEntryClient() {
  const qc = useQueryClient();
  const now = new Date();
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<IStaff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<IStaff | null>(null);
  const [submittedResults, setSubmittedResults] = useState<IContribution[] | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Entry failed');
    },
  });

  const totalCount = (summary?.countPaid ?? 0) + (summary?.countPartial ?? 0) + (summary?.countMissed ?? 0);
  const expectedAmount = summary && totalCount > 0 ? summary.totalExpected / totalCount : null;

  return (
    <div className="max-w-2xl space-y-6">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">

        <div className="space-y-1 relative">
          <label className="text-sm font-medium text-gray-700">Staff Member *</label>
          <input
            placeholder="Search by name or staff ID..."
            value={staffSearch}
            onChange={(e) => handleStaffSearch(e.target.value)}
            className={inputClass}
          />
          <input type="hidden" {...register('staffId')} />
          {staffOptions.length > 0 && (
            <ul className="absolute z-10 w-full border border-gray-200 bg-white rounded-md shadow-lg max-h-48 overflow-y-auto">
              {staffOptions.map((s) => (
                <li key={s._id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                    onClick={() => selectStaff(s)}
                  >
                    {s.fullName} <span className="text-gray-400 text-xs">{s.staffId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.staffId && <p className="text-xs text-red-600">{errors.staffId.message}</p>}
          {selectedStaff && (
            <p className="text-xs text-gray-500">Selected: {selectedStaff.fullName} ({selectedStaff.staffId})</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Month *</label>
            <select {...register('month')} className={inputClass}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Year *</label>
            <input {...register('year')} type="number" className={inputClass} />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Amount *</label>
          <input {...register('amount')} type="number" min="1" className={inputClass} />
          {errors.amount && <p className="text-xs text-red-600">{errors.amount.message}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Note</label>
          <input {...register('note')} type="text" className={inputClass} />
        </div>

        {watchAmount > 0 && watchStaffId && (
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
            <p className="font-medium text-gray-700">Preview</p>
            <p className="text-gray-600">Amount entered: <strong>{Number(watchAmount).toLocaleString()}</strong></p>
            {expectedAmount && (
              <p className="text-gray-600">Expected/month (config): <strong>{expectedAmount.toLocaleString()}</strong></p>
            )}
            {expectedAmount && watchAmount >= expectedAmount && (
              <p className="text-blue-700 font-medium">
                Lump sum — will split across ~{Math.ceil(watchAmount / expectedAmount)} month(s)
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-60"
        >
          {isSubmitting ? 'Saving...' : 'Record Payment'}
        </button>
      </form>

      {submittedResults && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
          <h2 className="font-medium text-gray-900">Payment Recorded</h2>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Month', 'Year', 'Paid', 'Expected', 'Surplus C/F', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {submittedResults.map((c) => (
                  <tr key={c._id}>
                    <td className="px-3 py-2">{MONTHS[c.month - 1]}</td>
                    <td className="px-3 py-2">{c.year}</td>
                    <td className="px-3 py-2">{c.paidAmount.toLocaleString()}</td>
                    <td className="px-3 py-2">{c.expectedAmount.toLocaleString()}</td>
                    <td className="px-3 py-2">{c.surplusCarriedForward.toLocaleString()}</td>
                    <td className={`px-3 py-2 font-medium ${STATUS_COLOR[c.status]}`}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
