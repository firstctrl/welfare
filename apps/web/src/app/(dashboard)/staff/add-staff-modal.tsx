'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { createStaff } from '@/lib/staff';
import { staffSchema, type StaffFormValues } from '@/lib/form-schemas';
import { Modal } from '@/components/ui/modal';
import { Field, Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddStaffModal({ onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffFormValues>({ resolver: zodResolver(staffSchema) });

  async function onSubmit(values: StaffFormValues) {
    try {
      await createStaff({ ...values });
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
    <Modal
      open
      onClose={onClose}
      title="Add Staff Member"
      size="lg"
      icon={<UserPlus size={20} strokeWidth={1.75} />}
      iconKind="info"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={isSubmitting}
            onClick={handleSubmit(onSubmit)}
          >
            Add Staff
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 mt-2">
        <Field label="Full Name" required error={errors.fullName?.message}>
          <Input {...register('fullName')} error={!!errors.fullName} />
        </Field>
        <Field label="Staff ID" required error={errors.staffId?.message}>
          <Input {...register('staffId')} error={!!errors.staffId} />
        </Field>
        <Field label="Email" required error={errors.email?.message}>
          <Input {...register('email')} type="email" error={!!errors.email} />
        </Field>
        <Field label="Level" error={errors.level?.message}>
          <Input {...register('level')} placeholder="e.g. GL 10" error={!!errors.level} />
        </Field>
        <Field label="Point" error={errors.point?.message}>
          <Input {...register('point')} type="number" min="0" defaultValue="0" error={!!errors.point} />
        </Field>
        <Field label="PF Number" error={errors.pfNo?.message}>
          <Input {...register('pfNo')} error={!!errors.pfNo} />
        </Field>
        <Field label="Phone Number" required error={errors.phoneNumber?.message}>
          <Input {...register('phoneNumber')} error={!!errors.phoneNumber} />
        </Field>
        <Field label="Date of Birth" required error={errors.dateOfBirth?.message}>
          <Input {...register('dateOfBirth')} type="date" error={!!errors.dateOfBirth} />
        </Field>
        <Field label="Date of Employment" required error={errors.dateOfEmployment?.message}>
          <Input {...register('dateOfEmployment')} type="date" error={!!errors.dateOfEmployment} />
        </Field>
        <Field label="Date of First Contribution" error={errors.dateOfFirstContribution?.message}>
          <Input {...register('dateOfFirstContribution')} type="date" error={!!errors.dateOfFirstContribution} />
        </Field>
      </form>
    </Modal>
  );
}
