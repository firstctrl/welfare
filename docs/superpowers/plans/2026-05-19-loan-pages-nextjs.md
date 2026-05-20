# Phase 5.2: Loan Pages (Next.js) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all loan management pages in the Next.js web app — loan list with status/date filters, record-loan form with eligibility check + live schedule preview, loan detail with repayment schedule + payment modal + exit settlement, and fill in the Loans/Guaranteeing tabs on the Staff Detail page.

**Architecture:** Five tasks, each independently shippable and verified by `tsc --noEmit`. Server component wrappers (`page.tsx`) thin-wrap `'use client'` interactive components. React Query handles all data fetching and cache invalidation. Outstanding balance on the list page computed via `useQueries` (one schedule request per visible loan, cached 5 min). Staff names resolved via a single `listStaff({ limit: 1000 })` call cached 10 min — avoids N+1. System config loaded via existing `lib/config.ts` `getConfig()`.

**Tech Stack:** Next.js 14 App Router, `@tanstack/react-query` (including `useQueries`), `@tanstack/react-table`, React Hook Form + Zod, Tailwind CSS, Sonner toasts, `@welfare/shared` types/enums, `lib/api-client.ts` Axios instance, `lib/config.ts`, `lib/staff.ts`.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/lib/loans.ts` | Create | All loan API calls |
| `apps/web/src/app/(dashboard)/loans/page.tsx` | Create | Server wrapper for list |
| `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx` | Create | List table with filters + pagination |
| `apps/web/src/app/(dashboard)/loans/new/page.tsx` | Create | Server wrapper for new loan form |
| `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx` | Create | Record loan form |
| `apps/web/src/app/(dashboard)/loans/[id]/page.tsx` | Create | Server wrapper for detail |
| `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx` | Create | Full loan detail view |
| `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx` | Modify | Fill Loans + Guaranteeing tabs |

---

## API Reference (backend endpoints)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/loans` | List loans — query: `staffId`, `status`, `page`, `limit` |
| GET | `/loans/:id` | Single loan |
| GET | `/loans/:id/schedule` | Repayment schedule array |
| GET | `/loans/:id/document` | Pre-signed doc URL (string) |
| POST | `/loans/:id/document` | Upload doc (multipart `file`) |
| POST | `/loans/:id/repayments` | Record payment — body: `{ amount, paidDate, notes? }` |
| POST | `/loans/:id/settle-exit` | Exit settlement — body: `{ exitDeductionAmount, notes? }` |
| POST | `/loans` | Create loan — body: `{ staffId, guarantorId, principalAmount, tenureMonths, disbursedDate }` |
| GET | `/loans/guarantor/:staffId` | Loans where guarantorId = staffId |
| GET | `/staff/:staffId/loans` | Loans where staffId = staffId |

Config keys used from `GET /config`:
- `LOAN_MIN_AMOUNT`, `LOAN_MAX_AMOUNT`, `INTEREST_RATE_SHORT`, `INTEREST_RATE_LONG`, `MAX_LOANS_PER_GUARANTOR`, `ELIGIBILITY_MONTHS`

---

## Task 1: Loans API client lib

**Files:**
- Create: `apps/web/src/lib/loans.ts`

- [ ] **Step 1: Create the file**

`apps/web/src/lib/loans.ts`:
```typescript
import { apiClient } from './api-client';
import type { ILoan, ILoanRepayment, PaginatedResult, LoanStatus } from '@welfare/shared';

export interface LoanFilters {
  staffId?: string;
  status?: LoanStatus;
  page?: number;
  limit?: number;
}

export interface CreateLoanPayload {
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  tenureMonths: number;
  disbursedDate: string;
}

export interface RecordPaymentPayload {
  amount: number;
  paidDate: string;
  notes?: string;
}

export interface ExitSettlementPayload {
  exitDeductionAmount: number;
  notes?: string;
}

export async function listLoans(filters: LoanFilters = {}): Promise<PaginatedResult<ILoan>> {
  const { data } = await apiClient.get('/loans', { params: filters });
  return data;
}

export async function getLoan(id: string): Promise<ILoan> {
  const { data } = await apiClient.get(`/loans/${id}`);
  return data;
}

export async function getLoanSchedule(id: string): Promise<ILoanRepayment[]> {
  const { data } = await apiClient.get(`/loans/${id}/schedule`);
  return data;
}

export async function getLoanDocumentUrl(id: string): Promise<string> {
  const { data } = await apiClient.get(`/loans/${id}/document`);
  return data;
}

export async function createLoan(payload: CreateLoanPayload): Promise<ILoan> {
  const { data } = await apiClient.post('/loans', payload);
  return data;
}

export async function uploadLoanDocument(loanId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await apiClient.post(`/loans/${loanId}/document`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function recordPayment(id: string, payload: RecordPaymentPayload): Promise<ILoan> {
  const { data } = await apiClient.post(`/loans/${id}/repayments`, payload);
  return data;
}

export async function exitSettle(id: string, payload: ExitSettlementPayload): Promise<ILoan> {
  const { data } = await apiClient.post(`/loans/${id}/settle-exit`, payload);
  return data;
}

export async function getLoansByStaff(
  staffId: string,
  page = 1,
  limit = 50,
): Promise<PaginatedResult<ILoan>> {
  const { data } = await apiClient.get(`/staff/${staffId}/loans`, { params: { page, limit } });
  return data;
}

export async function getLoansByGuarantor(
  staffId: string,
  page = 1,
  limit = 50,
): Promise<PaginatedResult<ILoan>> {
  const { data } = await apiClient.get(`/loans/guarantor/${staffId}`, { params: { page, limit } });
  return data;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/loans.ts
git commit -m "feat(web): loans API client lib"
```

---

## Task 2: Loans list page

**Files:**
- Create: `apps/web/src/app/(dashboard)/loans/page.tsx`
- Create: `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx`

**Design notes:**
- Status filter → passed to API (`GET /loans?status=X`)
- Disbursed month/year → client-side filter on loaded page (API has no date filter)
- Staff names: single `listStaff({ limit: 1000 })` query → Map<_id, fullName>
- Outstanding balance: `useQueries` — one schedule fetch per visible loan (max 20), cached 5 min; computed as `sum(max(0, dueAmount + penaltyAmount - paidAmount))`

- [ ] **Step 1: Create server wrapper**

`apps/web/src/app/(dashboard)/loans/page.tsx`:
```typescript
import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { LoansListClient } from './loans-list-client';

export const metadata: Metadata = { title: 'Loans | Welfare Management System' };

export default function LoansPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Loans</h1>
        <Link
          href="/loans/new"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          + Record New Loan
        </Link>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-400">Loading...</div>}>
        <LoansListClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Create list client component**

`apps/web/src/app/(dashboard)/loans/loans-list-client.tsx`:
```typescript
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueries } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { LoanStatus } from '@welfare/shared';
import type { ILoan } from '@welfare/shared';
import { listLoans, getLoanSchedule } from '@/lib/loans';
import { listStaff } from '@/lib/staff';

const LOAN_STATUS_BADGE: Record<LoanStatus, string> = {
  [LoanStatus.Active]:    'bg-green-100 text-green-800',
  [LoanStatus.Completed]: 'bg-blue-100 text-blue-700',
  [LoanStatus.Defaulted]: 'bg-orange-100 text-orange-700',
  [LoanStatus.WrittenOff]:'bg-gray-100 text-gray-600',
  [LoanStatus.BadDebt]:   'bg-red-100 text-red-700',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const col = createColumnHelper<ILoan>();

export function LoansListClient() {
  const router = useRouter();
  const [page, setPage]               = useState(1);
  const [status, setStatus]           = useState<LoanStatus | ''>('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear]   = useState('');
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['loans', { page, status }],
    queryFn: () => listLoans({ page, limit, status: status || undefined }),
  });

  // Staff name lookup — one request, cached 10 min
  const { data: staffData } = useQuery({
    queryKey: ['staff', 'all'],
    queryFn: () => listStaff({ limit: 1000 }),
    staleTime: 10 * 60 * 1000,
  });
  const staffMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staffData?.data ?? []) m.set(s._id, s.fullName);
    return m;
  }, [staffData]);

  // Outstanding balance — one schedule query per visible loan
  const scheduleQueries = useQueries({
    queries: (data?.data ?? []).map((loan) => ({
      queryKey: ['loans', loan._id, 'schedule'],
      queryFn: () => getLoanSchedule(loan._id),
      enabled: !!data,
      staleTime: 5 * 60 * 1000,
    })),
  });
  const outstandingMap = useMemo(() => {
    const m = new Map<string, number | null>();
    (data?.data ?? []).forEach((loan, i) => {
      const schedule = scheduleQueries[i]?.data;
      if (!schedule) { m.set(loan._id, null); return; }
      const val = schedule.reduce(
        (sum, r) => sum + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount),
        0,
      );
      m.set(loan._id, Math.round(val * 100) / 100);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, JSON.stringify(scheduleQueries.map((q) => q.status))]);

  // Client-side disbursed date filter
  const filtered = useMemo(() => {
    const loans = data?.data ?? [];
    if (!filterMonth && !filterYear) return loans;
    return loans.filter((loan) => {
      const d = new Date(loan.disbursedDate);
      if (filterMonth && d.getMonth() + 1 !== parseInt(filterMonth, 10)) return false;
      if (filterYear && d.getFullYear() !== parseInt(filterYear, 10)) return false;
      return true;
    });
  }, [data, filterMonth, filterYear]);

  const columns = useMemo(() => [
    col.accessor('staffId', {
      header: 'Staff',
      cell: (info) => (
        <div>
          <div className="font-medium text-gray-900 text-sm">
            {staffMap.get(info.getValue()) ?? '—'}
          </div>
          <div className="text-xs text-gray-400 font-mono">{info.getValue().slice(-8)}</div>
        </div>
      ),
    }),
    col.accessor('principalAmount', {
      header: 'Principal',
      cell: (info) => info.getValue().toLocaleString(),
    }),
    col.accessor('totalRepayable', {
      header: 'Total Repayable',
      cell: (info) => info.getValue().toLocaleString(),
    }),
    col.accessor('disbursedDate', {
      header: 'Disbursed',
      cell: (info) => new Date(info.getValue()).toLocaleDateString('en-GB'),
    }),
    col.accessor('tenureMonths', {
      header: 'Tenure',
      cell: (info) => `${info.getValue()}mo`,
    }),
    col.display({
      id: 'outstanding',
      header: 'Outstanding',
      cell: ({ row }) => {
        const val = outstandingMap.get(row.original._id);
        if (val === null || val === undefined)
          return <span className="text-gray-300 text-xs">…</span>;
        return <span className="font-medium">{val.toLocaleString()}</span>;
      },
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (info) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LOAN_STATUS_BADGE[info.getValue()]}`}>
          {info.getValue()}
        </span>
      ),
    }),
  ], [staffMap, outstandingMap]);

  const table = useReactTable({ data: filtered, columns, getCoreRowModel: getCoreRowModel() });

  if (error) return <div className="text-sm text-red-500">Failed to load loans.</div>;

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as LoanStatus | ''); setPage(1); }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          {Object.values(LoanStatus).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Months</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Years</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {(filterMonth || filterYear) && (
          <button
            onClick={() => { setFilterMonth(''); setFilterYear(''); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading loans...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center">No loans found.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/loans/${row.original._id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-gray-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data?.total ?? 0)} of {data?.total ?? 0}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= (data?.totalPages ?? 1)}
              className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/loans/page.tsx apps/web/src/app/(dashboard)/loans/loans-list-client.tsx
git commit -m "feat(web): loan list page with status/date filters and outstanding balance"
```

---

## Task 3: New loan form

**Files:**
- Create: `apps/web/src/app/(dashboard)/loans/new/page.tsx`
- Create: `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx`

**Design notes:**
- Staff picker: type ≥2 chars → `searchStaff()` dropdown; on select → `getLoanEligibility(staff._id)` → inline badge
- Guarantor picker: same search; excludes selected borrower; on select → `getLoansByGuarantor()` → count active guarantees; show warning if at cap
- Interest rate derived client-side: tenure ≤ 6 → `INTEREST_RATE_SHORT`, else `INTEREST_RATE_LONG`
- Live schedule preview: same formula as backend — `dueDate = 5th of (disbursedDate.month + N)`, `totalRepayable = principal * (1 + rate/100)`, `instalment = totalRepayable / tenure`
- Submit: `createLoan()` then `uploadLoanDocument()` if file selected; navigate to `/loans/:id` on success
- Submit disabled if: eligibility check returns `eligible: false`, OR guarantor is at/over cap

- [ ] **Step 1: Create server wrapper**

`apps/web/src/app/(dashboard)/loans/new/page.tsx`:
```typescript
import type { Metadata } from 'next';
import Link from 'next/link';
import { NewLoanClient } from './new-loan-client';

export const metadata: Metadata = { title: 'Record New Loan | Welfare Management System' };

export default function NewLoanPage() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/loans" className="text-sm text-gray-500 hover:text-gray-700">
          ← Loans
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Record New Loan</h1>
      </div>
      <NewLoanClient />
    </div>
  );
}
```

- [ ] **Step 2: Create the form client**

`apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx`:
```typescript
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LoanStatus } from '@welfare/shared';
import type { IStaff } from '@welfare/shared';
import { searchStaff, getLoanEligibility } from '@/lib/staff';
import { createLoan, uploadLoanDocument, getLoansByGuarantor } from '@/lib/loans';
import { getConfig } from '@/lib/config';

const schema = z.object({
  staffId:         z.string().min(1, 'Select a staff member'),
  guarantorId:     z.string().min(1, 'Select a guarantor'),
  principalAmount: z.coerce.number().min(1, 'Required'),
  tenureMonths:    z.coerce.number().min(1).max(12),
  disbursedDate:   z.string().min(1, 'Required'),
});
type FormValues = z.infer<typeof schema>;

const inputClass =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function computeDueDate(disbursedDate: Date, n: number): Date {
  const d = new Date(disbursedDate);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(5);
  return d;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

export function NewLoanClient() {
  const router = useRouter();
  const [staffSearch, setStaffSearch]         = useState('');
  const [staffOptions, setStaffOptions]       = useState<IStaff[]>([]);
  const [selectedStaff, setSelectedStaff]     = useState<IStaff | null>(null);
  const [guarantorSearch, setGuarantorSearch] = useState('');
  const [guarantorOptions, setGuarantorOptions] = useState<IStaff[]>([]);
  const [selectedGuarantor, setSelectedGuarantor] = useState<IStaff | null>(null);
  const [docFile, setDocFile]                 = useState<File | null>(null);

  const {
    register, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { tenureMonths: 6 },
  });

  const watchStaffId     = watch('staffId');
  const watchGuarantorId = watch('guarantorId');
  const watchPrincipal   = watch('principalAmount');
  const watchTenure      = watch('tenureMonths');
  const watchDate        = watch('disbursedDate');

  // System config
  const { data: cfg } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 5 * 60 * 1000,
  });
  const minAmount       = parseFloat(cfg?.['LOAN_MIN_AMOUNT']?.value ?? '500');
  const maxAmount       = parseFloat(cfg?.['LOAN_MAX_AMOUNT']?.value ?? '50000');
  const shortRate       = parseFloat(cfg?.['INTEREST_RATE_SHORT']?.value ?? '5');
  const longRate        = parseFloat(cfg?.['INTEREST_RATE_LONG']?.value ?? '8');
  const maxPerGuarantor = parseInt(cfg?.['MAX_LOANS_PER_GUARANTOR']?.value ?? '0', 10);

  const derivedRate       = (watchTenure ?? 6) <= 6 ? shortRate : longRate;
  const totalRepayable    = watchPrincipal ? round2(watchPrincipal * (1 + derivedRate / 100)) : 0;
  const monthlyInstalment = watchTenure && totalRepayable ? round2(totalRepayable / watchTenure) : 0;

  // Live schedule preview
  const schedulePreview = useMemo(() => {
    if (!watchPrincipal || !watchTenure || !watchDate) return [];
    const d = new Date(watchDate);
    if (isNaN(d.getTime())) return [];
    let balance = totalRepayable;
    return Array.from({ length: watchTenure }, (_, i) => {
      const dueDate = computeDueDate(d, i + 1);
      balance = round2(Math.max(0, balance - monthlyInstalment));
      return { n: i + 1, dueDate, instalment: monthlyInstalment, balanceAfter: balance };
    });
  }, [watchPrincipal, watchTenure, watchDate, totalRepayable, monthlyInstalment]);

  // Staff eligibility
  const { data: eligibility } = useQuery({
    queryKey: ['eligibility', watchStaffId],
    queryFn: () => getLoanEligibility(watchStaffId),
    enabled: !!watchStaffId,
  });

  // Guarantor active guarantee count
  const { data: guarantorLoans } = useQuery({
    queryKey: ['loans', 'guarantor', watchGuarantorId],
    queryFn: () => getLoansByGuarantor(watchGuarantorId),
    enabled: !!watchGuarantorId,
  });
  const activeGuaranteeCount = guarantorLoans?.data.filter(
    (l) => l.status === LoanStatus.Active,
  ).length ?? 0;
  const guarantorAtCap = maxPerGuarantor > 0 && activeGuaranteeCount >= maxPerGuarantor;

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 2) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data.filter((s) => s._id !== watchGuarantorId));
  }

  function selectStaff(staff: IStaff) {
    setSelectedStaff(staff);
    setValue('staffId', staff._id);
    setStaffSearch(staff.fullName);
    setStaffOptions([]);
    if (staff._id === watchGuarantorId) {
      setSelectedGuarantor(null);
      setValue('guarantorId', '');
      setGuarantorSearch('');
    }
  }

  async function handleGuarantorSearch(q: string) {
    setGuarantorSearch(q);
    if (q.length < 2) { setGuarantorOptions([]); return; }
    const res = await searchStaff(q);
    setGuarantorOptions(res.data.filter((s) => s._id !== watchStaffId));
  }

  function selectGuarantor(staff: IStaff) {
    setSelectedGuarantor(staff);
    setValue('guarantorId', staff._id);
    setGuarantorSearch(staff.fullName);
    setGuarantorOptions([]);
  }

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const loan = await createLoan(values);
      if (docFile) await uploadLoanDocument(loan._id, docFile);
      return loan;
    },
    onSuccess: (loan) => {
      toast.success('Loan recorded successfully');
      router.push(`/loans/${loan._id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Failed to record loan');
    },
  });

  const submitDisabled =
    isSubmitting ||
    mutation.isPending ||
    guarantorAtCap ||
    eligibility?.eligible === false;

  return (
    <div className="max-w-4xl space-y-6">
      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="bg-white border border-gray-200 rounded-xl p-6 space-y-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Staff Picker */}
          <div className="space-y-1 relative">
            <label className="text-sm font-medium text-gray-700">Staff Member *</label>
            <input
              type="text"
              value={staffSearch}
              onChange={(e) => handleStaffSearch(e.target.value)}
              placeholder="Search by name or ID…"
              className={inputClass}
            />
            {staffOptions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => selectStaff(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium">{s.fullName}</span>
                    <span className="text-gray-400 ml-2 text-xs">{s.staffId}</span>
                  </button>
                ))}
              </div>
            )}
            <input type="hidden" {...register('staffId')} />
            {errors.staffId && (
              <p className="text-xs text-red-600">{errors.staffId.message}</p>
            )}
            {selectedStaff && eligibility && (
              <div
                className={`mt-1 text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                  eligibility.eligible
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {eligibility.eligible
                  ? '✓ Eligible for a loan'
                  : `✗ Ineligible: ${eligibility.reason}`}
              </div>
            )}
          </div>

          {/* Guarantor Picker */}
          <div className="space-y-1 relative">
            <label className="text-sm font-medium text-gray-700">Guarantor *</label>
            <input
              type="text"
              value={guarantorSearch}
              onChange={(e) => handleGuarantorSearch(e.target.value)}
              placeholder="Search guarantor by name or ID…"
              className={inputClass}
            />
            {guarantorOptions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {guarantorOptions.map((s) => (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => selectGuarantor(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium">{s.fullName}</span>
                    <span className="text-gray-400 ml-2 text-xs">{s.staffId}</span>
                  </button>
                ))}
              </div>
            )}
            <input type="hidden" {...register('guarantorId')} />
            {errors.guarantorId && (
              <p className="text-xs text-red-600">{errors.guarantorId.message}</p>
            )}
            {selectedGuarantor && (
              <div
                className={`mt-1 text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                  guarantorAtCap ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'
                }`}
              >
                {guarantorAtCap
                  ? `✗ At cap (${activeGuaranteeCount}/${maxPerGuarantor} active guarantees)`
                  : `${activeGuaranteeCount} active guarantee${activeGuaranteeCount !== 1 ? 's' : ''}`}
              </div>
            )}
          </div>

          {/* Principal Amount */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Principal Amount *
              {cfg && (
                <span className="text-gray-400 font-normal ml-1 text-xs">
                  (min: {minAmount.toLocaleString()}, max: {maxAmount.toLocaleString()})
                </span>
              )}
            </label>
            <input
              {...register('principalAmount')}
              type="number"
              min={minAmount}
              max={maxAmount}
              step="0.01"
              className={inputClass}
            />
            {errors.principalAmount && (
              <p className="text-xs text-red-600">{errors.principalAmount.message}</p>
            )}
          </div>

          {/* Tenure */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Tenure (months) *</label>
            <select {...register('tenureMonths')} className={inputClass}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m} month{m > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            {cfg && (
              <p className="text-xs text-gray-500">
                Interest rate: <strong>{derivedRate}%</strong>
                {(watchTenure ?? 6) <= 6 ? ' (≤ 6 months)' : ' (> 6 months)'}
              </p>
            )}
          </div>

          {/* Disbursed Date */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Disbursed Date *</label>
            <input {...register('disbursedDate')} type="date" className={inputClass} />
            {errors.disbursedDate && (
              <p className="text-xs text-red-600">{errors.disbursedDate.message}</p>
            )}
          </div>

          {/* Approval Document */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Approval Document</label>
            <input
              type="file"
              accept=".pdf,image/jpeg,image/png"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-600 file:mr-4 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
            {docFile && <p className="text-xs text-gray-500">{docFile.name}</p>}
          </div>
        </div>

        {/* Derived summary */}
        {watchPrincipal > 0 && watchTenure > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Interest Rate</p>
              <p className="font-semibold text-gray-900">{derivedRate}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Repayable</p>
              <p className="font-semibold text-gray-900">{totalRepayable.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Monthly Instalment</p>
              <p className="font-semibold text-gray-900">{monthlyInstalment.toLocaleString()}</p>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitDisabled}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
          >
            {mutation.isPending ? 'Recording…' : 'Record Loan'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/loans')}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>

      {/* Live repayment schedule preview */}
      {schedulePreview.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">
            Repayment Schedule Preview
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['#', 'Due Date', 'Monthly Instalment', 'Balance After'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedulePreview.map((row) => (
                  <tr key={row.n}>
                    <td className="px-3 py-2 text-gray-500">{row.n}</td>
                    <td className="px-3 py-2">{row.dueDate.toLocaleDateString('en-GB')}</td>
                    <td className="px-3 py-2 font-medium">{row.instalment.toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-600">{row.balanceAfter.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/loans/new/
git commit -m "feat(web): record new loan form with eligibility, guarantor cap, live schedule preview"
```

---

## Task 4: Loan detail page

**Files:**
- Create: `apps/web/src/app/(dashboard)/loans/[id]/page.tsx`
- Create: `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

**Design notes:**
- Fetch `getLoan(id)`, `getLoanSchedule(id)`, `getStaff(loan.staffId)`, `getStaff(loan.guarantorId)`, `getLoansByGuarantor(loan.guarantorId)` in parallel using `enabled: !!loan`
- Overdue rows: `status === LoanRepaymentStatus.Overdue` → `bg-red-50`
- Guarantor-offset rows: `source === RepaymentSource.GuarantorOffset` → `bg-amber-50`
- Payment modal: simulate affected instalments client-side using surplus-carry algorithm (sequential from instalment #1, skip Paid/Waived)
- Exit Settlement panel condition: `borrower.status ∈ {Resigned, Dismissed, Deceased}` AND `loan.status === Active`
- Settlement summary visible: `loan.status !== Active` AND any of `exitDeductionAmount`, `guarantorOffsetAmount`, `badDebtAmount` > 0
- Real-time exit preview: `amountCovered = min(deduction, outstanding)`, `remaining = max(0, outstanding - deduction)`. Actual guarantor/bad-debt split is backend-computed and shown in settlement summary post-settlement.
- Download document: call `getLoanDocumentUrl(id)` → `window.open(url, '_blank')`

- [ ] **Step 1: Create server wrapper**

`apps/web/src/app/(dashboard)/loans/[id]/page.tsx`:
```typescript
import type { Metadata } from 'next';
import Link from 'next/link';
import { LoanDetailClient } from './loan-detail-client';

export const metadata: Metadata = { title: 'Loan Detail | Welfare Management System' };

export default function LoanDetailPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <div className="mb-6">
        <Link href="/loans" className="text-sm text-gray-500 hover:text-gray-700">
          ← Loans
        </Link>
      </div>
      <LoanDetailClient id={params.id} />
    </div>
  );
}
```

- [ ] **Step 2: Create detail client**

`apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`:
```typescript
'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  LoanStatus,
  LoanRepaymentStatus,
  RepaymentSource,
  StaffStatus,
} from '@welfare/shared';
import type { ILoanRepayment } from '@welfare/shared';
import {
  getLoan,
  getLoanSchedule,
  getLoanDocumentUrl,
  recordPayment,
  exitSettle,
  getLoansByGuarantor,
} from '@/lib/loans';
import { getStaff } from '@/lib/staff';

const LOAN_STATUS_BADGE: Record<LoanStatus, string> = {
  [LoanStatus.Active]:    'bg-green-100 text-green-800',
  [LoanStatus.Completed]: 'bg-blue-100 text-blue-700',
  [LoanStatus.Defaulted]: 'bg-orange-100 text-orange-700',
  [LoanStatus.WrittenOff]:'bg-gray-100 text-gray-600',
  [LoanStatus.BadDebt]:   'bg-red-100 text-red-800',
};

const REPAYMENT_STATUS_BADGE: Record<LoanRepaymentStatus, string> = {
  [LoanRepaymentStatus.Pending]: 'bg-gray-100 text-gray-600',
  [LoanRepaymentStatus.Paid]:    'bg-green-100 text-green-700',
  [LoanRepaymentStatus.Partial]: 'bg-yellow-100 text-yellow-700',
  [LoanRepaymentStatus.Overdue]: 'bg-red-100 text-red-700',
  [LoanRepaymentStatus.Waived]:  'bg-purple-100 text-purple-700',
};

const EXIT_STATUSES = new Set<StaffStatus>([
  StaffStatus.Resigned,
  StaffStatus.Dismissed,
  StaffStatus.Deceased,
]);

const paymentSchema = z.object({
  amount:   z.coerce.number().min(0.01, 'Required'),
  paidDate: z.string().min(1, 'Required'),
  notes:    z.string().optional(),
});
type PaymentForm = z.infer<typeof paymentSchema>;

const settlementSchema = z.object({
  exitDeductionAmount: z.coerce.number().min(0, 'Required'),
  notes:               z.string().optional(),
});
type SettlementForm = z.infer<typeof settlementSchema>;

const inputClass =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function round2(n: number) { return Math.round(n * 100) / 100; }

function computeAffectedInstalments(schedule: ILoanRepayment[], amount: number) {
  let remaining = amount;
  const affected: Array<{ instalment: ILoanRepayment; applied: number }> = [];
  for (const inst of [...schedule].sort((a, b) => a.instalmentNumber - b.instalmentNumber)) {
    if (
      inst.status === LoanRepaymentStatus.Paid ||
      inst.status === LoanRepaymentStatus.Waived
    ) continue;
    const due = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
    if (due <= 0) continue;
    const applied = round2(Math.min(remaining, due));
    if (applied <= 0) break;
    affected.push({ instalment: inst, applied });
    remaining = round2(remaining - applied);
    if (remaining <= 0) break;
  }
  return affected;
}

export function LoanDetailClient({ id }: { id: string }) {
  const qc = useQueryClient();
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const { data: loan, isLoading: loanLoading } = useQuery({
    queryKey: ['loans', id],
    queryFn: () => getLoan(id),
  });
  const { data: schedule, isLoading: scheduleLoading } = useQuery({
    queryKey: ['loans', id, 'schedule'],
    queryFn: () => getLoanSchedule(id),
    enabled: !!loan,
  });
  const { data: borrower } = useQuery({
    queryKey: ['staff', loan?.staffId],
    queryFn: () => getStaff(loan!.staffId),
    enabled: !!loan,
  });
  const { data: guarantor } = useQuery({
    queryKey: ['staff', loan?.guarantorId],
    queryFn: () => getStaff(loan!.guarantorId),
    enabled: !!loan,
  });
  const { data: guarantorLoans } = useQuery({
    queryKey: ['loans', 'guarantor', loan?.guarantorId],
    queryFn: () => getLoansByGuarantor(loan!.guarantorId),
    enabled: !!loan,
  });
  const activeGuaranteeCount = guarantorLoans?.data.filter(
    (l) => l.status === LoanStatus.Active,
  ).length ?? 0;

  const paymentForm    = useForm<PaymentForm>({ resolver: zodResolver(paymentSchema) });
  const settlementForm = useForm<SettlementForm>({
    resolver: zodResolver(settlementSchema),
    defaultValues: { exitDeductionAmount: 0 },
  });

  const paymentAmount = paymentForm.watch('amount');

  const affectedInstalments = useMemo(() => {
    if (!schedule || !paymentAmount) return [];
    return computeAffectedInstalments(schedule, paymentAmount);
  }, [schedule, paymentAmount]);

  const summary = useMemo(() => {
    if (!schedule) return { totalPaid: 0, outstanding: 0, nextDueDate: null as string | null, nextDueAmount: 0 };
    const totalPaid = round2(schedule.reduce((s, r) => s + r.paidAmount, 0));
    const outstanding = round2(
      schedule.reduce((s, r) => s + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount), 0),
    );
    const next = schedule.find(
      (r) =>
        r.status !== LoanRepaymentStatus.Paid &&
        r.status !== LoanRepaymentStatus.Waived,
    );
    return {
      totalPaid,
      outstanding,
      nextDueDate:   next?.dueDate ?? null,
      nextDueAmount: next ? round2(next.dueAmount + next.penaltyAmount - next.paidAmount) : 0,
    };
  }, [schedule]);

  const deductionAmount = settlementForm.watch('exitDeductionAmount') ?? 0;
  const amountCovered   = round2(Math.min(deductionAmount, summary.outstanding));
  const remainingAfterDeduction = round2(Math.max(0, summary.outstanding - deductionAmount));

  const paymentMutation = useMutation({
    mutationFn: (values: PaymentForm) => recordPayment(id, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans', id] });
      setShowPaymentModal(false);
      paymentForm.reset();
      toast.success('Payment recorded');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Payment failed');
    },
  });

  const settlementMutation = useMutation({
    mutationFn: (values: SettlementForm) => exitSettle(id, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans', id] });
      toast.success('Exit settlement recorded');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Settlement failed');
    },
  });

  async function handleDownloadDoc() {
    try {
      const url = await getLoanDocumentUrl(id);
      window.open(url, '_blank');
    } catch {
      toast.error('Document not found');
    }
  }

  if (loanLoading) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!loan)       return <div className="text-sm text-red-500">Loan not found.</div>;

  const showExitPanel =
    !!borrower &&
    EXIT_STATUSES.has(borrower.status) &&
    loan.status === LoanStatus.Active;

  const showSettlementSummary =
    loan.status !== LoanStatus.Active &&
    ((loan.exitDeductionAmount ?? 0) > 0 ||
      (loan.guarantorOffsetAmount ?? 0) > 0 ||
      (loan.badDebtAmount ?? 0) > 0);

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── Header ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900">
                {borrower?.fullName ?? '—'}
              </h1>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${LOAN_STATUS_BADGE[loan.status]}`}
              >
                {loan.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Principal:{' '}
              <span className="font-medium text-gray-900">
                {loan.principalAmount.toLocaleString()}
              </span>
              &nbsp;·&nbsp;Tenure:{' '}
              <span className="font-medium text-gray-900">{loan.tenureMonths}mo</span>
              &nbsp;·&nbsp;Disbursed:{' '}
              <span className="font-medium text-gray-900">
                {new Date(loan.disbursedDate).toLocaleDateString('en-GB')}
              </span>
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Guarantor:{' '}
              <span className="font-medium text-gray-900">
                {guarantor?.fullName ?? '—'}
              </span>
              &nbsp;
              <span className="text-gray-400">
                ({activeGuaranteeCount} active guarantee
                {activeGuaranteeCount !== 1 ? 's' : ''})
              </span>
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            {loan.documentKey && (
              <button
                onClick={handleDownloadDoc}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Download Document
              </button>
            )}
            {loan.status === LoanStatus.Active && (
              <button
                onClick={() => setShowPaymentModal(true)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Record Payment
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Payment Summary ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Payment Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(
            [
              ['Total Paid',      summary.totalPaid.toLocaleString()],
              ['Outstanding',     summary.outstanding.toLocaleString()],
              [
                'Next Due Date',
                summary.nextDueDate
                  ? new Date(summary.nextDueDate).toLocaleDateString('en-GB')
                  : '—',
              ],
              [
                'Next Due Amount',
                summary.nextDueAmount > 0 ? summary.nextDueAmount.toLocaleString() : '—',
              ],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-base font-semibold text-gray-900 mt-0.5">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Repayment Schedule ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Repayment Schedule</h2>
        {scheduleLoading ? (
          <div className="text-sm text-gray-400">Loading schedule…</div>
        ) : !schedule?.length ? (
          <div className="text-sm text-gray-400">No schedule found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['#', 'Due Date', 'Due', 'Paid', 'Penalty', 'Status', 'Source'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedule.map((row) => {
                  const isOverdue   = row.status === LoanRepaymentStatus.Overdue;
                  const isGuarantor = row.source  === RepaymentSource.GuarantorOffset;
                  return (
                    <tr
                      key={row._id}
                      className={
                        isOverdue
                          ? 'bg-red-50'
                          : isGuarantor
                          ? 'bg-amber-50'
                          : 'bg-white'
                      }
                    >
                      <td className="px-3 py-2 text-gray-500">{row.instalmentNumber}</td>
                      <td className="px-3 py-2">
                        {new Date(row.dueDate).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-right">{row.dueAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{row.paidAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        {row.penaltyAmount > 0 ? (
                          <span className="text-red-600">
                            {row.penaltyAmount.toLocaleString()}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${REPAYMENT_STATUS_BADGE[row.status]}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {isGuarantor ? (
                          <span className="text-amber-700">Guarantor offset</span>
                        ) : (
                          row.source ?? '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Exit Settlement Panel ── */}
      {showExitPanel && (
        <div className="bg-white border border-orange-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-orange-800 mb-1">Exit Settlement</h2>
          <p className="text-xs text-orange-600 mb-4">
            {borrower?.fullName} has status{' '}
            <strong>{borrower?.status}</strong>. Record the exit settlement below.
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Outstanding Balance:{' '}
            <span className="font-semibold">{summary.outstanding.toLocaleString()}</span>
          </p>
          <form
            onSubmit={settlementForm.handleSubmit((v) => settlementMutation.mutate(v))}
            className="space-y-4"
          >
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                Deduction from Final Pay / Gratuity
              </label>
              <input
                {...settlementForm.register('exitDeductionAmount')}
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
              />
            </div>
            {deductionAmount >= 0 && summary.outstanding > 0 && (
              <div className="bg-orange-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Amount covered by deduction:</span>
                  <span className="font-medium">{amountCovered.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Remaining balance:</span>
                  <span
                    className={`font-medium ${
                      remainingAfterDeduction > 0 ? 'text-orange-700' : 'text-green-700'
                    }`}
                  >
                    {remainingAfterDeduction.toLocaleString()}
                  </span>
                </div>
                {remainingAfterDeduction > 0 && (
                  <p className="text-xs text-orange-600 mt-1">
                    Remaining will be offset against guarantor contributions where available;
                    remainder becomes bad debt.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Notes</label>
              <textarea
                {...settlementForm.register('notes')}
                rows={2}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={settlementMutation.isPending}
              className="px-4 py-2 text-sm bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-60"
            >
              {settlementMutation.isPending ? 'Processing…' : 'Confirm Exit Settlement'}
            </button>
          </form>
        </div>
      )}

      {/* ── Settlement Summary ── */}
      {showSettlementSummary && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Settlement Summary</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {(
              [
                ['Exit Deduction',    loan.exitDeductionAmount    ?? 0, false],
                ['Guarantor Offset',  loan.guarantorOffsetAmount  ?? 0, false],
                ['Bad Debt',          loan.badDebtAmount          ?? 0, true],
              ] as [string, number, boolean][]
            ).map(([label, value, red]) => (
              <div key={label}>
                <p className="text-xs text-gray-500">{label}</p>
                <p
                  className={`font-semibold mt-0.5 ${
                    red && value > 0 ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          {loan.settledAt && (
            <p className="text-xs text-gray-400 mt-3">
              Settled on {new Date(loan.settledAt).toLocaleDateString('en-GB')}
            </p>
          )}
        </div>
      )}

      {/* ── Record Payment Modal ── */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Record Payment</h2>
              <button
                onClick={() => { setShowPaymentModal(false); paymentForm.reset(); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={paymentForm.handleSubmit((v) => paymentMutation.mutate(v))}
              className="px-6 py-4 space-y-4"
            >
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Amount *</label>
                <input
                  {...paymentForm.register('amount')}
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputClass}
                />
                {paymentForm.formState.errors.amount && (
                  <p className="text-xs text-red-600">
                    {paymentForm.formState.errors.amount.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Payment Date *</label>
                <input {...paymentForm.register('paidDate')} type="date" className={inputClass} />
                {paymentForm.formState.errors.paidDate && (
                  <p className="text-xs text-red-600">
                    {paymentForm.formState.errors.paidDate.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Notes</label>
                <textarea {...paymentForm.register('notes')} rows={2} className={inputClass} />
              </div>
              {affectedInstalments.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm">
                  <p className="text-xs font-medium text-blue-700 mb-2">
                    Instalments that will be affected:
                  </p>
                  <ul className="space-y-1">
                    {affectedInstalments.map(({ instalment, applied }) => (
                      <li
                        key={instalment._id}
                        className="flex justify-between text-blue-800 text-xs"
                      >
                        <span>
                          #{instalment.instalmentNumber} (
                          {new Date(instalment.dueDate).toLocaleDateString('en-GB')})
                        </span>
                        <span className="font-medium">+{applied.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowPaymentModal(false); paymentForm.reset(); }}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paymentMutation.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                >
                  {paymentMutation.isPending ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/loans/[id]/"
git commit -m "feat(web): loan detail page with schedule, payment modal, exit settlement"
```

---

## Task 5: Staff detail — Loans and Guaranteeing tabs

**Files:**
- Modify: `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx`

The current file has two placeholder sections. Replace both.

**Guaranteeing tab extras (beyond the loan list):**
- Summary row: active guarantee count + total exposure (sum of `totalRepayable` for Active loans)
- Warning badge when `activeCount >= maxPerGuarantor` (fetch config for the cap)
- Offset history: fetch schedules for all guarantee loans, filter by `source === RepaymentSource.GuarantorOffset && guarantorStaffId === id`

- [ ] **Step 1: Add imports**

At the top of `staff-detail-client.tsx`, add to the existing import block:
```typescript
import { useQueries } from '@tanstack/react-query';
import { LoanStatus, RepaymentSource } from '@welfare/shared';
import type { ILoan, ILoanRepayment } from '@welfare/shared';
import { getLoansByStaff, getLoansByGuarantor, getLoanSchedule } from '@/lib/loans';
import { getConfig } from '@/lib/config';
```

- [ ] **Step 2: Add queries inside StaffDetailClient**

After the `contributions` query (around line 66 of the original file), add:
```typescript
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

// Schedules for offset history — one per guarantee loan
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
```

Also add `useMemo` to the existing imports if not already present — it is used in the existing file so it should already be imported.

- [ ] **Step 3: Replace the Loans tab placeholder**

Find:
```typescript
{activeTab === 'Loans' && (
  <div className="text-sm text-gray-400 py-8 text-center">
    Loan history — available in Phase 5.
  </div>
)}
```

Replace with:
```typescript
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
                <th
                  key={h}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {staffLoans.data.map((loan: ILoan) => (
              <tr key={loan._id}>
                <td className="px-3 py-2 font-medium">
                  {loan.principalAmount.toLocaleString()}
                </td>
                <td className="px-3 py-2">{loan.totalRepayable.toLocaleString()}</td>
                <td className="px-3 py-2">{loan.tenureMonths}mo</td>
                <td className="px-3 py-2">
                  {new Date(loan.disbursedDate).toLocaleDateString('en-GB')}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      loan.status === LoanStatus.Active
                        ? 'bg-green-100 text-green-800'
                        : loan.status === LoanStatus.Completed
                        ? 'bg-blue-100 text-blue-700'
                        : loan.status === LoanStatus.BadDebt
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {loan.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <a
                    href={`/loans/${loan._id}`}
                    className="text-blue-600 text-xs hover:underline"
                  >
                    View
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Replace the Guaranteeing tab placeholder**

Find:
```typescript
{activeTab === 'Guaranteeing' && (
  <div className="text-sm text-gray-400 py-8 text-center">
    Co-signed loans — available in Phase 5.
  </div>
)}
```

Replace with:
```typescript
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
        {/* Summary + cap warning */}
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
            <div
              className={`rounded-lg p-3 flex flex-wrap gap-6 text-sm ${
                atCap ? 'bg-red-50' : 'bg-gray-50'
              }`}
            >
              <div>
                <p className="text-xs text-gray-500">Active Guarantees</p>
                <p className="font-semibold text-gray-900">{active.length}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Exposure</p>
                <p className="font-semibold text-gray-900">
                  {totalExposure.toLocaleString()}
                </p>
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

        {/* Loan list */}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Borrower ID', 'Principal', 'Outstanding', 'Disbursed', 'Status', ''].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {guaranteeLoans.data.map((loan: ILoan, i: number) => {
                const schedule = guaranteeScheduleQueries[i]?.data;
                const outstanding = schedule
                  ? Math.round(
                      schedule.reduce(
                        (s, r) =>
                          s + Math.max(0, r.dueAmount + r.penaltyAmount - r.paidAmount),
                        0,
                      ) * 100,
                    ) / 100
                  : null;
                return (
                  <tr key={loan._id}>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">
                      {loan.staffId.slice(-8)}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {loan.principalAmount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {outstanding === null ? (
                        <span className="text-gray-300 text-xs">…</span>
                      ) : (
                        outstanding.toLocaleString()
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {new Date(loan.disbursedDate).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          loan.status === LoanStatus.Active
                            ? 'bg-green-100 text-green-800'
                            : loan.status === LoanStatus.Completed
                            ? 'bg-blue-100 text-blue-700'
                            : loan.status === LoanStatus.BadDebt
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {loan.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/loans/${loan._id}`}
                        className="text-blue-600 text-xs hover:underline"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Offset history */}
        {offsetHistory.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-3">Offset History</h4>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Date', 'Loan Principal', 'Instalment #', 'Amount Applied'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {offsetHistory.map((r) => (
                    <tr key={r._id} className="bg-amber-50">
                      <td className="px-3 py-2">
                        {r.paidDate
                          ? new Date(r.paidDate).toLocaleDateString('en-GB')
                          : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {r.loanPrincipal.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{r.instalmentNumber}</td>
                      <td className="px-3 py-2 font-medium text-amber-700">
                        {r.paidAmount.toLocaleString()}
                      </td>
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
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx"
git commit -m "feat(web): fill Loans and Guaranteeing tabs on staff detail page"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|-------------|------|
| Loan list — table with Staff Name, Staff ID, Principal, Total Repayable, Disbursed, Tenure, Outstanding, Status | Task 2 |
| Loan list — filter: status (incl. BadDebt) | Task 2 |
| Loan list — filter: disbursed month/year | Task 2 (client-side on loaded page) |
| Loan list — "Record New Loan" button | Task 2 |
| New loan — staff picker with eligibility inline | Task 3 |
| New loan — guarantor picker with active count and cap flag | Task 3 |
| New loan — amount input with min/max from config | Task 3 |
| New loan — tenure selector with derived interest rate | Task 3 |
| New loan — disbursed date picker | Task 3 |
| New loan — live repayment schedule preview | Task 3 |
| New loan — file upload for approval form | Task 3 |
| Loan detail — header: staff name, principal, status badge, guarantor + count | Task 4 |
| Loan detail — repayment schedule with row highlighting (overdue=red, guarantor=amber) | Task 4 |
| Loan detail — payment summary: Total Paid, Outstanding, Next Due Date/Amount | Task 4 |
| Loan detail — Record Payment modal with amount + date + instalment preview | Task 4 |
| Loan detail — exit settlement panel (visible when staff resigned/dismissed/deceased + loan Active) | Task 4 |
| Loan detail — real-time settlement preview (covered, remaining) | Task 4 |
| Loan detail — settlement summary after settlement | Task 4 |
| Loan detail — download approval document link | Task 4 |
| Staff detail Loans tab | Task 5 |
| Staff detail Guaranteeing tab — loan list, total exposure, cap warning, offset history | Task 5 |

### Type consistency check

- `LoanFilters`, `CreateLoanPayload`, `RecordPaymentPayload`, `ExitSettlementPayload` defined in Task 1, used in Tasks 2–5 ✓
- `LOAN_STATUS_BADGE` defined separately in Task 2 and Task 4 — intentional duplication, no shared file needed ✓
- `round2()` and `computeAffectedInstalments()` defined in Task 4 only ✓
- `computeDueDate()` defined in Task 3 only ✓
- `ILoanRepayment & { loanPrincipal: number }` inline type in Task 5 offset history — consistent with `ILoanRepayment` from `@welfare/shared` ✓

### Limitations noted

- **Month/year filter** operates only on the current loaded page (API has no date filter). Acceptable for small dataset.
- **Guarantor borrower name** on guaranteeing tab shows `staffId` slice (not full name) — avoids N+1 lookups for a tab that may have many loans.
