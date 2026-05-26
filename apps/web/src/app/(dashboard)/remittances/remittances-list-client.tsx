'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import { fmtGHS, fmtDate } from '@/lib/format';
import { listRemittances } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function RemittancesListClient() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['remittances', page],
    queryFn: () => listRemittances(page, 20),
  });

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
            <Plus size={16} strokeWidth={1.75} />
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
                    {['Period', 'Receipt Date', 'Gross Amount', 'Charges', 'Net Payable'].map((h) => (
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
                      <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
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
    </div>
  );
}
