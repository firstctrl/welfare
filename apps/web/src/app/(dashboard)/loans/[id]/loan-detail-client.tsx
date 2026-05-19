'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  LoanStatus,
  LoanRepaymentStatus,
  RepaymentSource,
  StaffStatus,
} from '@welfare/shared';
import type { ILoanRepayment } from '@welfare/shared';
import {
  getLoan,
  getLoanSchedule,
  getLoanDocumentUrl,
  recordPayment,
  exitSettle,
  getLoansByGuarantor,
} from '@/lib/loans';
import { getStaff } from '@/lib/staff';

const LOAN_STATUS_BADGE: Record<LoanStatus, string> = {
  [LoanStatus.Active]:    'bg-green-100 text-green-800',
  [LoanStatus.Completed]: 'bg-blue-100 text-blue-700',
  [LoanStatus.Defaulted]: 'bg-orange-100 text-orange-700',
  [LoanStatus.WrittenOff]:'bg-gray-100 text-gray-600',
  [LoanStatus.BadDebt]:   'bg-red-100 text-red-800',
};

const REPAYMENT_STATUS_BADGE: Record<LoanRepaymentStatus, string> = {
  [LoanRepaymentStatus.Pending]: 'bg-gray-100 text-gray-600',
  [LoanRepaymentStatus.Paid]:    'bg-green-100 text-green-700',
  [LoanRepaymentStatus.Partial]: 'bg-yellow-100 text-yellow-700',
  [LoanRepaymentStatus.Overdue]: 'bg-red-100 text-red-700',
  [LoanRepaymentStatus.Waived]:  'bg-purple-100 text-purple-700',
};

const EXIT_STATUSES = new Set<StaffStatus>([
  StaffStatus.Resigned,
  StaffStatus.Dismissed,
  StaffStatus.Deceased,
]);

const paymentSchema = z.object({
  amount:   z.coerce.number().min(0.01, 'Required'),
  paidDate: z.string().min(1, 'Required'),
  notes:    z.string().optional(),
});
type PaymentForm = z.infer<typeof paymentSchema>;

const settlementSchema = z.object({
  exitDeductionAmount: z.coerce.number().min(0, 'Required'),
  notes:               z.string().optional(),
});
type SettlementForm = z.infer<typeof settlementSchema>;

const inputClass =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function round2(n: number) { return Math.round(n * 100) / 100; }

function computeAffectedInstalments(schedule: ILoanRepayment[], amount: number) {
  let remaining = amount;
  const affected: Array<{ instalment: ILoanRepayment; applied: number }> = [];
  for (const inst of [...schedule].sort((a, b) => a.instalmentNumber - b.instalmentNumber)) {
    if (
      inst.status === LoanRepaymentStatus.Paid ||
      inst.status === LoanRepaymentStatus.Waived
    ) continue;
    const due = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
    if (due <= 0) continue;
    const applied = round2(Math.min(remaining, due));
    if (applied <= 0) break;
    affected.push({ instalment: inst, applied });
    remaining = round2(remaining - applied);
    if (remaining <= 0) break;
  }
  return affected;
}

export function LoanDetailClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const { data: loan, isLoading: loanLoading } = useQuery({
    queryKey: ['loans', id],
    queryFn: () => getLoan(id),
  });
  const { data: schedule, isLoading: scheduleLoading } = useQuery({
    queryKey: ['loans', id, 'schedule'],
    queryFn: () => getLoanSchedule(id),
    enabled: !!loan,
  });
  const { data: borrower } = useQuery({
    queryKey: ['staff', loan?.staffId],
    queryFn: () => getStaff(loan!.staffId),
    enabled: !!loan,
  });
  const { data: guarantor } = useQuery({
    queryKey: ['staff', loan?.guarantorId],
    queryFn: () => getStaff(loan!.guarantorId),
    enabled: !!loan,
  });
  const { data: guarantorLoans } = useQuery({
    queryKey: ['loans', 'guarantor', loan?.guarantorId],
    queryFn: () => getLoansByGuarantor(loan!.guarantorId),
    enabled: !!loan,
  });
  const activeGuaranteeCount = guarantorLoans?.data.filter(
    (l) => l.status === LoanStatus.Active,
  ).length ?? 0;

  const paymentForm    = useForm<PaymentForm>({ resolver: zodResolver(paymentSchema) });
  const settlementForm = useForm<SettlementForm>({
    resolver: zodResolver(settlementSchema),
    defaultValues: { exitDeductionAmount: 0 },
  });

  const paymentAmount = paymentForm.watch('amount');

  const affectedInstalments = useMemo(() => {
    if (!schedule || !paymentAmount) return [];
    return computeAffectedInstalments(schedule, paymentAmount);
  }, [schedule, paymentAmount]);

  const summary = useMemo(() => {
    if (!schedule) return { totalPaid: 0, outstanding: 0, nextDueDate: null as string | null, nextDueAmount: 0 };
    const totalPaid = round2(schedule.reduce((s, r) => s + r.paidAmount, 0));
    const outstanding = round2(
      schedule.reduce((s, r) => s + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount), 0),
    );
    const next = schedule.find(
      (r) =>
        r.status !== LoanRepaymentStatus.Paid &&
        r.status !== LoanRepaymentStatus.Waived,
    );
    return {
      totalPaid,
      outstanding,
      nextDueDate:   next?.dueDate ?? null,
      nextDueAmount: next ? round2(next.dueAmount + next.penaltyAmount - next.paidAmount) : 0,
    };
  }, [schedule]);

  const deductionAmount         = settlementForm.watch('exitDeductionAmount') ?? 0;
  const amountCovered           = round2(Math.min(deductionAmount, summary.outstanding));
  const remainingAfterDeduction = round2(Math.max(0, summary.outstanding - deductionAmount));

  const paymentMutation = useMutation({
    mutationFn: (values: PaymentForm) => recordPayment(id, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans', id] });
      setShowPaymentModal(false);
      paymentForm.reset();
      toast.success('Payment recorded');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Payment failed');
    },
  });

  const settlementMutation = useMutation({
    mutationFn: (values: SettlementForm) => exitSettle(id, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans', id] });
      toast.success('Exit settlement recorded');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Settlement failed');
    },
  });

  async function handleDownloadDoc() {
    try {
      const url = await getLoanDocumentUrl(id);
      window.open(url, '_blank');
    } catch {
      toast.error('Document not found');
    }
  }

  if (loanLoading) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!loan)       return <div className="text-sm text-red-500">Loan not found.</div>;

  const showExitPanel =
    !!borrower &&
    EXIT_STATUSES.has(borrower.status) &&
    loan.status === LoanStatus.Active;

  const showSettlementSummary =
    loan.status !== LoanStatus.Active &&
    ((loan.exitDeductionAmount ?? 0) > 0 ||
      (loan.guarantorOffsetAmount ?? 0) > 0 ||
      (loan.badDebtAmount ?? 0) > 0);

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── Header ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900">
                {borrower?.fullName ?? '—'}
              </h1>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${LOAN_STATUS_BADGE[loan.status]}`}
              >
                {loan.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Principal:{' '}
              <span className="font-medium text-gray-900">
                {loan.principalAmount.toLocaleString()}
              </span>
              &nbsp;·&nbsp;Tenure:{' '}
              <span className="font-medium text-gray-900">{loan.tenureMonths}mo</span>
              &nbsp;·&nbsp;Disbursed:{' '}
              <span className="font-medium text-gray-900">
                {new Date(loan.disbursedDate).toLocaleDateString('en-GB')}
              </span>
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Guarantor:{' '}
              <span className="font-medium text-gray-900">
                {guarantor?.fullName ?? '—'}
              </span>
              &nbsp;
              <span className="text-gray-400">
                ({activeGuaranteeCount} active guarantee
                {activeGuaranteeCount !== 1 ? 's' : ''})
              </span>
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            {loan.documentKey && (
              <button
                onClick={handleDownloadDoc}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Download Document
              </button>
            )}
            {loan.status === LoanStatus.Active && (
              <button
                onClick={() => setShowPaymentModal(true)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Record Payment
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Payment Summary ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Payment Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(
            [
              ['Total Paid',      summary.totalPaid.toLocaleString()],
              ['Outstanding',     summary.outstanding.toLocaleString()],
              [
                'Next Due Date',
                summary.nextDueDate
                  ? new Date(summary.nextDueDate).toLocaleDateString('en-GB')
                  : '—',
              ],
              [
                'Next Due Amount',
                summary.nextDueAmount > 0 ? summary.nextDueAmount.toLocaleString() : '—',
              ],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-base font-semibold text-gray-900 mt-0.5">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Repayment Schedule ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Repayment Schedule</h2>
        {scheduleLoading ? (
          <div className="text-sm text-gray-400">Loading schedule…</div>
        ) : !schedule?.length ? (
          <div className="text-sm text-gray-400">No schedule found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['#', 'Due Date', 'Due', 'Paid', 'Penalty', 'Status', 'Source'].map((h) => (
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
                {schedule.map((row) => {
                  const isOverdue   = row.status === LoanRepaymentStatus.Overdue;
                  const isGuarantor = row.source  === RepaymentSource.GuarantorOffset;
                  return (
                    <tr
                      key={row._id}
                      className={
                        isOverdue
                          ? 'bg-red-50'
                          : isGuarantor
                          ? 'bg-amber-50'
                          : 'bg-white'
                      }
                    >
                      <td className="px-3 py-2 text-gray-500">{row.instalmentNumber}</td>
                      <td className="px-3 py-2">
                        {new Date(row.dueDate).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-right">{row.dueAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{row.paidAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        {row.penaltyAmount > 0 ? (
                          <span className="text-red-600">
                            {row.penaltyAmount.toLocaleString()}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${REPAYMENT_STATUS_BADGE[row.status]}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {isGuarantor ? (
                          <span className="text-amber-700">Guarantor offset</span>
                        ) : (
                          row.source ?? '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Exit Settlement Panel ── */}
      {showExitPanel && (
        <div className="bg-white border border-orange-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-orange-800 mb-1">Exit Settlement</h2>
          <p className="text-xs text-orange-600 mb-4">
            {borrower?.fullName} has status{' '}
            <strong>{borrower?.status}</strong>. Record the exit settlement below.
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Outstanding Balance:{' '}
            <span className="font-semibold">{summary.outstanding.toLocaleString()}</span>
          </p>
          <form
            onSubmit={settlementForm.handleSubmit((v) => settlementMutation.mutate(v))}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                Deduction from Final Pay / Gratuity
              </label>
              <input
                {...settlementForm.register('exitDeductionAmount')}
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
              />
            </div>
            {deductionAmount >= 0 && summary.outstanding > 0 && (
              <div className="bg-orange-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Amount covered by deduction:</span>
                  <span className="font-medium">{amountCovered.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Remaining balance:</span>
                  <span
                    className={`font-medium ${
                      remainingAfterDeduction > 0 ? 'text-orange-700' : 'text-green-700'
                    }`}
                  >
                    {remainingAfterDeduction.toLocaleString()}
                  </span>
                </div>
                {remainingAfterDeduction > 0 && (
                  <p className="text-xs text-orange-600 mt-1">
                    Remaining will be offset against guarantor contributions where available;
                    remainder becomes bad debt.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Notes</label>
              <textarea
                {...settlementForm.register('notes')}
                rows={2}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={settlementMutation.isPending}
              className="px-4 py-2 text-sm bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-60"
            >
              {settlementMutation.isPending ? 'Processing…' : 'Confirm Exit Settlement'}
            </button>
          </form>
        </div>
      )}

      {/* ── Settlement Summary ── */}
      {showSettlementSummary && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Settlement Summary</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {(
              [
                ['Exit Deduction',   loan.exitDeductionAmount   ?? 0, false],
                ['Guarantor Offset', loan.guarantorOffsetAmount ?? 0, false],
                ['Bad Debt',         loan.badDebtAmount         ?? 0, true],
              ] as [string, number, boolean][]
            ).map(([label, value, red]) => (
              <div key={label}>
                <p className="text-xs text-gray-500">{label}</p>
                <p
                  className={`font-semibold mt-0.5 ${
                    red && value > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          {loan.settledAt && (
            <p className="text-xs text-gray-400 mt-3">
              Settled on {new Date(loan.settledAt).toLocaleDateString('en-GB')}
            </p>
          )}
        </div>
      )}

      {/* ── Record Payment Modal ── */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Record Payment</h2>
              <button
                onClick={() => { setShowPaymentModal(false); paymentForm.reset(); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={paymentForm.handleSubmit((v) => paymentMutation.mutate(v))}
              className="px-6 py-4 space-y-4"
            >
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Amount *</label>
                <input
                  {...paymentForm.register('amount')}
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputClass}
                />
                {paymentForm.formState.errors.amount && (
                  <p className="text-xs text-red-600">
                    {paymentForm.formState.errors.amount.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Payment Date *</label>
                <input {...paymentForm.register('paidDate')} type="date" className={inputClass} />
                {paymentForm.formState.errors.paidDate && (
                  <p className="text-xs text-red-600">
                    {paymentForm.formState.errors.paidDate.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Notes</label>
                <textarea {...paymentForm.register('notes')} rows={2} className={inputClass} />
              </div>
              {affectedInstalments.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm">
                  <p className="text-xs font-medium text-blue-700 mb-2">
                    Instalments that will be affected:
                  </p>
                  <ul className="space-y-1">
                    {affectedInstalments.map(({ instalment, applied }) => (
                      <li
                        key={instalment._id}
                        className="flex justify-between text-blue-800 text-xs"
                      >
                        <span>
                          #{instalment.instalmentNumber} (
                          {new Date(instalment.dueDate).toLocaleDateString('en-GB')})
                        </span>
                        <span className="font-medium">+{applied.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowPaymentModal(false); paymentForm.reset(); }}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paymentMutation.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                >
                  {paymentMutation.isPending ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
