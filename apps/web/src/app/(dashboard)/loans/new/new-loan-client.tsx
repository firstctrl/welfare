'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, XCircle } from 'lucide-react';
import { LoanStatus } from '@welfare/shared';
import type { IStaff } from '@welfare/shared';
import { searchStaff, getLoanEligibility } from '@/lib/staff';
import { createLoan, uploadLoanDocument, getLoansByGuarantor } from '@/lib/loans';
import { getConfig } from '@/lib/config';
import { loanSchema, type LoanFormValues } from '@/lib/form-schemas';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type FormValues = LoanFormValues;

function computeDueDate(disbursedDate: Date, n: number): Date {
  const d = new Date(disbursedDate);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(5);
  return d;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function StaffPicker({
  label,
  value,
  excludeId,
  onSelect,
  disabled,
}: {
  label: string;
  value: string;
  excludeId?: string;
  onSelect: (staff: IStaff) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<IStaff[]>([]);

  async function handleSearch(q: string) {
    if (disabled) return;
    setQuery(q);
    if (q.length < 2) { setOptions([]); return; }
    const res = await searchStaff(q);
    setOptions(res.data.filter((s) => s._id !== excludeId));
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search by name or ID…"
        disabled={disabled}
      />
      {options.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-neutral-200 rounded-sm shadow-floating max-h-48 overflow-y-auto">
          {options.map((s) => (
            <button
              key={s._id}
              type="button"
              onClick={() => { onSelect(s); setQuery(s.fullName); setOptions([]); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 transition-colors duration-fast"
            >
              <span className="font-medium text-neutral-900">{s.fullName}</span>
              <span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewLoanClient() {
  const router = useRouter();
  const [selectedStaff, setSelectedStaff]         = useState<IStaff | null>(null);
  const [selectedGuarantor, setSelectedGuarantor] = useState<IStaff | null>(null);
  const [docFile, setDocFile]                     = useState<File | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(loanSchema),
    defaultValues: { tenureMonths: 6 },
  });

  const watchStaffId     = watch('staffId');
  const watchGuarantorId = watch('guarantorId');
  const watchPrincipal   = watch('principalAmount');
  const watchTenure      = watch('tenureMonths');
  const watchDate        = watch('disbursedDate');

  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig, staleTime: 5 * 60 * 1000 });
  const minAmount       = parseFloat(cfg?.['LOAN_MIN_AMOUNT']?.value ?? '500');
  const maxAmount       = parseFloat(cfg?.['LOAN_MAX_AMOUNT']?.value ?? '50000');
  const shortRate       = parseFloat(cfg?.['INTEREST_RATE_SHORT']?.value ?? '5');
  const longRate        = parseFloat(cfg?.['INTEREST_RATE_LONG']?.value ?? '8');
  const maxPerGuarantor = parseInt(cfg?.['MAX_LOANS_PER_GUARANTOR']?.value ?? '0', 10);

  const derivedRate       = (watchTenure ?? 6) <= 6 ? shortRate : longRate;
  const totalRepayable    = watchPrincipal ? round2(watchPrincipal * (1 + derivedRate / 100)) : 0;
  const monthlyInstalment = watchTenure && totalRepayable ? round2(totalRepayable / watchTenure) : 0;

  const principalOutOfRange = !!watchPrincipal && (watchPrincipal < minAmount || watchPrincipal > maxAmount);

  const schedulePreview = useMemo(() => {
    if (!watchPrincipal || !watchTenure || !watchDate) return [];
    if (watchPrincipal < minAmount || watchPrincipal > maxAmount) return [];
    const d = new Date(watchDate);
    if (isNaN(d.getTime())) return [];
    const totalInterest = round2(watchPrincipal * derivedRate / 100);
    const baseInterestPerInst = round2(totalInterest / watchTenure);
    let balance = totalRepayable;
    return Array.from({ length: watchTenure }, (_, i) => {
      const isLast = i === watchTenure - 1;
      const dueDate = computeDueDate(d, i + 1);
      const interestAmt = isLast
        ? round2(totalInterest - baseInterestPerInst * (watchTenure - 1))
        : baseInterestPerInst;
      const principalAmt = round2(monthlyInstalment - interestAmt);
      balance = round2(Math.max(0, balance - monthlyInstalment));
      return { n: i + 1, dueDate, instalment: monthlyInstalment, principalAmt, interestAmt, balanceAfter: balance };
    });
  }, [watchPrincipal, watchTenure, watchDate, totalRepayable, monthlyInstalment, derivedRate, minAmount, maxAmount]);

  const { data: eligibility } = useQuery({
    queryKey: ['eligibility', watchStaffId],
    queryFn: () => getLoanEligibility(watchStaffId),
    enabled: !!watchStaffId,
  });

  const { data: guarantorLoans } = useQuery({
    queryKey: ['loans', 'guarantor', watchGuarantorId],
    queryFn: () => getLoansByGuarantor(watchGuarantorId),
    enabled: !!watchGuarantorId,
  });
  const activeGuaranteeCount = guarantorLoans?.data.filter((l) => l.status === LoanStatus.Active).length ?? 0;
  const guarantorAtCap = maxPerGuarantor > 0 && activeGuaranteeCount >= maxPerGuarantor;

  function selectStaff(staff: IStaff) {
    setSelectedStaff(staff);
    setValue('staffId', staff._id);
    if (staff._id === watchGuarantorId) { setSelectedGuarantor(null); setValue('guarantorId', ''); }
  }

  function selectGuarantor(staff: IStaff) {
    setSelectedGuarantor(staff);
    setValue('guarantorId', staff._id);
  }

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const loan = await createLoan(values);
      if (docFile) await uploadLoanDocument(loan._id, docFile);
      return loan;
    },
    onSuccess: (loan) => { toast.success('Loan recorded'); router.push(`/loans/${loan._id}`); },
    onError: (err: unknown) => { toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to record loan'); },
  });

  const ineligible = !!selectedStaff && eligibility?.eligible === false;
  const submitDisabled = isSubmitting || mutation.isPending || guarantorAtCap || ineligible || principalOutOfRange;

  return (
    <div className="grid grid-cols-2 gap-6 items-start">
      <div>
      <Card>
        <CardHeader title="Loan Details" />
        <CardBody>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
            <div className="grid grid-cols-2 gap-5">
              {/* Staff picker */}
              <div className="space-y-1.5">
                <Field label="Staff Member" required error={errors.staffId?.message}>
                  <StaffPicker
                    label="Staff Member"
                    value={selectedStaff?.fullName ?? ''}
                    excludeId={watchGuarantorId}
                    onSelect={selectStaff}
                  />
                </Field>
                <input type="hidden" {...register('staffId')} />
                {selectedStaff && eligibility && (
                  <div className={cn('flex items-center gap-1.5 text-xs mt-1 px-2 py-1 rounded-xs', eligibility.eligible ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700')}>
                    {eligibility.eligible
                      ? <><CheckCircle size={12} strokeWidth={1.75} /> Eligible for a loan</>
                      : <><XCircle size={12} strokeWidth={1.75} /> Ineligible: {eligibility.reason}</>
                    }
                  </div>
                )}
              </div>

              {/* Guarantor picker */}
              <div className="space-y-1.5">
                <Field label="Guarantor" required error={errors.guarantorId?.message}>
                  <StaffPicker
                    label="Guarantor"
                    value={selectedGuarantor?.fullName ?? ''}
                    excludeId={watchStaffId}
                    onSelect={selectGuarantor}
                    disabled={ineligible}
                  />
                </Field>
                <input type="hidden" {...register('guarantorId')} />
                {selectedGuarantor && (
                  <div className={cn('flex items-center gap-1.5 text-xs mt-1 px-2 py-1 rounded-xs', guarantorAtCap ? 'bg-danger-50 text-danger-700' : 'bg-neutral-50 text-neutral-600')}>
                    {guarantorAtCap
                      ? <><XCircle size={12} strokeWidth={1.75} /> At cap ({activeGuaranteeCount}/{maxPerGuarantor} active)</>
                      : <><CheckCircle size={12} strokeWidth={1.75} /> {activeGuaranteeCount} active guarantee{activeGuaranteeCount !== 1 ? 's' : ''}</>
                    }
                  </div>
                )}
              </div>

              <Field
                label={`Principal Amount${cfg ? ` (min: ${fmtGHS(minAmount)}, max: ${fmtGHS(maxAmount)})` : ''}`}
                required
                error={errors.principalAmount?.message ?? (principalOutOfRange ? `Amount must be between ${fmtGHS(minAmount)} and ${fmtGHS(maxAmount)}` : undefined)}
              >
                <Input {...register('principalAmount')} type="number" min={minAmount} max={maxAmount} step="0.01" prefix="₵" error={!!errors.principalAmount || principalOutOfRange} disabled={ineligible} />
              </Field>

              <div className="space-y-1.5">
                <Field label="Tenure" required error={errors.tenureMonths?.message}>
                  <Select
                    {...register('tenureMonths')}
                    options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} month${i > 0 ? 's' : ''}` }))}
                    error={!!errors.tenureMonths}
                    disabled={ineligible}
                  />
                </Field>
                {cfg && (
                  <p className="text-xs text-neutral-500">Interest rate: <strong>{derivedRate}%</strong> {(watchTenure ?? 6) <= 6 ? '(≤ 6 months)' : '(> 6 months)'}</p>
                )}
              </div>

              <Field label="Disbursed Date" required error={errors.disbursedDate?.message}>
                <Input {...register('disbursedDate')} type="date" error={!!errors.disbursedDate} disabled={ineligible} />
              </Field>

              <Field label="Cheque No." required error={errors.chequeNo?.message}>
                <Input {...register('chequeNo')} placeholder="e.g. CHQ-00123" error={!!errors.chequeNo} disabled={ineligible} />
              </Field>

              <Field label="PV No." required error={errors.pvNo?.message}>
                <Input {...register('pvNo')} placeholder="e.g. PV-2024-001" error={!!errors.pvNo} disabled={ineligible} />
              </Field>

              <div className="space-y-1.5">
                <label className="text-base font-medium text-neutral-700">Approval Document</label>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png"
                  disabled={ineligible}
                  onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-neutral-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-xs file:border-0 file:text-sm file:bg-neutral-100 file:text-neutral-700 hover:file:bg-neutral-200 file:font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {docFile && <p className="text-xs text-neutral-500">{docFile.name}</p>}
              </div>
            </div>

            {/* Derived summary */}
            {watchPrincipal > 0 && watchTenure > 0 && (
              <div className="bg-primary-50 border border-primary-200 rounded-sm p-4 grid grid-cols-3 gap-4">
                {([
                  ['Interest Rate', `${derivedRate}%`],
                  ['Total Repayable', fmtGHS(totalRepayable)],
                  ['Monthly Instalment', fmtGHS(monthlyInstalment)],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-primary-600 font-medium uppercase tracking-wide">{label}</p>
                    <p className="text-lg font-bold text-primary-900 mt-0.5 font-mono tabular">{value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2 border-t border-neutral-100">
              <Button type="submit" variant="primary" disabled={submitDisabled} loading={mutation.isPending}>
                Record Loan
              </Button>
              <Button type="button" variant="secondary" onClick={() => router.push('/loans')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      </div>

      {/* Schedule preview — right column */}
      <div className="sticky top-4">
        {schedulePreview.length > 0 ? (
          <Card>
            <CardHeader title="Schedule Preview" />
            <CardBody noPadding>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {([
                      { label: '#',         align: 'left'  },
                      { label: 'Due Date',  align: 'left'  },
                      { label: 'Principal', align: 'right' },
                      { label: 'Interest',  align: 'right' },
                      { label: 'Total',     align: 'right' },
                    ] as { label: string; align: 'left' | 'right' }[]).map((h) => (
                      <th key={h.label} className={`px-3 py-2 text-${h.align} text-xs font-semibold text-neutral-500 uppercase tracking-wide`}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {schedulePreview.map((row) => (
                    <tr key={row.n} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-neutral-500">{row.n}</td>
                      <td className="px-3 py-2 font-mono tabular text-xs">{fmtDate(row.dueDate)}</td>
                      <td className="px-3 py-2 font-mono tabular font-medium text-right">{fmtGHS(row.principalAmt)}</td>
                      <td className="px-3 py-2 font-mono tabular text-neutral-500 text-right">{fmtGHS(row.interestAmt)}</td>
                      <td className="px-3 py-2 font-mono tabular font-semibold text-right">{fmtGHS(row.instalment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t border-neutral-100 bg-neutral-50 text-xs text-neutral-500 flex justify-between">
                <span>Total repayable</span>
                <span className="font-semibold font-mono tabular text-neutral-900">{fmtGHS(totalRepayable)}</span>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody>
              <p className="text-xs text-neutral-400 text-center py-4">Fill in amount, tenure and date to preview schedule</p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
