'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Upload, Pencil, Trash2 } from 'lucide-react';
import type { IInvestmentRow } from '@welfare/shared';
import {
  listInvestments,
  createInvestment,
  updateInvestment,
  deleteInvestment,
} from '@/lib/investments';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { fmtGHS, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const investmentSchema = z.object({
  purchaseDate: z.string().min(1, 'Required'),
  description: z.string().min(1, 'Required'),
  cost: z.coerce.number().min(0.01, 'Must be > 0'),
  maturityDate: z.string().min(1, 'Required'),
  faceValue: z.coerce.number().min(0.01, 'Must be > 0'),
  instruction: z.enum(['One-Time', 'Roll-Over']),
});
type InvestmentForm = z.infer<typeof investmentSchema>;

const reasonSchema = z.object({ reason: z.string().min(1, 'Reason is required') });
type ReasonForm = z.infer<typeof reasonSchema>;

const INSTRUCTION_OPTIONS = [
  { value: 'One-Time', label: 'One-Time' },
  { value: 'Roll-Over', label: 'Roll-Over' },
];

function InvestmentStatusBadge({ status }: { status: 'Active' | 'Matured' }) {
  return (
    <span
      className={cn(
        'inline-flex px-2 py-0.5 rounded text-xs font-medium',
        status === 'Active' ? 'bg-info-50 text-info-700' : 'bg-neutral-100 text-neutral-500',
      )}
    >
      {status}
    </span>
  );
}

export function InvestmentsListClient() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<IInvestmentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IInvestmentRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['investments', page],
    queryFn: () => listInvestments(page, 20),
  });

  const createForm = useForm<InvestmentForm>({ resolver: zodResolver(investmentSchema) });
  const editForm = useForm<InvestmentForm & { reason: string }>({
    resolver: zodResolver(investmentSchema.extend({ reason: z.string().min(1, 'Required') })),
  });
  const deleteForm = useForm<ReasonForm>({ resolver: zodResolver(reasonSchema) });

  const createMut = useMutation({
    mutationFn: (v: InvestmentForm) => createInvestment(v),
    onSuccess: () => {
      toast.success('Investment recorded');
      qc.invalidateQueries({ queryKey: ['investments'] });
      setShowCreate(false);
      createForm.reset();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const editMut = useMutation({
    mutationFn: (v: InvestmentForm & { reason: string }) => updateInvestment(editTarget!.id, v),
    onSuccess: () => {
      toast.success('Investment updated');
      qc.invalidateQueries({ queryKey: ['investments'] });
      setEditTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (v: ReasonForm) => deleteInvestment(deleteTarget!.id, v.reason),
    onSuccess: () => {
      toast.success('Investment deleted');
      qc.invalidateQueries({ queryKey: ['investments'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const openEdit = (inv: IInvestmentRow) => {
    editForm.reset({
      purchaseDate: inv.purchaseDate.split('T')[0],
      description: inv.description,
      cost: inv.cost,
      maturityDate: inv.maturityDate.split('T')[0],
      faceValue: inv.faceValue,
      instruction: inv.instruction,
      reason: '',
    });
    setEditTarget(inv);
  };

  const COLS = [
    'Purchase Date',
    'Description',
    'Cost',
    'Face Value',
    'Interest',
    'Rate (%)',
    'Maturity Date',
    'Status',
    'Instruction',
    '',
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Investments</h1>
        <div className="flex gap-2">
          <Link
            href="/investments/import"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-white border border-neutral-200 text-neutral-700 text-sm font-semibold rounded-sm hover:bg-neutral-50 transition-colors duration-fast"
          >
            <Upload size={16} strokeWidth={1.75} />
            Bulk Import
          </Link>
          <Button onClick={() => setShowCreate(true)} Icon={Plus}>
            Add Investment
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader title="Investment Records" />
        <CardBody>
          {isLoading ? (
            <p className="text-sm text-neutral-400 py-8 text-center">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {COLS.map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(data?.data ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={COLS.length} className="px-4 py-8 text-center text-neutral-400">
                        No investments recorded yet
                      </td>
                    </tr>
                  ) : (
                    (data?.data ?? []).map((inv) => (
                      <tr key={inv.id} className="hover:bg-neutral-50">
                        <td className="px-3 py-2.5">{fmtDate(inv.purchaseDate)}</td>
                        <td className="px-3 py-2.5 max-w-[200px] truncate" title={inv.description}>
                          {inv.description}
                        </td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.cost)}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.faceValue)}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.interest)}</td>
                        <td className="px-3 py-2.5">{inv.rate.toFixed(2)}%</td>
                        <td className="px-3 py-2.5">{fmtDate(inv.maturityDate)}</td>
                        <td className="px-3 py-2.5">
                          <InvestmentStatusBadge status={inv.status} />
                        </td>
                        <td className="px-3 py-2.5">{inv.instruction}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEdit(inv)}
                              className="p-1 text-neutral-400 hover:text-primary-600 rounded"
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => {
                                setDeleteTarget(inv);
                                deleteForm.reset();
                              }}
                              className="p-1 text-neutral-400 hover:text-danger-600 rounded"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {data && data.totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </Button>
              <span className="text-sm text-neutral-500">
                Page {page} of {data.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= data.totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Investment">
        <form onSubmit={createForm.handleSubmit((v) => createMut.mutate(v))} className="space-y-4">
          <Field label="Purchase Date" error={createForm.formState.errors.purchaseDate?.message}>
            <Input type="date" {...createForm.register('purchaseDate')} />
          </Field>
          <Field label="Description" error={createForm.formState.errors.description?.message}>
            <Input {...createForm.register('description')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost (GHS)" error={createForm.formState.errors.cost?.message}>
              <Input type="number" step="0.01" {...createForm.register('cost')} />
            </Field>
            <Field label="Face Value (GHS)" error={createForm.formState.errors.faceValue?.message}>
              <Input type="number" step="0.01" {...createForm.register('faceValue')} />
            </Field>
          </div>
          <Field label="Maturity Date" error={createForm.formState.errors.maturityDate?.message}>
            <Input type="date" {...createForm.register('maturityDate')} />
          </Field>
          <Field label="Instruction">
            <Select options={INSTRUCTION_OPTIONS} {...createForm.register('instruction')} />
          </Field>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      {editTarget && (
        <Modal open onClose={() => setEditTarget(null)} title="Edit Investment">
          <form onSubmit={editForm.handleSubmit((v) => editMut.mutate(v))} className="space-y-4">
            <Field label="Purchase Date">
              <Input type="date" {...editForm.register('purchaseDate')} />
            </Field>
            <Field label="Description">
              <Input {...editForm.register('description')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost (GHS)">
                <Input type="number" step="0.01" {...editForm.register('cost')} />
              </Field>
              <Field label="Face Value (GHS)">
                <Input type="number" step="0.01" {...editForm.register('faceValue')} />
              </Field>
            </div>
            <Field label="Maturity Date">
              <Input type="date" {...editForm.register('maturityDate')} />
            </Field>
            <Field label="Instruction">
              <Select options={INSTRUCTION_OPTIONS} {...editForm.register('instruction')} />
            </Field>
            <Field
              label="Reason for edit (required)"
              error={editForm.formState.errors.reason?.message}
            >
              <Input {...editForm.register('reason')} placeholder="Describe the change" />
            </Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={editMut.isPending}>
                {editMut.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
              <Button variant="secondary" type="button" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <Modal open onClose={() => setDeleteTarget(null)} title="Delete Investment">
          <form onSubmit={deleteForm.handleSubmit((v) => deleteMut.mutate(v))} className="space-y-4">
            <p className="text-sm text-neutral-600">
              Delete <strong>{deleteTarget.description}</strong>? This action is irreversible in the
              UI; the record is archived for audit.
            </p>
            <Field
              label="Reason for deletion (required)"
              error={deleteForm.formState.errors.reason?.message}
            >
              <Input {...deleteForm.register('reason')} placeholder="State reason" />
            </Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="danger" disabled={deleteMut.isPending}>
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </Button>
              <Button variant="secondary" type="button" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
