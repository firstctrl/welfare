'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClaimType, CessationReason } from '@welfare/shared';
import type { IStaff } from '@welfare/shared';
import { createClaim, getStaffClaimBalance } from '@/lib/claims';
import { searchStaff } from '@/lib/staff';
import { claimSchema, type ClaimFormValues } from '@/lib/form-schemas';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function CreateClaimClient() {
  const router = useRouter();
  const now = new Date();
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<IStaff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<IStaff | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear() },
  });

  const watchClaimType = watch('claimType');
  const watchAmount = watch('amount');
  const watchStaffId = watch('staffId');

  const { data: balanceData } = useQuery({
    queryKey: ['claim-balance', watchStaffId],
    queryFn: () => getStaffClaimBalance(watchStaffId),
    enabled: !!watchStaffId && watchStaffId.length === 24,
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
    mutationFn: (values: ClaimFormValues) => createClaim({
      staffId: values.staffId,
      claimType: values.claimType as ClaimType,
      subReason: values.subReason as CessationReason | undefined,
      month: values.month,
      year: values.year,
      amount: values.amount,
    }),
    onSuccess: () => {
      toast.success('Claim submitted for approval');
      router.push('/claims');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Submission failed'),
  });

  const balance = balanceData?.balance ?? null;
  const exceedsBalance = balance !== null && watchAmount > balance;

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardHeader title="Record Welfare Claim" />
        <CardBody>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="relative space-y-1.5">
              <label className="text-base font-medium text-neutral-700">Staff Member <span className="text-danger-500">*</span></label>
              <div className="relative">
                <Input placeholder="Search by name or staff ID…" value={staffSearch} onChange={(e) => handleStaffSearch(e.target.value)} />
                {staffOptions.length > 0 && (
                  <ul className="absolute z-10 w-full border border-neutral-200 bg-white rounded-sm shadow-floating max-h-48 overflow-y-auto mt-1">
                    {staffOptions.map((s) => (
                      <li key={s._id}>
                        <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 transition-colors" onClick={() => selectStaff(s)}>
                          <span className="font-medium text-neutral-900">{s.fullName}</span>
                          <span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <input type="hidden" {...register('staffId')} />
              {errors.staffId && <p className="text-sm text-danger-700">{errors.staffId.message}</p>}
              {selectedStaff && balance !== null && (
                <p className="text-xs text-neutral-500">
                  Selected: {selectedStaff.fullName} ({selectedStaff.staffId}) — Available balance: <strong className="font-mono">{fmtGHS(balance)}</strong>
                </p>
              )}
            </div>

            <Field label="Claim Type" required error={errors.claimType?.message}>
              <Select
                {...register('claimType')}
                options={[{ value: '', label: 'Select type…' }, ...Object.values(ClaimType).map((t) => ({ value: t, label: t }))]}
              />
            </Field>

            {watchClaimType === ClaimType.Cessation && (
              <Field label="Sub Reason" required error={errors.subReason?.message}>
                <Select
                  {...register('subReason')}
                  options={[{ value: '', label: 'Select reason…' }, ...Object.values(CessationReason).map((r) => ({ value: r, label: r }))]}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Month" required>
                <Select {...register('month')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
              </Field>
              <Field label="Year" required>
                <Input {...register('year')} type="number" />
              </Field>
            </div>

            <Field label="Amount" required error={errors.amount?.message}>
              <Input {...register('amount')} type="number" min="1" prefix="₵" error={!!errors.amount} />
            </Field>

            {exceedsBalance && (
              <div className="bg-danger-50 border border-danger-200 rounded-sm p-3 text-sm text-danger-700">
                This amount exceeds the staff member&apos;s available balance of {fmtGHS(balance!)}. The claim cannot be submitted.
              </div>
            )}

            <Button type="submit" variant="primary" loading={isSubmitting || mutation.isPending} disabled={exceedsBalance}>
              Submit Claim
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
