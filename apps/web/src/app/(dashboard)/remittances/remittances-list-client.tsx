'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Upload, Pencil, Trash2 } from 'lucide-react';
import {
  listRemittances,
  updateRemittance,
  deleteRemittance,
  type RemittanceRecord,
} from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { fmtGHS, fmtDate } from '@/lib/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_OPTIONS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
].map((m, i) => ({ value: String(i + 1), label: m }));

const editSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000),
  receiptDate: z.string().min(1, 'Required'),
  reason: z.string().min(1, 'Reason is required'),
});
type EditForm = z.infer<typeof editSchema>;

const reasonSchema = z.object({ reason: z.string().min(1, 'Reason is required') });
type ReasonForm = z.infer<typeof reasonSchema>;

const COLS = ['Period', 'Receipt Date', 'Gross Amount', 'Charges', 'Net Payable', ''];

export function RemittancesListClient() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<RemittanceRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RemittanceRecord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['remittances', page],
    queryFn: () => listRemittances(page, 20),
  });

  const editForm = useForm<EditForm>({ resolver: zodResolver(editSchema) });
  const deleteForm = useForm<ReasonForm>({ resolver: zodResolver(reasonSchema) });

  const editMut = useMutation({
    mutationFn: (v: EditForm) => updateRemittance(editTarget!._id, v),
    onSuccess: () => {
      toast.success('Remittance updated');
      qc.invalidateQueries({ queryKey: ['remittances'] });
      setEditTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (v: ReasonForm) => deleteRemittance(deleteTarget!._id, v.reason),
    onSuccess: () => {
      toast.success('Remittance deleted');
      qc.invalidateQueries({ queryKey: ['remittances'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const openEdit = (r: RemittanceRecord) => {
    editForm.reset({
      month: r.month,
      year: r.year,
      receiptDate: r.receiptDate.split('T')[0],
      reason: '',
    });
    setEditTarget(r);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Remittances</h1>
        <div className="flex gap-2">
          <Link
            href="/remittances/import"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-white border border-neutral-200 text-neutral-700 text-sm font-semibold rounded-sm hover:bg-neutral-50 transition-colors duration-fast"
          >
            <Upload size={16} strokeWidth={1.75} />
            Bulk Import
          </Link>
          <Link
            href="/remittances/manual"
            className="inline-flex items-center gap-1.5 h-[var(--row-default)] px-4 bg-primary-600 text-white text-sm font-semibold rounded-sm hover:bg-primary-700 transition-colors duration-fast"
          >
            Add Remittance
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader title="Remittance Records" />
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
                        className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap"
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
                        No remittances recorded yet
                      </td>
                    </tr>
                  ) : (
                    (data?.data ?? []).map((r) => (
                      <tr key={r._id} className="hover:bg-neutral-50">
                        <td className="px-4 py-2.5 font-medium">
                          {MONTHS[r.month - 1]} {r.year}
                        </td>
                        <td className="px-4 py-2.5 text-neutral-600">{fmtDate(r.receiptDate)}</td>
                        <td className="px-4 py-2.5 text-neutral-700">{fmtGHS(r.grossAmount)}</td>
                        <td className="px-4 py-2.5 text-neutral-600">{fmtGHS(r.charges)}</td>
                        <td className="px-4 py-2.5 font-semibold text-neutral-900">{fmtGHS(r.netPayable)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEdit(r)}
                              className="p-1 text-neutral-400 hover:text-primary-600 rounded"
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => { setDeleteTarget(r); deleteForm.reset(); }}
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

      {/* Edit modal */}
      {editTarget && (
        <Modal open onClose={() => setEditTarget(null)} title="Edit Remittance">
          <form onSubmit={editForm.handleSubmit((v) => editMut.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Month" error={editForm.formState.errors.month?.message}>
                <Select options={MONTH_OPTIONS} {...editForm.register('month')} />
              </Field>
              <Field label="Year" error={editForm.formState.errors.year?.message}>
                <Input type="number" min={2000} {...editForm.register('year')} />
              </Field>
            </div>
            <Field label="Receipt Date" error={editForm.formState.errors.receiptDate?.message}>
              <Input type="date" {...editForm.register('receiptDate')} />
            </Field>
            <p className="text-xs text-neutral-500">
              Changing the period will recompute gross amount, charges, and net payable from contributions.
            </p>
            <Field label="Reason for edit (required)" error={editForm.formState.errors.reason?.message}>
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
        <Modal open onClose={() => setDeleteTarget(null)} title="Delete Remittance">
          <form onSubmit={deleteForm.handleSubmit((v) => deleteMut.mutate(v))} className="space-y-4">
            <p className="text-sm text-neutral-600">
              Delete remittance for{' '}
              <strong>
                {MONTHS[deleteTarget.month - 1]} {deleteTarget.year}
              </strong>
              ? The record is archived for audit.
            </p>
            <Field label="Reason for deletion (required)" error={deleteForm.formState.errors.reason?.message}>
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
