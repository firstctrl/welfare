'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { UserCog, Send, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { StaffStatus, ContributionStatus, LoanStatus } from '@welfare/shared';
import type { IStaff, IContribution, ILoan, ILoanRepayment } from '@welfare/shared';
import { getStaff, updateStaff, changeStaffStatus, uploadStaffPhoto } from '@/lib/staff';
import { getContributionsByStaff } from '@/lib/contributions';
import { getLoansByStaff, getLoansByGuarantor, getLoanSchedule } from '@/lib/loans';
import { getConfig } from '@/lib/config';
import { sendContributionStatement } from '@/lib/email';
import { Avatar } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { fmtDate, fmtGHS } from '@/lib/format';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const TABS = ['Profile', 'Contributions', 'Loans', 'Guaranteeing'] as const;
type Tab = (typeof TABS)[number];

const TERMINAL_STATUSES: StaffStatus[] = [
  StaffStatus.Resigned, StaffStatus.Retired, StaffStatus.Dismissed, StaffStatus.Deceased,
];

const profileSchema = z.object({
  fullName:                z.string().min(1, 'Required'),
  pfNo:                    z.string().min(1, 'Required'),
  phoneNumber:             z.string().min(1, 'Required'),
  email:                   z.string().email('Invalid email').optional().or(z.literal('')),
  dateOfBirth:             z.string().min(1, 'Required'),
  dateOfEmployment:        z.string().min(1, 'Required'),
  dateOfFirstContribution: z.string().min(1, 'Required'),
  level:                   z.string().min(1, 'Required'),
  point:                   z.coerce.number().min(0),
});
type ProfileForm = z.infer<typeof profileSchema>;

const statusSchema = z.object({
  status:        z.nativeEnum(StaffStatus),
  effectiveDate: z.string().min(1, 'Required'),
  notes:         z.string().optional(),
});
type StatusForm = z.infer<typeof statusSchema>;

function toDateInput(d: string) { return d.substring(0, 10); }

export default function StaffDetailClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('Profile');
  const [editing, setEditing] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [sendingStatement, setSendingStatement] = useState(false);
  const [statementYear, setStatementYear] = useState(new Date().getFullYear());

  const { data: staff, isLoading } = useQuery({ queryKey: ['staff', id], queryFn: () => getStaff(id) });

  const { data: contributions, isLoading: contribLoading } = useQuery({
    queryKey: ['contributions', 'staff', id],
    queryFn: () => getContributionsByStaff(id),
    enabled: activeTab === 'Contributions',
  });

  const { data: staffLoans, isLoading: loansLoading } = useQuery({
    queryKey: ['loans', 'staff', id],
    queryFn: () => getLoansByStaff(id),
    enabled: activeTab === 'Loans',
  });

  const { data: guaranteeLoans, isLoading: guaranteeLoading } = useQuery({
    queryKey: ['loans', 'guarantor', id],
    queryFn: () => getLoansByGuarantor(id),
    enabled: activeTab === 'Guaranteeing',
  });

  const { data: cfg } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === 'Guaranteeing',
  });
  const maxPerGuarantor = parseInt(cfg?.['MAX_LOANS_PER_GUARANTOR']?.value ?? '0', 10);

  const guaranteeScheduleQueries = useQueries({
    queries: (guaranteeLoans?.data ?? []).map((loan: ILoan) => ({
      queryKey: ['loans', loan._id, 'schedule'],
      queryFn: () => getLoanSchedule(loan._id),
      enabled: activeTab === 'Guaranteeing' && !!guaranteeLoans,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const offsetHistory = useMemo(() => {
    const all: Array<ILoanRepayment & { loanPrincipal: number; borrowerStaffId: string }> = [];
    (guaranteeLoans?.data ?? []).forEach((loan: ILoan, i: number) => {
      const schedule = guaranteeScheduleQueries[i]?.data ?? [];
      schedule
        .filter((r) => r.source === 'GuarantorOffset' && r.guarantorStaffId === id)
        .forEach((r) => all.push({ ...r, loanPrincipal: loan.principalAmount, borrowerStaffId: loan.staffId }));
    });
    return all.sort((a, b) =>
      new Date(b.paidDate ?? b.createdAt).getTime() - new Date(a.paidDate ?? a.createdAt).getTime(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guaranteeLoans, JSON.stringify(guaranteeScheduleQueries.map((q) => q.status)), id]);

  // Look up borrower staff records for the guaranteed loans (name + staffNo)
  const borrowerStaffIds = useMemo(() => {
    const set = new Set<string>();
    (guaranteeLoans?.data ?? []).forEach((l: ILoan) => set.add(l.staffId));
    return Array.from(set);
  }, [guaranteeLoans]);

  const borrowerStaffQueries = useQueries({
    queries: borrowerStaffIds.map((sid) => ({
      queryKey: ['staff', sid],
      queryFn: () => getStaff(sid),
      enabled: activeTab === 'Guaranteeing' && !!sid,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const borrowerMap = useMemo(() => {
    const map = new Map<string, IStaff>();
    borrowerStaffIds.forEach((sid, i) => {
      const data = borrowerStaffQueries[i]?.data;
      if (data) map.set(sid, data);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borrowerStaffIds, JSON.stringify(borrowerStaffQueries.map((q) => q.status))]);

  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema) });
  const statusForm = useForm<StatusForm>({ resolver: zodResolver(statusSchema) });

  const updateMutation = useMutation({
    mutationFn: (values: ProfileForm) => updateStaff(id, { ...values, email: values.email || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff', id] }); setEditing(false); toast.success('Profile updated'); },
    onError: (err: unknown) => { toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Update failed'); },
  });

  const statusMutation = useMutation({
    mutationFn: (values: StatusForm) => changeStaffStatus(id, values),
    onMutate: async (values) => {
      await qc.cancelQueries({ queryKey: ['staff', id] });
      const previous = qc.getQueryData<IStaff>(['staff', id]);
      qc.setQueryData<IStaff>(['staff', id], (old) => old ? { ...old, status: values.status } : old);
      return { previous };
    },
    onError: (err: unknown, _values, context) => {
      if (context?.previous) qc.setQueryData(['staff', id], context.previous);
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Status change failed');
    },
    onSuccess: ({ requiresSettlement }) => {
      setShowStatusModal(false);
      if (requiresSettlement) toast.warning('Status updated. Outstanding loans require exit settlement.');
      else toast.success('Status updated');
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['staff', id] }); qc.invalidateQueries({ queryKey: ['staff'] }); },
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => uploadStaffPhoto(id, file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff', id] }); toast.success('Photo updated'); },
    onError: (err: unknown) => { toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Photo upload failed'); },
  });

  function startEdit(s: IStaff) {
    profileForm.reset({
      fullName: s.fullName, pfNo: s.pfNo, phoneNumber: s.phoneNumber, email: s.email ?? '',
      dateOfBirth: toDateInput(s.dateOfBirth), dateOfEmployment: toDateInput(s.dateOfEmployment),
      dateOfFirstContribution: toDateInput(s.dateOfFirstContribution), level: s.level, point: s.point,
    });
    setEditing(true);
  }

  if (isLoading) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (!staff) return <p className="text-sm text-danger-600">Staff not found.</p>;

  const isTerminal = TERMINAL_STATUSES.includes(staff.status);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header card */}
      <Card>
        <CardBody className="flex items-start gap-5">
          {/* Photo */}
          <div className="relative group shrink-0">
            {staff.photoKey ? (
              <img
                src={`/api/staff/${id}/photo-proxy`}
                alt={staff.fullName}
                className="w-18 h-18 rounded-pill object-cover border border-neutral-200"
              />
            ) : (
              <Avatar name={staff.fullName} size="lg" />
            )}
            <label className="absolute inset-0 rounded-pill flex items-center justify-center bg-neutral-900/40 opacity-0 group-hover:opacity-100 cursor-pointer text-white text-xs font-semibold transition-opacity duration-fast">
              Upload
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && photoMutation.mutate(e.target.files[0])}
              />
            </label>
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900 truncate">{staff.fullName}</h1>
              <StatusBadge status={staff.status} />
              {!staff.email && (
                <span className="px-2 py-0.5 rounded-xs bg-warning-50 text-warning-700 text-xs font-medium border border-warning-200">
                  No email
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-500 mt-1">
              Staff ID: {staff.staffId} &middot; PF: {staff.pfNo} &middot; Level: {staff.level}
            </p>
            {!isTerminal && (
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  Icon={UserCog}
                  onClick={() => setShowStatusModal(true)}
                >
                  Change Status
                </Button>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Tabs */}
      <div className="border-b border-neutral-200">
        <nav className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 pb-3 text-sm font-medium border-b-2 transition-colors duration-fast',
                activeTab === tab
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800',
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Profile Tab */}
      {activeTab === 'Profile' && (
        <Card>
          <CardHeader
            title="Profile Information"
            action={
              !editing && (
                <Button
                  variant="secondary"
                  size="sm"
                  Icon={Pencil}
                  onClick={() => startEdit(staff)}
                >
                  Edit
                </Button>
              )
            }
          />
          <CardBody>
            {!editing ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {(
                    [
                      ['Full Name', staff.fullName],
                      ['Staff ID', staff.staffId],
                      ['PF Number', staff.pfNo],
                      ['Phone', staff.phoneNumber],
                      ['Email', staff.email ?? '—'],
                      ['Level', staff.level],
                      ['Points', String(staff.point)],
                      ['Date of Birth', fmtDate(staff.dateOfBirth)],
                      ['Date of Employment', fmtDate(staff.dateOfEmployment)],
                      ['First Contribution', fmtDate(staff.dateOfFirstContribution)],
                    ] as [string, string][]
                  ).map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">
                        {label}
                      </p>
                      <p className="text-base font-medium text-neutral-900 mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Statement sender */}
                <div className="flex items-center gap-3 pt-3 border-t border-neutral-100">
                  <Input
                    type="number"
                    min={2000}
                    max={2100}
                    value={statementYear}
                    onChange={(e) => setStatementYear(parseInt(e.target.value, 10))}
                    style={{ width: 100 }}
                  />
                  <Button
                    variant="secondary"
                    Icon={Send}
                    disabled={!staff.email || sendingStatement}
                    loading={sendingStatement}
                    onClick={async () => {
                      setSendingStatement(true);
                      try {
                        await sendContributionStatement(id, statementYear);
                        toast.success('Statement sent');
                      } catch {
                        toast.error('Failed to send statement');
                      } finally {
                        setSendingStatement(false);
                      }
                    }}
                    title={!staff.email ? 'No email address on file' : undefined}
                  >
                    Send Statement
                  </Button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={profileForm.handleSubmit((v) => updateMutation.mutate(v))}
                className="space-y-5"
              >
                <div className="grid grid-cols-2 gap-4">
                  {(
                    [
                      ['fullName', 'Full Name', 'text'],
                      ['pfNo', 'PF Number', 'text'],
                      ['phoneNumber', 'Phone Number', 'text'],
                      ['email', 'Email', 'email'],
                      ['level', 'Level', 'text'],
                      ['point', 'Points', 'number'],
                      ['dateOfBirth', 'Date of Birth', 'date'],
                      ['dateOfEmployment', 'Date of Employment', 'date'],
                      ['dateOfFirstContribution', 'Date of First Contribution', 'date'],
                    ] as [keyof ProfileForm, string, string][]
                  ).map(([field, label, type]) => (
                    <Field
                      key={field}
                      label={label}
                      error={profileForm.formState.errors[field]?.message}
                    >
                      <Input
                        {...profileForm.register(field)}
                        type={type}
                        error={!!profileForm.formState.errors[field]}
                      />
                    </Field>
                  ))}
                </div>
                <div className="flex gap-3 pt-2 border-t border-neutral-100">
                  <Button type="submit" variant="primary" loading={updateMutation.isPending}>
                    Save Changes
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      {/* Contributions Tab */}
      {activeTab === 'Contributions' && (
        <Card>
          <CardHeader
            title="Contribution Ledger"
            action={
              <Button
                variant="secondary"
                size="sm"
                Icon={Plus}
                onClick={() => (window.location.href = '/contributions/manual')}
              >
                Add Manual Entry
              </Button>
            }
          />
          <CardBody noPadding>
            {contribLoading ? (
              <p className="px-5 py-4 text-sm text-neutral-400">Loading…</p>
            ) : !contributions?.length ? (
              <p className="px-5 py-8 text-sm text-neutral-400 text-center">
                No contributions recorded yet.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-200 bg-neutral-50">
                        {[
                          'Month',
                          'Year',
                          'Expected',
                          'Paid',
                          'Surplus C/F',
                          'Status',
                          'Source',
                          'Recorded By',
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {contributions.map((c: IContribution) => (
                        <tr key={c._id} className="hover:bg-neutral-50">
                          <td className="px-4 py-2">{MONTHS[c.month - 1]}</td>
                          <td className="px-4 py-2">{c.year}</td>
                          <td className="px-4 py-2 text-right font-mono tabular">
                            {fmtGHS(c.expectedAmount)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular">
                            {fmtGHS(c.paidAmount)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular">
                            {fmtGHS(c.surplusCarriedForward)}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded-xs text-xs font-medium',
                                c.status === ContributionStatus.Paid
                                  ? 'bg-success-50 text-success-700'
                                  : c.status === ContributionStatus.Partial
                                    ? 'bg-warning-50 text-warning-700'
                                    : c.status === ContributionStatus.Missed
                                      ? 'bg-danger-50 text-danger-700'
                                      : 'bg-info-50 text-info-700',
                              )}
                            >
                              {c.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-neutral-500">{c.source}</td>
                          <td className="px-4 py-2 text-neutral-500">{c.recordedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-neutral-200 bg-neutral-50">
                      <tr>
                        <td
                          colSpan={2}
                          className="px-4 py-2 text-xs font-semibold text-neutral-600"
                        >
                          Totals
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-semibold text-neutral-700 font-mono tabular">
                          {fmtGHS(contributions.reduce((s, c) => s + c.expectedAmount, 0))}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-semibold text-neutral-700 font-mono tabular">
                          {fmtGHS(contributions.reduce((s, c) => s + c.paidAmount, 0))}
                        </td>
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {/* Loans Tab */}
      {activeTab === 'Loans' && (
        <Card>
          <CardHeader
            title="Loan History"
            action={
              <Button
                variant="secondary"
                size="sm"
                Icon={Plus}
                onClick={() => (window.location.href = '/loans/new')}
              >
                Record New Loan
              </Button>
            }
          />
          <CardBody noPadding>
            {loansLoading ? (
              <p className="px-5 py-4 text-sm text-neutral-400">Loading…</p>
            ) : !staffLoans?.data.length ? (
              <p className="px-5 py-8 text-sm text-neutral-400 text-center">No loans on record.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      {['Principal', 'Total Repayable', 'Tenure', 'Disbursed', 'Status', ''].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {staffLoans.data.map((loan: ILoan) => (
                      <tr key={loan._id} className="hover:bg-neutral-50">
                        <td className="px-4 py-2 font-mono tabular font-medium">
                          {fmtGHS(loan.principalAmount)}
                        </td>
                        <td className="px-4 py-2 font-mono tabular">
                          {fmtGHS(loan.totalRepayable)}
                        </td>
                        <td className="px-4 py-2">{loan.tenureMonths}mo</td>
                        <td className="px-4 py-2 font-mono tabular">
                          {fmtDate(loan.disbursedDate)}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={loan.status} />
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/loans/${loan._id}`}
                            className="text-primary-600 text-xs hover:underline"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Guaranteeing Tab */}
      {activeTab === 'Guaranteeing' && (
        <div className="space-y-5">
          {guaranteeLoading ? (
            <p className="text-sm text-neutral-400">Loading…</p>
          ) : !guaranteeLoans?.data.length ? (
            <p className="text-sm text-neutral-400 py-8 text-center">
              Not currently guaranteeing any loans.
            </p>
          ) : (
            <>
              {(() => {
                const active = guaranteeLoans.data.filter(
                  (l: ILoan) => l.status === LoanStatus.Active,
                );
                const totalExposure = active.reduce(
                  (sum: number, l: ILoan) => sum + l.totalRepayable,
                  0,
                );
                const atCap = maxPerGuarantor > 0 && active.length >= maxPerGuarantor;
                return (
                  <Card>
                    <CardBody className={cn('flex flex-wrap gap-6', atCap && 'bg-danger-50')}>
                      <div>
                        <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">
                          Active Guarantees
                        </p>
                        <p className="text-xl font-bold text-neutral-900 mt-0.5">{active.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">
                          Total Exposure
                        </p>
                        <p className="text-xl font-bold text-neutral-900 mt-0.5 font-mono tabular">
                          {fmtGHS(totalExposure)}
                        </p>
                      </div>
                      {atCap && (
                        <div className="flex items-center">
                          <span className="px-2 py-0.5 rounded-xs text-xs font-medium bg-danger-100 text-danger-700">
                            At cap ({active.length}/{maxPerGuarantor})
                          </span>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                );
              })()}

              <Card>
                <CardHeader title="Co-Signed Loans" />
                <CardBody noPadding>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50">
                          {[
                            'Borrower',
                            'Principal',
                            'Outstanding',
                            'Disbursed',
                            'Status',
                            '',
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {guaranteeLoans.data.map((loan: ILoan, i: number) => {
                          const schedule = guaranteeScheduleQueries[i]?.data;
                          const outstanding = schedule
                            ? Math.round(
                                schedule.reduce(
                                  (s, r) =>
                                    s + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount),
                                  0,
                                ) * 100,
                              ) / 100
                            : null;
                          const borrower = borrowerMap.get(loan.staffId);
                          return (
                            <tr key={loan._id} className="hover:bg-neutral-50">
                              <td className="px-4 py-2">
                                {borrower ? (
                                  <Link href={`/staff/${loan.staffId}`} className="hover:underline">
                                    <span className="text-neutral-900">{borrower.fullName}</span>
                                    <span className="ml-1.5 text-xs text-neutral-400 font-mono">{borrower.pfNo}</span>
                                  </Link>
                                ) : (
                                  <span className="font-mono text-xs text-neutral-400">{loan.staffId.slice(-8)}</span>
                                )}
                              </td>
                              <td className="px-4 py-2 font-mono tabular">
                                {fmtGHS(loan.principalAmount)}
                              </td>
                              <td className="px-4 py-2 font-mono tabular">
                                {outstanding === null ? (
                                  <span className="text-neutral-300">…</span>
                                ) : (
                                  fmtGHS(outstanding)
                                )}
                              </td>
                              <td className="px-4 py-2 font-mono tabular">
                                {fmtDate(loan.disbursedDate)}
                              </td>
                              <td className="px-4 py-2">
                                <StatusBadge status={loan.status} />
                              </td>
                              <td className="px-4 py-2">
                                <Link
                                  href={`/loans/${loan._id}`}
                                  className="text-primary-600 text-xs hover:underline"
                                >
                                  View
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>

              {offsetHistory.length > 0 && (
                <Card>
                  <CardHeader title="Offset History" />
                  <CardBody noPadding>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-neutral-200 bg-neutral-50">
                            {['Date', 'Borrower', 'Loan Principal', 'Instalment #', 'Amount Applied'].map(
                              (h) => (
                                <th
                                  key={h}
                                  className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide"
                                >
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {offsetHistory.map((r) => {
                            const b = borrowerMap.get(r.borrowerStaffId);
                            return (
                            <tr key={r._id} className="bg-accent-50">
                              <td className="px-4 py-2 font-mono tabular">
                                {r.paidDate ? fmtDate(r.paidDate) : '—'}
                              </td>
                              <td className="px-4 py-2">
                                {b ? (
                                  <Link href={`/staff/${r.borrowerStaffId}`} className="hover:underline">
                                    <span className="text-neutral-900">{b.fullName}</span>
                                    <span className="ml-1.5 text-xs text-neutral-400 font-mono">{b.pfNo}</span>
                                  </Link>
                                ) : (
                                  <span className="font-mono text-xs text-neutral-400">{r.borrowerStaffId.slice(-8)}</span>
                                )}
                              </td>
                              <td className="px-4 py-2 font-mono tabular">
                                {fmtGHS(r.loanPrincipal)}
                              </td>
                              <td className="px-4 py-2">{r.instalmentNumber}</td>
                              <td className="px-4 py-2 font-mono tabular font-semibold text-accent-700">
                                {fmtGHS(r.paidAmount)}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* Status Change Modal */}
      {showStatusModal && (
        <Modal
          open
          onClose={() => setShowStatusModal(false)}
          title="Change Staff Status"
          size="sm"
          icon={<UserCog size={20} strokeWidth={1.75} />}
          iconKind="warning"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowStatusModal(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={statusMutation.isPending}
                onClick={statusForm.handleSubmit((v) => statusMutation.mutate(v))}
              >
                Confirm Change
              </Button>
            </>
          }
        >
          <form
            onSubmit={statusForm.handleSubmit((v) => statusMutation.mutate(v))}
            className="space-y-4 mt-2"
          >
            <Field label="New Status" required error={statusForm.formState.errors.status?.message}>
              <Select
                {...statusForm.register('status')}
                error={!!statusForm.formState.errors.status}
                placeholder="Select new status…"
                options={TERMINAL_STATUSES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
            <Field
              label="Effective Date"
              required
              error={statusForm.formState.errors.effectiveDate?.message}
            >
              <Input
                {...statusForm.register('effectiveDate')}
                type="date"
                error={!!statusForm.formState.errors.effectiveDate}
              />
            </Field>
            <Field label="Notes" error={statusForm.formState.errors.notes?.message}>
              <textarea
                {...statusForm.register('notes')}
                rows={3}
                className="w-full border border-neutral-200 rounded-sm px-3 py-2 text-base focus:outline-none focus:border-primary-500 focus:shadow-focus resize-none"
              />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}
