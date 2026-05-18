'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { StaffStatus } from '@welfare/shared';
import type { IStaff } from '@welfare/shared';
import { getStaff, updateStaff, changeStaffStatus, uploadStaffPhoto } from '@/lib/staff';

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

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff', id],
    queryFn: () => getStaff(id),
  });

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
    onSuccess: ({ requiresSettlement }) => {
      qc.invalidateQueries({ queryKey: ['staff', id] });
      setShowStatusModal(false);
      if (requiresSettlement) {
        toast.warning('Status updated. Outstanding loans require exit settlement (Phase 5).');
      } else {
        toast.success('Status updated');
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Status change failed');
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
              <button
                onClick={() => startEdit(staff)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Edit Profile
              </button>
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
        <div className="text-sm text-gray-400 py-8 text-center">
          Contributions ledger — available in Phase 4.
        </div>
      )}
      {activeTab === 'Loans' && (
        <div className="text-sm text-gray-400 py-8 text-center">
          Loan history — available in Phase 5.
        </div>
      )}
      {activeTab === 'Guaranteeing' && (
        <div className="text-sm text-gray-400 py-8 text-center">
          Co-signed loans — available in Phase 5.
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
