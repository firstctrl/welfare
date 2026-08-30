'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ClaimStatus, AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { getClaim, approveClaim, rejectClaim } from '@/lib/claims';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
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
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: claim, isLoading } = useQuery({ queryKey: ['claims', id], queryFn: () => getClaim(id) });

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

  if (isLoading) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (!claim) return <p className="text-sm text-danger-600">Claim not found.</p>;

  const staffInfo = claim.staffInfo;

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
          {permission === 'full' && claim.status === ClaimStatus.Pending && (
            <div className="flex gap-2">
              <Button variant="secondary" Icon={CheckCircle2} loading={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
                Approve
              </Button>
              <Button variant="danger" Icon={XCircle} onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

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
