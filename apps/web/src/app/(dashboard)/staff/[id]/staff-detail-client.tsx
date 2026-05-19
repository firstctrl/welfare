'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { StaffStatus, ContributionStatus, LoanStatus, RepaymentSource } from '@welfare/shared';
import type { IStaff, IContribution, ILoan, ILoanRepayment } from '@welfare/shared';
import { getStaff, updateStaff, changeStaffStatus, uploadStaffPhoto } from '@/lib/staff';
import { getContributionsByStaff } from '@/lib/contributions';
import { getLoansByStaff, getLoansByGuarantor, getLoanSchedule } from '@/lib/loans';
import { getConfig } from '@/lib/config';
import { sendContributionStatement } from '@/lib/email';

const STATUS_BADGE: Record<StaffStatus, string> = {
  [StaffStatus.Active]:    'bg-green-100 text-green-800',
  [StaffStatus.Resigned]:  'bg-gray-100 text-gray-600',
  [StaffStatus.Retired]:   'bg-blue-100 text-blue-700',
  [StaffStatus.Dismissed]: 'bg-red-100 text-red-700',
  [StaffStatus.Deceased]:  'bg-black text-white',
};

const TABS = ['Profile', 'Contributions', 'Loans', 'Guaranteeing'] as const;
type Tab = (typeof TABS)[number];

const TERMINAL_STATUSES: StaffStatus[] = [
  StaffStatus.Resigned,
  StaffStatus.Retired,
  StaffStatus.Dismissed,
  StaffStatus.Deceased,
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

function toDateInput(d: string) {
  return d.substring(0, 10);
}

const inputClass =
  'w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function StaffDetailClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('Profile');
  const [editing, setEditing] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [sendingStatement, setSendingStatement] = useState(false);
  const [statementYear, setStatementYear] = useState(new Date().getFullYear());

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff', id],
    queryFn: () => getStaff(id),
  });

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
    const all: Array<ILoanRepayment & { loanPrincipal: number }> = [];
    (guaranteeLoans?.data ?? []).forEach((loan: ILoan, i: number) => {
      const schedule = guaranteeScheduleQueries[i]?.data ?? [];
      schedule
        .filter(
          (r) =>
            r.source === RepaymentSource.GuarantorOffset &&
            r.guarantorStaffId === id,
        )
        .forEach((r) => all.push({ ...r, loanPrincipal: loan.principalAmount }));
    });
    return all.sort(
      (a, b) =>
        new Date(b.paidDate ?? b.createdAt).getTime() -
        new Date(a.paidDate ?? a.createdAt).getTime(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guaranteeLoans, JSON.stringify(guaranteeScheduleQueries.map((q) => q.status)), id]);

  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema) });
  const statusForm = useForm<StatusForm>({ resolver: zodResolver(statusSchema) });

  const updateMutation = useMutation({
    mutationFn: (values: ProfileForm) =>
      updateStaff(id, { ...values, email: values.email || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', id] });
      setEditing(false);
      toast.success('Profile updated');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Update failed');
    },
  });

  const statusMutation = useMutation({
    mutationFn: (values: StatusForm) => changeStaffStatus(id, values),
    onMutate: async (values) => {
      await qc.cancelQueries({ queryKey: ['staff', id] });
      const previous = qc.getQueryData<IStaff>(['staff', id]);
      qc.setQueryData<IStaff>(['staff', id], (old) =>
        old ? { ...old, status: values.status } : old,
      );
      return { previous };
    },
    onError: (err: unknown, _values, context) => {
      if (context?.previous) qc.setQueryData(['staff', id], context.previous);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Status change failed');
    },
    onSuccess: ({ requiresSettlement }) => {
      setShowStatusModal(false);
      if (requiresSettlement) {
        toast.warning('Status updated. Outstanding loans require exit settlement.');
      } else {
        toast.success('Status updated');
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['staff', id] });
      qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => uploadStaffPhoto(id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', id] });
      toast.success('Photo updated');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Photo upload failed');
    },
  });

  function startEdit(s: IStaff) {
    profileForm.reset({
      fullName:                s.fullName,
      pfNo:                    s.pfNo,
      phoneNumber:             s.phoneNumber,
      email:                   s.email ?? '',
      dateOfBirth:             toDateInput(s.dateOfBirth),
      dateOfEmployment:        toDateInput(s.dateOfEmployment),
      dateOfFirstContribution: toDateInput(s.dateOfFirstContribution),
      level:                   s.level,
      point:                   s.point,
    });
    setEditing(true);
  }

  if (isLoading) return <div className="text-sm text-gray-500">Loading...</div>;
  if (!staff) return <div className="text-sm text-red-500">Staff not found.</div>;

  const isTerminal = TERMINAL_STATUSES.includes(staff.status);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-6">
        <div className="relative group shrink-0">
          <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-2xl text-gray-500 overflow-hidden">
            {staff.photoKey ? (
              <img
                src={`/api/staff/${id}/photo-proxy`}
                alt={staff.fullName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{staff.fullName.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <label className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 cursor-pointer text-white text-xs font-medium">
            Upload
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && photoMutation.mutate(e.target.files[0])}
            />
          </label>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <h1 className="text-2xl font-semibold text-gray-900 truncate">{staff.fullName}</h1>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[staff.status]}`}
            >
              {staff.status}
            </span>
            {!staff.email && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">
                Email missing
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {staff.staffId} &middot; PF: {staff.pfNo} &middot; {staff.level}
          </p>
          {!isTerminal && (
            <div className="mt-3">
              <button
                onClick={() => setShowStatusModal(true)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Change Status
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Profile Tab */}
      {activeTab === 'Profile' && (
        <div>
          {!editing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                {(
                  [
                    ['Full Name', staff.fullName],
                    ['Staff ID', staff.staffId],
                    ['PF Number', staff.pfNo],
                    ['Phone', staff.phoneNumber],
                    ['Email', staff.email ?? '—'],
                    ['Level', staff.level],
                    ['Points', String(staff.point)],
                    ['Date of Birth', new Date(staff.dateOfBirth).toLocaleDateString('en-GB')],
                    [
                      'Date of Employment',
                      new Date(staff.dateOfEmployment).toLocaleDateString('en-GB'),
                    ],
                    [
                      'First Contribution',
                      new Date(staff.dateOfFirstContribution).toLocaleDateString('en-GB'),
                    ],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-gray-500">{label}</p>
                    <p className="font-medium text-gray-900 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => startEdit(staff)}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Edit Profile
                </button>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={statementYear}
                    onChange={(e) => setStatementYear(parseInt(e.target.value, 10))}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    disabled={!staff.email || sendingStatement}
                    onClick={async () => {
                      setSendingStatement(true);
                      try {
                        await sendContributionStatement(id, statementYear);
                        toast.success('Contribution statement sent');
                      } catch {
                        toast.error('Failed to send statement');
                      } finally {
                        setSendingStatement(false);
                      }
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!staff.email ? 'No email address on file' : 'Send contribution statement'}
                  >
                    {sendingStatement ? 'Sending…' : 'Send Statement'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form
              onSubmit={profileForm.handleSubmit((v) => updateMutation.mutate(v))}
              className="space-y-4"
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
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">{label}</label>
                    <input
                      {...profileForm.register(field)}
                      type={type}
                      className={inputClass}
                    />
                    {profileForm.formState.errors[field] && (
                      <p className="text-xs text-red-600">
                        {profileForm.formState.errors[field]?.message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {activeTab === 'Contributions' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-gray-700">Contribution Ledger</h3>
            <a
              href="/contributions/manual"
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              + Add Manual Entry
            </a>
          </div>
          {contribLoading ? (
            <div className="text-sm text-gray-400 py-4">Loading...</div>
          ) : !contributions?.length ? (
            <div className="text-sm text-gray-400 py-8 text-center">No contributions recorded yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Month', 'Year', 'Expected', 'Paid', 'Surplus C/F', 'Status', 'Source', 'Recorded By'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {contributions.map((c: IContribution) => (
                    <tr key={c._id}>
                      <td className="px-3 py-2">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][c.month - 1]}</td>
                      <td className="px-3 py-2">{c.year}</td>
                      <td className="px-3 py-2 text-right">{c.expectedAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{c.paidAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{c.surplusCarriedForward.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === ContributionStatus.Paid ? 'bg-green-100 text-green-800' :
                          c.status === ContributionStatus.Partial ? 'bg-yellow-100 text-yellow-800' :
                          c.status === ContributionStatus.Missed ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{c.source}</td>
                      <td className="px-3 py-2 text-gray-500">{c.recordedBy}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-xs font-medium text-gray-600">Totals</td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                      {contributions.reduce((s, c) => s + c.expectedAmount, 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                      {contributions.reduce((s, c) => s + c.paidAmount, 0).toLocaleString()}
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      {activeTab === 'Loans' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-gray-700">Loan History</h3>
            <a
              href="/loans/new"
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              + Record New Loan
            </a>
          </div>
          {loansLoading ? (
            <div className="text-sm text-gray-400 py-4">Loading…</div>
          ) : !staffLoans?.data.length ? (
            <div className="text-sm text-gray-400 py-8 text-center">No loans on record.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Principal', 'Total Repayable', 'Tenure', 'Disbursed', 'Status', ''].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {staffLoans.data.map((loan: ILoan) => (
                    <tr key={loan._id}>
                      <td className="px-3 py-2 font-medium">{loan.principalAmount.toLocaleString()}</td>
                      <td className="px-3 py-2">{loan.totalRepayable.toLocaleString()}</td>
                      <td className="px-3 py-2">{loan.tenureMonths}mo</td>
                      <td className="px-3 py-2">{new Date(loan.disbursedDate).toLocaleDateString('en-GB')}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          loan.status === LoanStatus.Active    ? 'bg-green-100 text-green-800' :
                          loan.status === LoanStatus.Completed ? 'bg-blue-100 text-blue-700'  :
                          loan.status === LoanStatus.BadDebt   ? 'bg-red-100 text-red-700'    :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {loan.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <a href={`/loans/${loan._id}`} className="text-blue-600 text-xs hover:underline">View</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {activeTab === 'Guaranteeing' && (
        <div className="space-y-6">
          <h3 className="text-sm font-medium text-gray-700">Co-Signed Loans</h3>
          {guaranteeLoading ? (
            <div className="text-sm text-gray-400 py-4">Loading…</div>
          ) : !guaranteeLoans?.data.length ? (
            <div className="text-sm text-gray-400 py-8 text-center">
              Not currently guaranteeing any loans.
            </div>
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
                  <div className={`rounded-lg p-3 flex flex-wrap gap-6 text-sm ${atCap ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <div>
                      <p className="text-xs text-gray-500">Active Guarantees</p>
                      <p className="font-semibold text-gray-900">{active.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Total Exposure</p>
                      <p className="font-semibold text-gray-900">{totalExposure.toLocaleString()}</p>
                    </div>
                    {atCap && (
                      <div className="flex items-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          At cap ({active.length}/{maxPerGuarantor})
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Borrower ID', 'Principal', 'Outstanding', 'Disbursed', 'Status', ''].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {guaranteeLoans.data.map((loan: ILoan, i: number) => {
                      const schedule = guaranteeScheduleQueries[i]?.data;
                      const outstanding = schedule
                        ? Math.round(
                            schedule.reduce(
                              (s, r) => s + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount),
                              0,
                            ) * 100,
                          ) / 100
                        : null;
                      return (
                        <tr key={loan._id}>
                          <td className="px-3 py-2 text-xs font-mono text-gray-500">{loan.staffId.slice(-8)}</td>
                          <td className="px-3 py-2 font-medium">{loan.principalAmount.toLocaleString()}</td>
                          <td className="px-3 py-2">
                            {outstanding === null ? (
                              <span className="text-gray-300 text-xs">…</span>
                            ) : (
                              outstanding.toLocaleString()
                            )}
                          </td>
                          <td className="px-3 py-2">{new Date(loan.disbursedDate).toLocaleDateString('en-GB')}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              loan.status === LoanStatus.Active    ? 'bg-green-100 text-green-800' :
                              loan.status === LoanStatus.Completed ? 'bg-blue-100 text-blue-700'  :
                              loan.status === LoanStatus.BadDebt   ? 'bg-red-100 text-red-700'    :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {loan.status}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <a href={`/loans/${loan._id}`} className="text-blue-600 text-xs hover:underline">View</a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {offsetHistory.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Offset History</h4>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Date', 'Loan Principal', 'Instalment #', 'Amount Applied'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {offsetHistory.map((r) => (
                          <tr key={r._id} className="bg-amber-50">
                            <td className="px-3 py-2">
                              {r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-GB') : '—'}
                            </td>
                            <td className="px-3 py-2">{r.loanPrincipal.toLocaleString()}</td>
                            <td className="px-3 py-2">{r.instalmentNumber}</td>
                            <td className="px-3 py-2 font-medium text-amber-700">{r.paidAmount.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Status Change Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Change Staff Status</h2>
              <button
                onClick={() => setShowStatusModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={statusForm.handleSubmit((v) => statusMutation.mutate(v))}
              className="px-6 py-4 space-y-4"
            >
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">New Status *</label>
                <select
                  {...statusForm.register('status')}
                  className={inputClass}
                >
                  <option value="">Select new status...</option>
                  {TERMINAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {statusForm.formState.errors.status && (
                  <p className="text-xs text-red-600">
                    {statusForm.formState.errors.status.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Effective Date *</label>
                <input
                  {...statusForm.register('effectiveDate')}
                  type="date"
                  className={inputClass}
                />
                {statusForm.formState.errors.effectiveDate && (
                  <p className="text-xs text-red-600">
                    {statusForm.formState.errors.effectiveDate.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  {...statusForm.register('notes')}
                  rows={3}
                  className={inputClass}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={statusMutation.isPending}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-60"
                >
                  {statusMutation.isPending ? 'Updating...' : 'Confirm Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
