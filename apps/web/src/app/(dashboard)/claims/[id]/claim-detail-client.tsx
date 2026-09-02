'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { ClaimStatus, ClaimType, CessationReason, AppModule, UserRole } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { useAuthStore } from '@/store/auth.store';
import { getClaim, approveClaim, rejectClaim, updateClaim } from '@/lib/claims';
import { claimSchema, type ClaimFormValues } from '@/lib/form-schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { fmtGHS, fmtDate } from '@/lib/format';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const statusKind: Record<ClaimStatus, 'success' | 'warning' | 'danger'> = {
  [ClaimStatus.Approved]: 'success',
  [ClaimStatus.Pending]:  'warning',
  [ClaimStatus.Rejected]: 'danger',
};

export function ClaimDetailClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const permission = usePermission(AppModule.Claims);
  const userRole = useAuthStore((s) => s.user?.role);
  const canEditApproved = userRole === UserRole.WelfareManager || userRole === UserRole.Admin;
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [editReason, setEditReason] = useState('');

  const { data: claim, isLoading } = useQuery({ queryKey: ['claims', id], queryFn: () => getClaim(id) });

  const editForm = useForm<ClaimFormValues>({ resolver: zodResolver(claimSchema) });
  const watchClaimType = editForm.watch('claimType');
  const isApprovedEdit = claim?.status === ClaimStatus.Approved;

  const approveMutation = useMutation({
    mutationFn: () => approveClaim(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['claims', id] }); toast.success('Claim approved'); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Approval failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectClaim(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claims', id] });
      setRejecting(false);
      setRejectReason('');
      toast.success('Claim rejected');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Rejection failed'),
  });

  const updateMutation = useMutation({
    mutationFn: (values: ClaimFormValues) => updateClaim(id, {
      claimType: values.claimType as ClaimType,
      subReason: values.claimType === ClaimType.Cessation ? (values.subReason as CessationReason) : undefined,
      month: values.month,
      year: values.year,
      amount: values.amount,
      reason: isApprovedEdit ? editReason.trim() : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claims', id] });
      setEditing(false);
      setEditReason('');
      toast.success('Claim updated');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Update failed'),
  });

  if (isLoading) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (!claim) return <p className="text-sm text-danger-600">Claim not found.</p>;

  const staffInfo = claim.staffInfo;

  function startEdit() {
    editForm.reset({
      staffId: claim!.staffId,
      claimType: claim!.claimType,
      subReason: claim!.subReason ?? undefined,
      month: claim!.month,
      year: claim!.year,
      amount: claim!.amount,
    });
    setEditReason('');
    setEditing(true);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardBody className="flex items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900">{claim.claimType} Claim</h1>
              <Badge kind={statusKind[claim.status]}>{claim.status}</Badge>
            </div>
            <p className="text-sm text-neutral-500 mt-1">
              {staffInfo ? (
                <Link href={`/staff/${claim.staffId}`} className="hover:underline">
                  {staffInfo.fullName} <span className="font-mono text-xs">({staffInfo.staffId})</span>
                </Link>
              ) : (
                <span className="font-mono text-xs">{claim.staffId}</span>
              )}
            </p>
          </div>
          {permission === 'full' && !editing && (
            <div className="flex gap-2">
              {(claim.status === ClaimStatus.Pending || (claim.status === ClaimStatus.Approved && canEditApproved)) && (
                <Button variant="secondary" Icon={Pencil} onClick={startEdit}>
                  Edit
                </Button>
              )}
              {claim.status === ClaimStatus.Pending && (
                <>
                  <Button variant="secondary" Icon={CheckCircle2} loading={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
                    Approve
                  </Button>
                  <Button variant="danger" Icon={XCircle} onClick={() => setRejecting(true)}>
                    Reject
                  </Button>
                </>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {editing ? (
        <Card>
          <CardHeader title="Edit Claim" />
          <CardBody>
            <form onSubmit={editForm.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
              <Field label="Claim Type" required error={editForm.formState.errors.claimType?.message}>
                <Select
                  {...editForm.register('claimType')}
                  options={Object.values(ClaimType).map((t) => ({ value: t, label: t }))}
                />
              </Field>

              {watchClaimType === ClaimType.Cessation && (
                <Field label="Sub Reason" required error={editForm.formState.errors.subReason?.message}>
                  <Select
                    {...editForm.register('subReason')}
                    options={[{ value: '', label: 'Select reason…' }, ...Object.values(CessationReason).map((r) => ({ value: r, label: r }))]}
                  />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Month" required>
                  <Select {...editForm.register('month')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
                </Field>
                <Field label="Year" required>
                  <Input {...editForm.register('year')} type="number" />
                </Field>
              </div>

              <Field label="Amount" required error={editForm.formState.errors.amount?.message}>
                <Input {...editForm.register('amount')} type="number" min="1" prefix="₵" error={!!editForm.formState.errors.amount} />
              </Field>

              {isApprovedEdit && (
                <Field label="Reason for editing this approved claim" required>
                  <Input
                    placeholder="Required — explain why this approved claim is being changed"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                  />
                </Field>
              )}

              <div className="flex gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  loading={updateMutation.isPending}
                  disabled={isApprovedEdit && !editReason.trim()}
                >
                  Save Changes
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : (
      <Card>
        <CardHeader title="Claim Details" />
        <CardBody>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            {(
              [
                ['Amount', fmtGHS(claim.amount)],
                ['Period', `${MONTHS[claim.month - 1]} ${claim.year}`],
                ['Sub Reason', claim.subReason ?? '—'],
                ['Source', claim.source],
                ['Recorded By', claim.recordedBy],
                ['Recorded On', fmtDate(claim.createdAt)],
                ['Approved By', claim.approvedBy ?? '—'],
                ['Approved On', claim.approvedAt ? fmtDate(claim.approvedAt) : '—'],
                ...(claim.status === ClaimStatus.Rejected ? [['Rejection Reason', claim.rejectedReason ?? '—']] : []),
              ] as [string, string][]
            ).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">{label}</p>
                <p className="text-base font-medium text-neutral-900 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      )}

      {rejecting && (
        <Modal open onClose={() => { setRejecting(false); setRejectReason(''); }} title="Reject Claim" size="sm" iconKind="danger">
          <div className="mt-3 space-y-3">
            <p className="text-sm text-neutral-600">
              Reject the {claim.claimType} claim for {staffInfo?.fullName ?? claim.staffId}?
            </p>
            <Input placeholder="Reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => { setRejecting(false); setRejectReason(''); }}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!rejectReason.trim()}
              loading={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate(rejectReason.trim())}
            >
              Reject
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
