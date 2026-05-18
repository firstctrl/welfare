'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createStaff } from '@/lib/staff';

const schema = z.object({
  fullName:                z.string().min(1, 'Required'),
  staffId:                 z.string().min(1, 'Required'),
  pfNo:                    z.string().min(1, 'Required'),
  dateOfBirth:             z.string().min(1, 'Required'),
  phoneNumber:             z.string().min(1, 'Required'),
  email:                   z.string().email('Invalid email').optional().or(z.literal('')),
  dateOfEmployment:        z.string().min(1, 'Required'),
  dateOfFirstContribution: z.string().min(1, 'Required'),
  level:                   z.string().min(1, 'Required'),
  point:                   z.coerce.number().min(0).default(0),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function AddStaffModal({ onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      await createStaff({ ...values, email: values.email || undefined });
      await qc.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff member added');
      onSuccess();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to add staff');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add Staff Member</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Full Name *" error={errors.fullName?.message}>
              <input {...register('fullName')} className={inputClass} />
            </Field>
            <Field label="Staff ID *" error={errors.staffId?.message}>
              <input {...register('staffId')} className={inputClass} />
            </Field>
            <Field label="PF Number *" error={errors.pfNo?.message}>
              <input {...register('pfNo')} className={inputClass} />
            </Field>
            <Field label="Phone Number *" error={errors.phoneNumber?.message}>
              <input {...register('phoneNumber')} className={inputClass} />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <input {...register('email')} type="email" className={inputClass} />
            </Field>
            <Field label="Level *" error={errors.level?.message}>
              <input {...register('level')} placeholder="e.g. GL 10" className={inputClass} />
            </Field>
            <Field label="Date of Birth *" error={errors.dateOfBirth?.message}>
              <input {...register('dateOfBirth')} type="date" className={inputClass} />
            </Field>
            <Field label="Date of Employment *" error={errors.dateOfEmployment?.message}>
              <input {...register('dateOfEmployment')} type="date" className={inputClass} />
            </Field>
            <Field
              label="Date of First Contribution *"
              error={errors.dateOfFirstContribution?.message}
            >
              <input
                {...register('dateOfFirstContribution')}
                type="date"
                className={inputClass}
              />
            </Field>
            <Field label="Points" error={errors.point?.message}>
              <input
                {...register('point')}
                type="number"
                min="0"
                defaultValue={0}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60"
            >
              {isSubmitting ? 'Saving...' : 'Add Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
