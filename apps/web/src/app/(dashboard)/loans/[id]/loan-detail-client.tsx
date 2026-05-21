'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Download, Send, CreditCard, Trash2 } from 'lucide-react';
import { LoanStatus, LoanRepaymentStatus, StaffStatus } from '@welfare/shared';
import type { ILoanRepayment } from '@welfare/shared';
import { getLoan, getLoanSchedule, getLoanDocumentUrl, recordPayment, exitSettle, getLoansByGuarantor, deleteLoan } from '@/lib/loans';
import { getStaff } from '@/lib/staff';
import { sendLoanSchedule } from '@/lib/email';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { RepaymentBar } from '@/components/ui/repayment-bar';
import { fmtGHS, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const EXIT_STATUSES = new Set<StaffStatus>([StaffStatus.Resigned, StaffStatus.Dismissed, StaffStatus.Deceased]);

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

function round2(n: number) { return Math.round(n * 100) / 100; }

function computeAffectedInstalments(schedule: ILoanRepayment[], amount: number) {
  let remaining = amount;
  const affected: Array<{ instalment: ILoanRepayment; applied: number }> = [];
  for (const inst of [...schedule].sort((a, b) => a.instalmentNumber - b.instalmentNumber)) {
    if (inst.status === LoanRepaymentStatus.Paid || inst.status === LoanRepaymentStatus.Waived) continue;
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

const repaymentStatusStyle: Record<LoanRepaymentStatus, string> = {
  [LoanRepaymentStatus.Pending]: 'bg-neutral-100 text-neutral-600',
  [LoanRepaymentStatus.Paid]:    'bg-success-50 text-success-700',
  [LoanRepaymentStatus.Partial]: 'bg-warning-50 text-warning-700',
  [LoanRepaymentStatus.Overdue]: 'bg-danger-50 text-danger-700',
  [LoanRepaymentStatus.Waived]:  'bg-info-50 text-info-700',
};

export function LoanDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sendingSchedule, setSendingSchedule] = useState(false);

  const { data: loan, isLoading: loanLoading } = useQuery({ queryKey: ['loans', id], queryFn: () => getLoan(id) });
  const { data: schedule, isLoading: scheduleLoading } = useQuery({
    queryKey: ['loans', id, 'schedule'],
    queryFn: () => getLoanSchedule(id),
    enabled: !!loan,
  });
  const { data: borrower } = useQuery({ queryKey: ['staff', loan?.staffId], queryFn: () => getStaff(loan!.staffId), enabled: !!loan });
  const { data: guarantor } = useQuery({ queryKey: ['staff', loan?.guarantorId], queryFn: () => getStaff(loan!.guarantorId), enabled: !!loan });
  const { data: guarantorLoans } = useQuery({ queryKey: ['loans', 'guarantor', loan?.guarantorId], queryFn: () => getLoansByGuarantor(loan!.guarantorId), enabled: !!loan });
  const activeGuaranteeCount = guarantorLoans?.data.filter((l) => l.status === LoanStatus.Active).length ?? 0;

  const paymentForm    = useForm<PaymentForm>({ resolver: zodResolver(paymentSchema) });
  const settlementForm = useForm<SettlementForm>({ resolver: zodResolver(settlementSchema), defaultValues: { exitDeductionAmount: 0 } });

  const paymentAmount = paymentForm.watch('amount');

  const affectedInstalments = useMemo(() => {
    if (!schedule || !paymentAmount) return [];
    return computeAffectedInstalments(schedule, paymentAmount);
  }, [schedule, paymentAmount]);

  const summary = useMemo(() => {
    if (!schedule) return { totalPaid: 0, outstanding: 0, nextDueDate: null as string | null, nextDueAmount: 0 };
    const totalPaid = round2(schedule.reduce((s, r) => s + r.paidAmount, 0));
    const outstanding = round2(schedule.reduce((s, r) => s + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount), 0));
    const next = schedule.find((r) => r.status !== LoanRepaymentStatus.Paid && r.status !== LoanRepaymentStatus.Waived);
    return { totalPaid, outstanding, nextDueDate: next?.dueDate ?? null, nextDueAmount: next ? round2(next.dueAmount + next.penaltyAmount - next.paidAmount) : 0 };
  }, [schedule]);

  const deductionAmount         = settlementForm.watch('exitDeductionAmount') ?? 0;
  const amountCovered           = round2(Math.min(deductionAmount, summary.outstanding));
  const remainingAfterDeduction = round2(Math.max(0, summary.outstanding - deductionAmount));

  const paymentMutation = useMutation({
    mutationFn: (values: PaymentForm) => recordPayment(id, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans', id] }); setShowPaymentModal(false); paymentForm.reset(); toast.success('Payment recorded'); },
    onError: (err: unknown) => { toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Payment failed'); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLoan(id),
    onSuccess: () => { toast.success('Loan deleted'); router.push('/loans'); qc.invalidateQueries({ queryKey: ['loans'] }); },
    onError: (err: unknown) => { toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed'); },
  });

  const settlementMutation = useMutation({
    mutationFn: (values: SettlementForm) => exitSettle(id, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans', id] }); toast.success('Exit settlement recorded'); },
    onError: (err: unknown) => { toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Settlement failed'); },
  });

  async function handleDownloadDoc() {
    try { window.open(await getLoanDocumentUrl(id), '_blank'); }
    catch { toast.error('Document not found'); }
  }

  if (loanLoading) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (!loan) return <p className="text-sm text-danger-600">Loan not found.</p>;

  const showExitPanel = !!borrower && EXIT_STATUSES.has(borrower.status) && loan.status === LoanStatus.Active;
  const showSettlementSummary = loan.status !== LoanStatus.Active &&
    ((loan.exitDeductionAmount ?? 0) > 0 || (loan.guarantorOffsetAmount ?? 0) > 0 || (loan.badDebtAmount ?? 0) > 0);

  const paidPct = loan.totalRepayable > 0 ? Math.round((summary.totalPaid / loan.totalRepayable) * 100) : 0;

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <Card>
        <CardBody className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900">{borrower?.fullName ?? '—'}</h1>
              <StatusBadge status={loan.status} />
            </div>
            <p className="text-sm text-neutral-500 mt-1">
              Principal: <span className="font-medium text-neutral-900 font-mono tabular">{fmtGHS(loan.principalAmount)}</span>
              &nbsp;·&nbsp;Tenure: <span className="font-medium text-neutral-900">{loan.tenureMonths}mo</span>
              &nbsp;·&nbsp;Disbursed: <span className="font-medium text-neutral-900 font-mono tabular">{fmtDate(loan.disbursedDate)}</span>
            </p>
            <p className="text-sm text-neutral-500 mt-0.5">
              Guarantor: <span className="font-medium text-neutral-900">{guarantor?.fullName ?? '—'}</span>
              &nbsp;<span className="text-neutral-400">({activeGuaranteeCount} active guarantee{activeGuaranteeCount !== 1 ? 's' : ''})</span>
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {loan.documentKey && (
              <Button variant="secondary" size="sm" Icon={Download} onClick={handleDownloadDoc}>Document</Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              Icon={Send}
              loading={sendingSchedule}
              onClick={async () => {
                setSendingSchedule(true);
                try { await sendLoanSchedule(id); toast.success('Schedule emailed'); }
                catch { toast.error('Failed to send schedule'); }
                finally { setSendingSchedule(false); }
              }}
            >
              Email Schedule
            </Button>
            {loan.status === LoanStatus.Active && (
              <Button variant="primary" size="sm" Icon={CreditCard} onClick={() => setShowPaymentModal(true)}>
                Record Payment
              </Button>
            )}
            <Button variant="danger" size="sm" Icon={Trash2} onClick={() => setShowDeleteModal(true)}>
              Delete
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Payment summary */}
      <Card>
        <CardHeader title="Payment Summary" />
        <CardBody>
          <div className="grid grid-cols-4 gap-4 mb-4">
            {([
              ['Total Paid',     fmtGHS(summary.totalPaid)],
              ['Outstanding',    fmtGHS(summary.outstanding)],
              ['Next Due Date',  summary.nextDueDate ? fmtDate(summary.nextDueDate) : '—'],
              ['Next Due Amt',   summary.nextDueAmount > 0 ? fmtGHS(summary.nextDueAmount) : '—'],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">{label}</p>
                <p className="text-lg font-bold text-neutral-900 mt-0.5 font-mono tabular">{value}</p>
              </div>
            ))}
          </div>
          <RepaymentBar
            paid={summary.totalPaid}
            total={loan.totalRepayable}
            overdue={summary.outstanding > 0 && loan.status === LoanStatus.Active && summary.nextDueDate ? new Date(summary.nextDueDate) < new Date() : false}
            partial={paidPct > 0 && paidPct < 100}
          />
        </CardBody>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader title="Repayment Schedule" />
        <CardBody noPadding>
          {scheduleLoading ? (
            <p className="px-5 py-4 text-sm text-neutral-400">Loading schedule…</p>
          ) : !schedule?.length ? (
            <p className="px-5 py-4 text-sm text-neutral-400">No schedule found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {([
                      { label: '#',             align: 'left'  },
                      { label: 'Due Date',      align: 'left'  },
                      { label: 'Principal',     align: 'right' },
                      { label: 'Interest',      align: 'right' },
                      { label: 'Paid (Int.)',   align: 'right' },
                      { label: 'Paid (Prin.)',  align: 'right' },
                      { label: 'Penalty',       align: 'right' },
                      { label: 'Status',        align: 'left'  },
                      { label: 'Source',        align: 'left'  },
                    ] as { label: string; align: 'left' | 'right' }[]).map((h) => (
                      <th key={h.label} className={`px-4 py-2 text-${h.align} text-xs font-semibold text-neutral-500 uppercase tracking-wide`}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {schedule.map((row) => {
                    const isOverdue   = row.status === LoanRepaymentStatus.Overdue;
                    const isGuarantor = row.source  === 'GuarantorOffset';
                    return (
                      <tr
                        key={row._id}
                        className={cn(
                          isOverdue   ? 'bg-danger-50' :
                          isGuarantor ? 'bg-accent-50' :
                          'hover:bg-neutral-50',
                        )}
                      >
                        <td className="px-4 py-2 text-neutral-500">{row.instalmentNumber}</td>
                        <td className="px-4 py-2 font-mono tabular">{fmtDate(row.dueDate)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular">
                          {row.principalAmount != null ? fmtGHS(row.principalAmount) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular">
                          {row.interestAmount != null ? fmtGHS(row.interestAmount) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular">
                          {row.interestAmount != null ? fmtGHS(Math.min(row.paidAmount, row.interestAmount)) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular">
                          {row.interestAmount != null ? fmtGHS(Math.max(0, row.paidAmount - row.interestAmount)) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular">
                          {row.penaltyAmount > 0 ? <span className="text-danger-600">{fmtGHS(row.penaltyAmount)}</span> : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span className={cn('px-2 py-0.5 rounded-xs text-xs font-medium', repaymentStatusStyle[row.status])}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-neutral-500">
                          {isGuarantor ? <span className="text-accent-700 font-medium">Guarantor offset</span> : (row.source ?? '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Exit settlement panel */}
      {showExitPanel && (
        <Card className="border-warning-300">
          <CardHeader title="Exit Settlement" subtitle={`${borrower?.fullName} has status ${borrower?.status}. Record exit settlement below.`} />
          <CardBody>
            <p className="text-sm text-neutral-600 mb-4">
              Outstanding balance: <span className="font-semibold font-mono tabular">{fmtGHS(summary.outstanding)}</span>
            </p>
            <form onSubmit={settlementForm.handleSubmit((v) => settlementMutation.mutate(v))} className="space-y-4">
              <Field label="Deduction from Final Pay / Gratuity" required>
                <Input {...settlementForm.register('exitDeductionAmount')} type="number" min={0} step="0.01" />
              </Field>
              {deductionAmount >= 0 && summary.outstanding > 0 && (
                <div className="bg-warning-50 border border-warning-200 rounded-sm p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-neutral-600">Covered by deduction:</span>
                    <span className="font-mono tabular font-medium">{fmtGHS(amountCovered)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">Remaining balance:</span>
                    <span className={cn('font-mono tabular font-medium', remainingAfterDeduction > 0 ? 'text-warning-700' : 'text-success-700')}>
                      {fmtGHS(remainingAfterDeduction)}
                    </span>
                  </div>
                  {remainingAfterDeduction > 0 && (
                    <p className="text-xs text-warning-600 mt-1">Remaining will be offset against guarantor contributions where available; remainder becomes bad debt.</p>
                  )}
                </div>
              )}
              <Field label="Notes">
                <textarea
                  {...settlementForm.register('notes')}
                  rows={2}
                  className="w-full border border-neutral-200 rounded-sm px-3 py-2 text-base focus:outline-none focus:border-primary-500 focus:shadow-focus resize-none"
                />
              </Field>
              <Button type="submit" variant="danger" loading={settlementMutation.isPending}>
                Confirm Exit Settlement
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Settlement summary */}
      {showSettlementSummary && (
        <Card>
          <CardHeader title="Settlement Summary" />
          <CardBody>
            <div className="grid grid-cols-3 gap-4">
              {([
                ['Exit Deduction',   loan.exitDeductionAmount   ?? 0, false],
                ['Guarantor Offset', loan.guarantorOffsetAmount ?? 0, false],
                ['Bad Debt',         loan.badDebtAmount         ?? 0, true],
              ] as [string, number, boolean][]).map(([label, value, red]) => (
                <div key={label}>
                  <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">{label}</p>
                  <p className={cn('text-lg font-bold font-mono tabular mt-0.5', red && value > 0 ? 'text-danger-600' : 'text-neutral-900')}>
                    {fmtGHS(value)}
                  </p>
                </div>
              ))}
            </div>
            {loan.settledAt && (
              <p className="text-xs text-neutral-400 mt-3">Settled on {fmtDate(loan.settledAt)}</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteModal && (
        <Modal
          open
          onClose={() => setShowDeleteModal(false)}
          title="Delete Loan"
          size="sm"
          icon={<Trash2 size={20} strokeWidth={1.75} />}
          iconKind="danger"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
              <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                Delete Loan
              </Button>
            </>
          }
        >
          <p className="text-sm text-neutral-700 mt-2">
            Permanently delete this loan and all repayment records? This cannot be undone.
          </p>
          {loan.status === LoanStatus.Active && (
            <p className="text-xs text-warning-700 mt-2 bg-warning-50 border border-warning-200 rounded-sm px-3 py-2">
              Active loans with recorded payments cannot be deleted.
            </p>
          )}
        </Modal>
      )}

      {/* Record Payment Modal */}
      {showPaymentModal && (
        <Modal
          open
          onClose={() => { setShowPaymentModal(false); paymentForm.reset(); }}
          title="Record Payment"
          size="sm"
          icon={<CreditCard size={20} strokeWidth={1.75} />}
          iconKind="success"
          footer={
            <>
              <Button variant="secondary" onClick={() => { setShowPaymentModal(false); paymentForm.reset(); }}>Cancel</Button>
              <Button variant="primary" loading={paymentMutation.isPending} onClick={paymentForm.handleSubmit((v) => paymentMutation.mutate(v))}>
                Record Payment
              </Button>
            </>
          }
        >
          <form onSubmit={paymentForm.handleSubmit((v) => paymentMutation.mutate(v))} className="space-y-4 mt-2">
            <Field label="Amount" required error={paymentForm.formState.errors.amount?.message}>
              <Input {...paymentForm.register('amount')} type="number" min="0.01" step="0.01" error={!!paymentForm.formState.errors.amount} />
            </Field>
            <Field label="Payment Date" required error={paymentForm.formState.errors.paidDate?.message}>
              <Input {...paymentForm.register('paidDate')} type="date" error={!!paymentForm.formState.errors.paidDate} />
            </Field>
            <Field label="Notes">
              <textarea {...paymentForm.register('notes')} rows={2} className="w-full border border-neutral-200 rounded-sm px-3 py-2 text-base focus:outline-none focus:border-primary-500 focus:shadow-focus resize-none" />
            </Field>
            {affectedInstalments.length > 0 && (
              <div className="bg-primary-50 border border-primary-200 rounded-sm p-3 text-sm">
                <p className="text-xs font-semibold text-primary-700 mb-2">Instalments affected:</p>
                <ul className="space-y-1">
                  {affectedInstalments.map(({ instalment, applied }) => (
                    <li key={instalment._id} className="flex justify-between text-primary-800 text-xs">
                      <span>#{instalment.instalmentNumber} ({fmtDate(instalment.dueDate)})</span>
                      <span className="font-semibold font-mono tabular">+{fmtGHS(applied)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
