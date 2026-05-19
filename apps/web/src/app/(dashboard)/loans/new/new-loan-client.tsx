'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LoanStatus } from '@welfare/shared';
import type { IStaff } from '@welfare/shared';
import { searchStaff, getLoanEligibility } from '@/lib/staff';
import { createLoan, uploadLoanDocument, getLoansByGuarantor } from '@/lib/loans';
import { getConfig } from '@/lib/config';
import { loanSchema, type LoanFormValues } from '@/lib/form-schemas';
type FormValues = LoanFormValues;

const inputClass =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function computeDueDate(disbursedDate: Date, n: number): Date {
  const d = new Date(disbursedDate);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(5);
  return d;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

export function NewLoanClient() {
  const router = useRouter();
  const [staffSearch, setStaffSearch]             = useState('');
  const [staffOptions, setStaffOptions]           = useState<IStaff[]>([]);
  const [selectedStaff, setSelectedStaff]         = useState<IStaff | null>(null);
  const [guarantorSearch, setGuarantorSearch]     = useState('');
  const [guarantorOptions, setGuarantorOptions]   = useState<IStaff[]>([]);
  const [selectedGuarantor, setSelectedGuarantor] = useState<IStaff | null>(null);
  const [docFile, setDocFile]                     = useState<File | null>(null);

  const {
    register, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(loanSchema),
    defaultValues: { tenureMonths: 6 },
  });

  const watchStaffId     = watch('staffId');
  const watchGuarantorId = watch('guarantorId');
  const watchPrincipal   = watch('principalAmount');
  const watchTenure      = watch('tenureMonths');
  const watchDate        = watch('disbursedDate');

  // System config
  const { data: cfg } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 5 * 60 * 1000,
  });
  const minAmount       = parseFloat(cfg?.['LOAN_MIN_AMOUNT']?.value ?? '500');
  const maxAmount       = parseFloat(cfg?.['LOAN_MAX_AMOUNT']?.value ?? '50000');
  const shortRate       = parseFloat(cfg?.['INTEREST_RATE_SHORT']?.value ?? '5');
  const longRate        = parseFloat(cfg?.['INTEREST_RATE_LONG']?.value ?? '8');
  const maxPerGuarantor = parseInt(cfg?.['MAX_LOANS_PER_GUARANTOR']?.value ?? '0', 10);

  const derivedRate       = (watchTenure ?? 6) <= 6 ? shortRate : longRate;
  const totalRepayable    = watchPrincipal ? round2(watchPrincipal * (1 + derivedRate / 100)) : 0;
  const monthlyInstalment = watchTenure && totalRepayable ? round2(totalRepayable / watchTenure) : 0;

  // Live schedule preview
  const schedulePreview = useMemo(() => {
    if (!watchPrincipal || !watchTenure || !watchDate) return [];
    const d = new Date(watchDate);
    if (isNaN(d.getTime())) return [];
    let balance = totalRepayable;
    return Array.from({ length: watchTenure }, (_, i) => {
      const dueDate = computeDueDate(d, i + 1);
      balance = round2(Math.max(0, balance - monthlyInstalment));
      return { n: i + 1, dueDate, instalment: monthlyInstalment, balanceAfter: balance };
    });
  }, [watchPrincipal, watchTenure, watchDate, totalRepayable, monthlyInstalment]);

  // Staff eligibility
  const { data: eligibility } = useQuery({
    queryKey: ['eligibility', watchStaffId],
    queryFn: () => getLoanEligibility(watchStaffId),
    enabled: !!watchStaffId,
  });

  // Guarantor active guarantee count
  const { data: guarantorLoans } = useQuery({
    queryKey: ['loans', 'guarantor', watchGuarantorId],
    queryFn: () => getLoansByGuarantor(watchGuarantorId),
    enabled: !!watchGuarantorId,
  });
  const activeGuaranteeCount = guarantorLoans?.data.filter(
    (l) => l.status === LoanStatus.Active,
  ).length ?? 0;
  const guarantorAtCap = maxPerGuarantor > 0 && activeGuaranteeCount >= maxPerGuarantor;

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 2) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data.filter((s) => s._id !== watchGuarantorId));
  }

  function selectStaff(staff: IStaff) {
    setSelectedStaff(staff);
    setValue('staffId', staff._id);
    setStaffSearch(staff.fullName);
    setStaffOptions([]);
    if (staff._id === watchGuarantorId) {
      setSelectedGuarantor(null);
      setValue('guarantorId', '');
      setGuarantorSearch('');
    }
  }

  async function handleGuarantorSearch(q: string) {
    setGuarantorSearch(q);
    if (q.length < 2) { setGuarantorOptions([]); return; }
    const res = await searchStaff(q);
    setGuarantorOptions(res.data.filter((s) => s._id !== watchStaffId));
  }

  function selectGuarantor(staff: IStaff) {
    setSelectedGuarantor(staff);
    setValue('guarantorId', staff._id);
    setGuarantorSearch(staff.fullName);
    setGuarantorOptions([]);
  }

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const loan = await createLoan(values);
      if (docFile) await uploadLoanDocument(loan._id, docFile);
      return loan;
    },
    onSuccess: (loan) => {
      toast.success('Loan recorded successfully');
      router.push(`/loans/${loan._id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to record loan');
    },
  });

  const submitDisabled =
    isSubmitting ||
    mutation.isPending ||
    guarantorAtCap ||
    eligibility?.eligible === false;

  return (
    <div className="max-w-4xl space-y-6">
      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="bg-white border border-gray-200 rounded-xl p-6 space-y-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Staff Picker */}
          <div className="space-y-1 relative">
            <label className="text-sm font-medium text-gray-700">Staff Member *</label>
            <input
              type="text"
              value={staffSearch}
              onChange={(e) => handleStaffSearch(e.target.value)}
              placeholder="Search by name or ID…"
              className={inputClass}
            />
            {staffOptions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => selectStaff(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium">{s.fullName}</span>
                    <span className="text-gray-400 ml-2 text-xs">{s.staffId}</span>
                  </button>
                ))}
              </div>
            )}
            <input type="hidden" {...register('staffId')} />
            {errors.staffId && (
              <p className="text-xs text-red-600">{errors.staffId.message}</p>
            )}
            {selectedStaff && eligibility && (
              <div
                className={`mt-1 text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                  eligibility.eligible
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {eligibility.eligible
                  ? '✓ Eligible for a loan'
                  : `✗ Ineligible: ${eligibility.reason}`}
              </div>
            )}
          </div>

          {/* Guarantor Picker */}
          <div className="space-y-1 relative">
            <label className="text-sm font-medium text-gray-700">Guarantor *</label>
            <input
              type="text"
              value={guarantorSearch}
              onChange={(e) => handleGuarantorSearch(e.target.value)}
              placeholder="Search guarantor by name or ID…"
              className={inputClass}
            />
            {guarantorOptions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {guarantorOptions.map((s) => (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => selectGuarantor(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium">{s.fullName}</span>
                    <span className="text-gray-400 ml-2 text-xs">{s.staffId}</span>
                  </button>
                ))}
              </div>
            )}
            <input type="hidden" {...register('guarantorId')} />
            {errors.guarantorId && (
              <p className="text-xs text-red-600">{errors.guarantorId.message}</p>
            )}
            {selectedGuarantor && (
              <div
                className={`mt-1 text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                  guarantorAtCap ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'
                }`}
              >
                {guarantorAtCap
                  ? `✗ At cap (${activeGuaranteeCount}/${maxPerGuarantor} active guarantees)`
                  : `${activeGuaranteeCount} active guarantee${activeGuaranteeCount !== 1 ? 's' : ''}`}
              </div>
            )}
          </div>

          {/* Principal Amount */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Principal Amount *
              {cfg && (
                <span className="text-gray-400 font-normal ml-1 text-xs">
                  (min: {minAmount.toLocaleString()}, max: {maxAmount.toLocaleString()})
                </span>
              )}
            </label>
            <input
              {...register('principalAmount')}
              type="number"
              min={minAmount}
              max={maxAmount}
              step="0.01"
              className={inputClass}
            />
            {errors.principalAmount && (
              <p className="text-xs text-red-600">{errors.principalAmount.message}</p>
            )}
          </div>

          {/* Tenure */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Tenure (months) *</label>
            <select {...register('tenureMonths')} className={inputClass}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m} month{m > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            {cfg && (
              <p className="text-xs text-gray-500">
                Interest rate: <strong>{derivedRate}%</strong>
                {(watchTenure ?? 6) <= 6 ? ' (≤ 6 months)' : ' (> 6 months)'}
              </p>
            )}
          </div>

          {/* Disbursed Date */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Disbursed Date *</label>
            <input {...register('disbursedDate')} type="date" className={inputClass} />
            {errors.disbursedDate && (
              <p className="text-xs text-red-600">{errors.disbursedDate.message}</p>
            )}
          </div>

          {/* Approval Document */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Approval Document</label>
            <input
              type="file"
              accept=".pdf,image/jpeg,image/png"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-600 file:mr-4 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
            {docFile && <p className="text-xs text-gray-500">{docFile.name}</p>}
          </div>
        </div>

        {/* Derived summary */}
        {watchPrincipal > 0 && watchTenure > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Interest Rate</p>
              <p className="font-semibold text-gray-900">{derivedRate}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Repayable</p>
              <p className="font-semibold text-gray-900">{totalRepayable.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Monthly Instalment</p>
              <p className="font-semibold text-gray-900">{monthlyInstalment.toLocaleString()}</p>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitDisabled}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
          >
            {mutation.isPending ? 'Recording…' : 'Record Loan'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/loans')}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>

      {/* Live repayment schedule preview */}
      {schedulePreview.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">
            Repayment Schedule Preview
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['#', 'Due Date', 'Monthly Instalment', 'Balance After'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedulePreview.map((row) => (
                  <tr key={row.n}>
                    <td className="px-3 py-2 text-gray-500">{row.n}</td>
                    <td className="px-3 py-2">{row.dueDate.toLocaleDateString('en-GB')}</td>
                    <td className="px-3 py-2 font-medium">{row.instalment.toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-600">{row.balanceAfter.toLocaleString()}</td>
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
