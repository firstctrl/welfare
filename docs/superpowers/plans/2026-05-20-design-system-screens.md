# Design System Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 
> **Prerequisite:** Plan 1 (`2026-05-20-design-system-foundation.md`) must be fully complete before starting this plan. All shared components and chrome must exist.

**Goal:** Retheme all 10 screens (Dashboard, Staff list, Staff detail, Loans list, Loan detail, New loan, Contributions import, Reports, Settings, Audit log, Email log) to match the Welfare Management Design System — using live API data, replacing the existing generic blue/gray Tailwind styling throughout.

**Architecture:** Each screen is a `*-client.tsx` file that replaces its existing generic styling with design-system components (`Button`, `Badge`, `Card`, `KpiCard`, `DataTable`, `Modal`, `Field`, `Input`, `RepaymentBar`, etc.) and design tokens. API calls and data shapes are preserved unchanged. Charts (Recharts) are recolored to use `--chart-*` palette.

**Tech Stack:** Next.js 14, Recharts 2, lucide-react, @tanstack/react-table, react-hook-form, zod, sonner — all existing, no new installs needed.

---

## File Map

| Action | Path |
|--------|------|
| Rewrite | `apps/web/src/app/(dashboard)/dashboard-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/staff/staff-list-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/staff/add-staff-modal.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/contributions/manual/manual-entry-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/reports/reports-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/settings/settings-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/audit/audit-client.tsx` |
| Rewrite | `apps/web/src/app/(dashboard)/email-log/email-log-client.tsx` |
| Modify  | `apps/web/src/app/(dashboard)/contributions/page.tsx` |

---

### Task 1: Dashboard screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/dashboard-client.tsx`

- [ ] **Step 1: Read current getDashboardStats return shape**

```bash
grep -n 'getDashboardStats\|thisMonth\|loans\|overdueInstalments\|monthlyTrend\|loanStatusDistribution\|upcomingPayments\|recentFlaggedBatches' apps/web/src/lib/reports.ts | head -40
```

Confirm the shape before rewriting. The implementation below assumes the existing shape from the current `dashboard-client.tsx`.

- [ ] **Step 2: Rewrite `dashboard-client.tsx`**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Banknote, Wallet, AlertCircle, TrendingUp } from 'lucide-react';
import { getDashboardStats } from '@/lib/reports';
import { KpiCard } from '@/components/ui/kpi-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiSkeleton, TableSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { fmtGHS, fmtDate } from '@/lib/format';

const CHART_COLORS = ['#720026', '#B7791F', '#0F973D', '#CB1A14', '#98A2B3'];

export function DashboardClient() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 bg-white border border-neutral-200 rounded-md h-72" />
          <div className="bg-white border border-neutral-200 rounded-md h-72" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-base text-danger-700">
        Failed to load dashboard. Check the API connection.
      </p>
    );
  }

  const collectionPct = data.thisMonth.collectionRate.toFixed(1);
  const outstanding = data.loans.totalOutstanding;

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Dashboard</h1>
        <p className="text-base text-neutral-500 mt-0.5">
          Welfare Department — Narcotics Control Commission
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Collected this month"
          value={fmtGHS(data.thisMonth.collected)}
          icon={Wallet}
          sub={`${collectionPct}% of ${fmtGHS(data.thisMonth.expected)} expected`}
          trendDirection={data.thisMonth.collectionRate >= 80 ? 'up' : 'down'}
          trend={`${collectionPct}%`}
        />
        <KpiCard
          label="Active loans"
          value={data.loans.activeCount}
          icon={Banknote}
          sub={`${fmtGHS(outstanding)} outstanding`}
        />
        <KpiCard
          label="Overdue instalments"
          value={data.overdueInstalments}
          icon={AlertCircle}
          danger={data.overdueInstalments > 0}
        />
        <KpiCard
          label="Members in arrears"
          value={data.membersInArrears}
          icon={TrendingUp}
          danger={data.membersInArrears > 0}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4">
        {/* 12-month bar chart */}
        <Card className="col-span-2">
          <CardHeader title="Monthly contributions (12 months)" />
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.monthlyTrend} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-secondary)', fontFamily: 'Nunito' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)', fontFamily: 'Nunito' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number) => [fmtGHS(v), '']}
                  contentStyle={{ fontFamily: 'Nunito', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 6 }}
                />
                <Bar dataKey="expected" name="Expected" fill="#E4E7EC" radius={[3, 3, 0, 0]} />
                <Bar dataKey="collected" name="Collected" fill="var(--chart-1, #720026)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Loan status donut */}
        <Card>
          <CardHeader title="Loan status distribution" />
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.loanStatusDistribution}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {data.loanStatusDistribution.map((_: unknown, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'Nunito' }} />
                <Tooltip
                  contentStyle={{ fontFamily: 'Nunito', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 6 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Upcoming payments */}
        <Card>
          <CardHeader title="Upcoming payments (next 7 days)" />
          {data.upcomingPayments.length === 0 ? (
            <CardBody>
              <p className="text-sm text-neutral-400">No payments due in the next 7 days.</p>
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200">
                    <th className="px-5 h-9 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Staff</th>
                    <th className="px-5 h-9 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Instalment</th>
                    <th className="px-5 h-9 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Due date</th>
                    <th className="px-5 h-9 text-right text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingPayments.map((p: { staffName: string; instalmentNumber: number; dueDate: string; dueAmount: number }, i: number) => (
                    <tr key={i} className="border-b border-neutral-100 h-9 hover:bg-neutral-50">
                      <td className="px-5 text-base text-neutral-700">{p.staffName}</td>
                      <td className="px-5 text-base text-neutral-700">#{p.instalmentNumber}</td>
                      <td className="px-5 text-base text-neutral-700">{fmtDate(p.dueDate)}</td>
                      <td className="px-5 text-right text-base font-mono tabular text-neutral-700">{fmtGHS(p.dueAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Flagged batches */}
        <Card>
          <CardHeader title="Recently flagged imports" />
          {data.recentFlaggedBatches.length === 0 ? (
            <CardBody>
              <p className="text-sm text-neutral-400">No flagged import batches recently.</p>
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200">
                    <th className="px-5 h-9 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">File</th>
                    <th className="px-5 h-9 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Period</th>
                    <th className="px-5 h-9 text-right text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentFlaggedBatches.map((b: { fileName: string; month: number; year: number; flaggedRows: number }, i: number) => (
                    <tr key={i} className="border-b border-neutral-100 h-9 hover:bg-neutral-50">
                      <td className="px-5 text-base text-neutral-700 truncate max-w-[160px]">{b.fileName}</td>
                      <td className="px-5 text-base text-neutral-700">{b.month}/{b.year}</td>
                      <td className="px-5 text-right">
                        <StatusBadge status={b.flaggedRows > 0 ? 'Overdue' : 'Paid'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and verify dashboard visually**

```bash
cd apps/web && npm run dev
```

Navigate to `http://localhost:3000`. Verify:
- KPI cards show crimson/institutional style, not blue
- Charts use `#720026` (crimson) for collected bar and donut
- Cards have white bg, `1px border-neutral-200`, `rounded-md`
- Font is Nunito throughout
- Amounts format as `₵12,450.00`

Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add apps/web/src/app/\(dashboard\)/dashboard-client.tsx
git commit -m "feat: retheme Dashboard with design system KPI cards, charts, and tokens"
```

---

### Task 2: Staff list screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/staff/staff-list-client.tsx`

- [ ] **Step 1: Read current staff-list-client.tsx columns and query shape fully**

```bash
cat apps/web/src/app/\(dashboard\)/staff/staff-list-client.tsx
```

Confirm: `listStaff`, `searchStaff` from `@/lib/staff`, returns `IStaff[]` with `fullName`, `staffId`, `level`, `status`, `dateOfEmployment`. `StaffStatus` enum from `@welfare/shared`.

- [ ] **Step 2: Rewrite `staff-list-client.tsx`**

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import type { IStaff } from '@welfare/shared';
import { StaffStatus } from '@welfare/shared';
import { listStaff, searchStaff } from '@/lib/staff';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { fmtDate } from '@/lib/format';
import AddStaffModal from './add-staff-modal';

const col = createColumnHelper<IStaff>();

export default function StaffListClient() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StaffStatus | ''>('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['staff', { page, status, level, q }],
    queryFn: () =>
      q
        ? searchStaff(q)
        : listStaff({ page, limit, ...(status && { status }), ...(level && { level }) }),
    staleTime: 60_000,
  });

  const staff: IStaff[] = Array.isArray(data) ? data : (data as { staff: IStaff[] } | undefined)?.staff ?? [];

  const handleSearch = useCallback(() => {
    setQ(searchInput);
    setPage(1);
  }, [searchInput]);

  const columns = [
    col.display({
      id: 'avatar-name',
      header: 'Name',
      cell: (info) => (
        <div className="flex items-center gap-3">
          <Avatar name={info.row.original.fullName} size="sm" />
          <span className="font-medium text-neutral-900">{info.row.original.fullName}</span>
        </div>
      ),
    }),
    col.accessor('staffId', {
      header: 'Staff ID',
      cell: (info) => (
        <span className="font-mono tabular text-neutral-700">{info.getValue()}</span>
      ),
    }),
    col.accessor('level', { header: 'Level' }),
    col.accessor('status', {
      header: 'Status',
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    col.accessor('dateOfEmployment', {
      header: 'Employed',
      cell: (info) => fmtDate(info.getValue()),
    }),
  ];

  return (
    <div className="space-y-4">
      {/* Page heading */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Staff</h1>
          <p className="text-base text-neutral-500 mt-0.5">All welfare department staff members</p>
        </div>
        <Button Icon={UserPlus} onClick={() => setShowAddModal(true)}>
          Add staff
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by name or staff ID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <Select
          value={status}
          onChange={(e) => { setStatus(e.target.value as StaffStatus | ''); setPage(1); }}
          options={[
            ...Object.values(StaffStatus).map((s) => ({ value: s, label: s })),
          ]}
          placeholder="All statuses"
          className="w-40"
        />
        <Button variant="secondary" onClick={handleSearch} size="md">
          Search
        </Button>
        {q && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => { setQ(''); setSearchInput(''); }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
        <DataTable
          data={staff}
          columns={columns}
          isLoading={isLoading}
          emptyHeading="No staff members found"
          emptyBody="Add staff members or adjust your search filters."
          onRowClick={(row) => router.push(`/staff/${row._id}`)}
        />
      </div>

      <AddStaffModal open={showAddModal} onClose={() => setShowAddModal(false)} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/staff-list-client.tsx
git commit -m "feat: retheme Staff list with DataTable, StatusBadge, Avatar, and filter bar"
```

---

### Task 3: Add staff modal retheme

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/staff/add-staff-modal.tsx`

- [ ] **Step 1: Read current add-staff-modal.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/staff/add-staff-modal.tsx
```

Preserve all form fields, validation schema, and mutation logic. Only replace styling.

- [ ] **Step 2: Retheme modal wrapper and form fields**

The key changes to make in `add-staff-modal.tsx`:
1. Replace the modal overlay/panel with `<Modal>` from `@/components/ui/modal`
2. Replace every `<input>` / `<select>` with `<Input>` / `<Select>` wrapped in `<Field>`
3. Replace submit button with `<Button variant="primary">`
4. Replace cancel button with `<Button variant="secondary">`

Pattern for each form field (adapt to actual field names):
```tsx
import { Modal } from '@/components/ui/modal';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';

// Replace: <div className="fixed inset-0 ..."> with:
<Modal
  open={open}
  onClose={onClose}
  title="Add staff member"
  size="md"
  footer={
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" loading={isPending} onClick={handleSubmit(onSubmit)}>
        Save staff member
      </Button>
    </>
  }
>
  {/* form fields */}
  <div className="space-y-4 mt-2">
    <Field label="Full name" required error={errors.fullName?.message}>
      <Input {...register('fullName')} placeholder="e.g. Kofi Mensah" error={!!errors.fullName} />
    </Field>
    {/* repeat for other fields */}
  </div>
</Modal>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/add-staff-modal.tsx
git commit -m "feat: retheme Add staff modal with branded Modal, Field, Input components"
```

---

### Task 4: Staff detail screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx`

- [ ] **Step 1: Read current staff-detail-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/staff/\[id\]/staff-detail-client.tsx
```

Note the API calls, staff object shape, and existing sub-tables.

- [ ] **Step 2: Retheme `staff-detail-client.tsx`**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowLeft } from 'lucide-react';
import { getStaff } from '@/lib/staff';
import { getLoans } from '@/lib/loans';
import { Avatar } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/skeleton';
import { fmtGHS, fmtDate } from '@/lib/format';
import type { ILoan, IStaff } from '@welfare/shared';

const loanCol = createColumnHelper<ILoan>();

const loanColumns = [
  loanCol.accessor('loanNumber', {
    header: 'Loan no.',
    cell: (info) => <span className="font-mono tabular text-neutral-700">{info.getValue()}</span>,
  }),
  loanCol.accessor('principalAmount', {
    header: 'Amount',
    cell: (info) => <span className="font-mono tabular">{fmtGHS(info.getValue())}</span>,
  }),
  loanCol.accessor('disbursementDate', {
    header: 'Disbursed',
    cell: (info) => fmtDate(info.getValue()),
  }),
  loanCol.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
];

export function StaffDetailClient({ id }: { id: string }) {
  const router = useRouter();

  const { data: staff, isLoading: loadingStaff } = useQuery<IStaff>({
    queryKey: ['staff', id],
    queryFn: () => getStaff(id),
  });

  const { data: loans, isLoading: loadingLoans } = useQuery<ILoan[]>({
    queryKey: ['loans', { staffId: id }],
    queryFn: () => getLoans({ staffId: id }),
    enabled: !!id,
  });

  if (loadingStaff) return <CardSkeleton />;
  if (!staff) return <p className="text-base text-danger-700">Staff member not found.</p>;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" Icon={ArrowLeft} onClick={() => router.push('/staff')}>
        Back to staff
      </Button>

      {/* Profile header card */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-5">
            <Avatar name={staff.fullName} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-neutral-900">{staff.fullName}</h1>
                <StatusBadge status={staff.status} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-base text-neutral-500">
                <span>
                  <span className="text-neutral-400">Staff ID:</span>{' '}
                  <span className="font-mono tabular text-neutral-700">{staff.staffId}</span>
                </span>
                <span>
                  <span className="text-neutral-400">Level:</span>{' '}
                  {staff.level}
                </span>
                <span>
                  <span className="text-neutral-400">Employed:</span>{' '}
                  {fmtDate(staff.dateOfEmployment)}
                </span>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Loan history */}
      <Card>
        <CardHeader title="Loan history" />
        <DataTable
          data={loans ?? []}
          columns={loanColumns}
          isLoading={loadingLoans}
          emptyHeading="No loans on record"
          emptyBody="New loans will appear here once they are recorded."
          onRowClick={(row) => router.push(`/loans/${row._id}`)}
        />
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/\[id\]/staff-detail-client.tsx
git commit -m "feat: retheme Staff detail with profile header card and loan history DataTable"
```

---

### Task 5: Loans list screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx`

- [ ] **Step 1: Read current loans-list-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/loans/loans-list-client.tsx
```

Note: `getLoans` from `@/lib/loans`, returns `{ loans: ILoan[], total, page }`. `LoanStatus` from `@welfare/shared`. Key fields: `loanNumber`, `staffName`/staff ref, `principalAmount`, `disbursementDate`, `tenureMonths`, `status`, repayment progress.

- [ ] **Step 2: Rewrite `loans-list-client.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { LoanStatus } from '@welfare/shared';
import type { ILoan } from '@welfare/shared';
import { getLoans } from '@/lib/loans';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { RepaymentBar } from '@/components/ui/repayment-bar';
import { fmtGHS, fmtDate } from '@/lib/format';

const col = createColumnHelper<ILoan>();

export function LoansListClient() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<LoanStatus | ''>('');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['loans', { page, status, q }],
    queryFn: () => getLoans({ page, limit, ...(status && { status }), ...(q && { q }) }),
    staleTime: 60_000,
  });

  const loans: ILoan[] = (data as { loans: ILoan[] } | undefined)?.loans ?? [];

  const columns = [
    col.accessor('loanNumber', {
      header: 'Loan no.',
      size: 140,
      cell: (info) => (
        <span className="font-mono tabular text-neutral-700">{info.getValue()}</span>
      ),
    }),
    col.display({
      id: 'staff',
      header: 'Staff',
      cell: (info) => (
        <span className="text-neutral-900 font-medium">
          {(info.row.original as ILoan & { staffName?: string }).staffName ?? '—'}
        </span>
      ),
    }),
    col.accessor('principalAmount', {
      header: 'Amount',
      cell: (info) => (
        <span className="font-mono tabular">{fmtGHS(info.getValue())}</span>
      ),
    }),
    col.accessor('disbursementDate', {
      header: 'Disbursed',
      cell: (info) => fmtDate(info.getValue()),
    }),
    col.accessor('tenureMonths', {
      header: 'Tenure',
      cell: (info) => `${info.getValue()} months`,
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    col.display({
      id: 'progress',
      header: 'Progress',
      size: 160,
      cell: (info) => {
        const loan = info.row.original as ILoan & { amountPaid?: number };
        if (!loan.principalAmount) return null;
        return (
          <RepaymentBar
            paid={loan.amountPaid ?? 0}
            total={loan.principalAmount}
            overdue={loan.status === LoanStatus.Defaulted}
            className="w-40"
          />
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Loans</h1>
          <p className="text-base text-neutral-500 mt-0.5">All recorded staff loans</p>
        </div>
        <Button Icon={Plus} onClick={() => router.push('/loans/new')}>
          New loan
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by loan number or staff name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setQ(searchInput); setPage(1); } }}
          />
        </div>
        <Select
          value={status}
          onChange={(e) => { setStatus(e.target.value as LoanStatus | ''); setPage(1); }}
          options={Object.values(LoanStatus).map((s) => ({ value: s, label: s }))}
          placeholder="All statuses"
          className="w-40"
        />
        <Button variant="secondary" onClick={() => { setQ(searchInput); setPage(1); }}>
          Search
        </Button>
        {(q || status) && (
          <Button variant="ghost" onClick={() => { setQ(''); setSearchInput(''); setStatus(''); }}>
            Clear
          </Button>
        )}
      </div>

      <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
        <DataTable
          data={loans}
          columns={columns}
          isLoading={isLoading}
          emptyHeading="No loans yet"
          emptyBody="New loans will appear here once they are recorded."
          onRowClick={(row) => router.push(`/loans/${(row as ILoan & { _id: string })._id}`)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/loans/loans-list-client.tsx
git commit -m "feat: retheme Loans list with DataTable, RepaymentBar, filter bar"
```

---

### Task 6: Loan detail screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

- [ ] **Step 1: Read the full current loan-detail-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/loans/\[id\]/loan-detail-client.tsx
```

Preserve: all mutations (`recordPayment`, `exitSettle`, `getLoansByGuarantor`), form schema (react-hook-form + zod), `EXIT_STATUSES` logic. Only replace visual layer.

- [ ] **Step 2: Identify key UI sections to replace**

From reading the file, identify these sections:
1. Loan header (loan number, staff name, status badge)
2. Repayment progress section
3. Record payment form
4. Repayment schedule table
5. Write-off modal
6. Settlement panel (for inactive staff)

- [ ] **Step 3: Rewrite `loan-detail-client.tsx`**

```tsx
'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  LoanStatus, LoanRepaymentStatus, RepaymentSource, StaffStatus,
} from '@welfare/shared';
import type { ILoanRepayment } from '@welfare/shared';
import {
  getLoan, getLoanSchedule, recordPayment, exitSettle,
} from '@/lib/loans';
import { getStaff } from '@/lib/staff';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { RepaymentBar } from '@/components/ui/repayment-bar';
import { DataTable } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { CardSkeleton } from '@/components/ui/skeleton';
import { fmtGHS, fmtDate } from '@/lib/format';

const EXIT_STATUSES = new Set<StaffStatus>([
  StaffStatus.Resigned, StaffStatus.Dismissed, StaffStatus.Deceased,
]);

const paymentSchema = z.object({
  amount:   z.coerce.number().min(0.01, 'Required'),
  paidDate: z.string().min(1, 'Required'),
  source:   z.nativeEnum(RepaymentSource),
  notes:    z.string().optional(),
});
type PaymentForm = z.infer<typeof paymentSchema>;

const repCol = createColumnHelper<ILoanRepayment>();

const scheduleColumns = [
  repCol.accessor('instalmentNumber', { header: '#', size: 48 }),
  repCol.accessor('dueDate', {
    header: 'Due date',
    cell: (info) => fmtDate(info.getValue()),
  }),
  repCol.accessor('dueAmount', {
    header: 'Due amount',
    cell: (info) => <span className="font-mono tabular">{fmtGHS(info.getValue())}</span>,
  }),
  repCol.accessor('paidDate', {
    header: 'Paid date',
    cell: (info) => fmtDate(info.getValue()),
  }),
  repCol.accessor('amountPaid', {
    header: 'Paid',
    cell: (info) => (
      <span className="font-mono tabular">{info.getValue() ? fmtGHS(info.getValue()) : '—'}</span>
    ),
  }),
  repCol.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
];

export function LoanDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [writeOffOpen, setWriteOffOpen] = useState(false);

  const { data: loan, isLoading: loadingLoan } = useQuery({
    queryKey: ['loan', id],
    queryFn: () => getLoan(id),
  });

  const staffId = (loan as { staffId?: string } | undefined)?.staffId;
  const { data: staff } = useQuery({
    queryKey: ['staff', staffId],
    queryFn: () => getStaff(staffId!),
    enabled: !!staffId,
  });

  const { data: schedule, isLoading: loadingSchedule } = useQuery<ILoanRepayment[]>({
    queryKey: ['loan-schedule', id],
    queryFn: () => getLoanSchedule(id),
    enabled: !!id,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PaymentForm>({ resolver: zodResolver(paymentSchema) });

  const paymentMutation = useMutation({
    mutationFn: (data: PaymentForm) => recordPayment(id, data),
    onSuccess: () => {
      toast.success('Payment recorded.');
      reset();
      queryClient.invalidateQueries({ queryKey: ['loan', id] });
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', id] });
    },
    onError: () => {
      toast.error('Could not record payment. Check that all required fields are filled.');
    },
  });

  const writeOffMutation = useMutation({
    mutationFn: () => exitSettle(id, { action: 'writeoff' }),
    onSuccess: () => {
      toast.success('Loan written off.');
      setWriteOffOpen(false);
      queryClient.invalidateQueries({ queryKey: ['loan', id] });
    },
    onError: () => {
      toast.error('Could not write off loan.');
    },
  });

  const amountPaid = useMemo(
    () => schedule?.reduce((sum, r) => sum + (r.amountPaid ?? 0), 0) ?? 0,
    [schedule],
  );

  if (loadingLoan) return <CardSkeleton />;
  if (!loan) return <p className="text-base text-danger-700">Loan not found.</p>;

  const isInactive = staff && EXIT_STATUSES.has(staff.status as StaffStatus);
  const isDefaulted = (loan as { status: LoanStatus }).status === LoanStatus.Defaulted;
  const principal = (loan as { principalAmount: number }).principalAmount;
  const remaining = principal - amountPaid;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" Icon={ArrowLeft} onClick={() => router.push('/loans')}>
        Back to loans
      </Button>

      {/* Loan header */}
      <Card>
        <CardBody>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-neutral-900">
                  {(loan as { loanNumber: string }).loanNumber}
                </h1>
                <StatusBadge status={(loan as { status: LoanStatus }).status} />
              </div>
              <p className="text-base text-neutral-500 mt-1">
                {staff?.fullName ?? '—'} ·{' '}
                <span className="font-mono tabular">{staff?.staffId ?? '—'}</span>
              </p>
            </div>
            {isDefaulted && (
              <Button
                variant="danger"
                destructive
                Icon={AlertTriangle}
                onClick={() => setWriteOffOpen(true)}
              >
                Write off loan
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Repayment progress */}
      <Card>
        <CardBody>
          <RepaymentBar
            paid={amountPaid}
            total={principal}
            overdue={isDefaulted}
          />
        </CardBody>
      </Card>

      <div className="grid grid-cols-3 gap-6">
        {/* Record payment */}
        <Card className="col-span-1">
          <CardHeader title="Record payment" />
          <CardBody>
            <form
              onSubmit={handleSubmit((d) => paymentMutation.mutate(d))}
              className="space-y-4"
            >
              <Field label="Amount (₵)" required error={errors.amount?.message}>
                <Input
                  {...register('amount')}
                  type="number"
                  step="0.01"
                  prefix="₵"
                  mono
                  error={!!errors.amount}
                />
              </Field>
              <Field label="Payment date" required error={errors.paidDate?.message}>
                <Input {...register('paidDate')} type="date" error={!!errors.paidDate} />
              </Field>
              <Field label="Source" required error={errors.source?.message}>
                <Select
                  {...register('source')}
                  options={Object.values(RepaymentSource).map((v) => ({ value: v, label: v }))}
                  placeholder="Select source"
                  error={!!errors.source}
                />
              </Field>
              <Field label="Notes">
                <Input {...register('notes')} placeholder="Optional notes" />
              </Field>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={paymentMutation.isPending}
              >
                Record payment
              </Button>
            </form>
          </CardBody>
        </Card>

        {/* Repayment schedule */}
        <Card className="col-span-2">
          <CardHeader title="Repayment schedule" />
          <DataTable
            data={schedule ?? []}
            columns={scheduleColumns}
            isLoading={loadingSchedule}
            emptyHeading="No schedule generated"
          />
        </Card>
      </div>

      {/* Settlement panel (inactive staff) */}
      {isInactive && (
        <Card>
          <CardHeader title="Exit settlement" subtitle="Staff member has exited the commission." />
          <CardBody>
            <p className="text-base text-neutral-600">
              Outstanding balance:{' '}
              <span className="font-mono tabular font-semibold text-danger-700">
                {fmtGHS(remaining)}
              </span>
            </p>
            <p className="text-sm text-neutral-500 mt-1">
              Contact the accounts office to process an exit deduction or write-off.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Write-off confirmation modal */}
      <Modal
        open={writeOffOpen}
        onClose={() => setWriteOffOpen(false)}
        title="Write off this loan?"
        icon={<AlertTriangle size={20} strokeWidth={1.75} />}
        iconKind="danger"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWriteOffOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              destructive
              loading={writeOffMutation.isPending}
              onClick={() => writeOffMutation.mutate()}
            >
              Write off loan
            </Button>
          </>
        }
      >
        <p className="text-base text-neutral-600">
          This action cannot be undone. The remaining{' '}
          <span className="font-mono tabular font-semibold">{fmtGHS(remaining)}</span> balance
          will be recorded as bad debt.
        </p>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/loans/\[id\]/loan-detail-client.tsx
git commit -m "feat: retheme Loan detail with profile header, RepaymentBar, payment form, write-off modal"
```

---

### Task 7: New loan form screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx`

- [ ] **Step 1: Read current new-loan-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/loans/new/new-loan-client.tsx
```

Preserve: form schema, staff search logic, tenure/amount calculations, repayment schedule preview calculation, submission mutation.

- [ ] **Step 2: Retheme to 2-col layout**

The rewrite wraps the existing logic in the new visual shell. Key changes:
1. Outer layout: `grid grid-cols-[3fr_2fr] gap-6`
2. Left: form in a `<Card>` with `<Field>` + `<Input>` / `<Select>` for each field
3. Right: sticky `<Card>` with live schedule preview table and summary stats
4. Submit: `<Button variant="primary">Save loan</Button>`

```tsx
'use client';

// Preserve all existing imports + logic from current new-loan-client.tsx.
// Key structural changes only shown here:

// OUTER LAYOUT:
return (
  <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-semibold text-neutral-900">New loan</h1>
      <p className="text-base text-neutral-500 mt-0.5">Record a new staff loan</p>
    </div>

    <div className="grid grid-cols-[3fr_2fr] gap-6 items-start">
      {/* LEFT: form */}
      <Card>
        <CardHeader title="Loan details" />
        <CardBody>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <Field label="Staff member" required error={errors.staffId?.message}>
              {/* existing staff search/select UI, wrapped in Field */}
              <Input
                {...register('staffId')}
                placeholder="Search by name or staff ID"
                error={!!errors.staffId}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Loan amount (₵)" required error={errors.principalAmount?.message}>
                <Input
                  {...register('principalAmount')}
                  type="number"
                  step="0.01"
                  prefix="₵"
                  mono
                  error={!!errors.principalAmount}
                />
              </Field>
              <Field label="Tenure (months)" required error={errors.tenureMonths?.message}>
                <Input
                  {...register('tenureMonths')}
                  type="number"
                  suffix="months"
                  error={!!errors.tenureMonths}
                />
              </Field>
            </div>

            <Field label="Disbursement date" required error={errors.disbursementDate?.message}>
              <Input {...register('disbursementDate')} type="date" error={!!errors.disbursementDate} />
            </Field>

            <Field label="Guarantor 1" error={errors.guarantor1Id?.message}>
              <Input {...register('guarantor1Id')} placeholder="Search guarantor" />
            </Field>

            <Field label="Guarantor 2" error={errors.guarantor2Id?.message}>
              <Input {...register('guarantor2Id')} placeholder="Search guarantor" />
            </Field>

            <div className="flex gap-3 pt-2">
              <Button type="submit" variant="primary" loading={isPending} className="flex-1">
                Save loan
              </Button>
              <Button type="button" variant="secondary" onClick={() => router.push('/loans')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* RIGHT: live schedule preview (sticky) */}
      <div className="sticky top-6">
        <Card>
          <CardHeader title="Repayment schedule preview" />
          <CardBody>
            {previewSchedule.length > 0 ? (
              <>
                <div className="flex gap-6 mb-4">
                  <div>
                    <p className="text-2xs text-neutral-500 uppercase tracking-widest">Monthly instalment</p>
                    <p className="text-lg font-semibold font-mono tabular text-neutral-900 mt-0.5">
                      {fmtGHS(monthlyInstalment)}
                    </p>
                  </div>
                  <div>
                    <p className="text-2xs text-neutral-500 uppercase tracking-widest">Total repayable</p>
                    <p className="text-lg font-semibold font-mono tabular text-neutral-900 mt-0.5">
                      {fmtGHS(totalRepayable)}
                    </p>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-neutral-50">
                      <tr>
                        <th className="px-3 h-8 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">#</th>
                        <th className="px-3 h-8 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Due date</th>
                        <th className="px-3 h-8 text-right text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em]">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewSchedule.map((row, i) => (
                        <tr key={i} className="border-t border-neutral-100 h-8 hover:bg-neutral-50">
                          <td className="px-3 text-neutral-500">{row.instalmentNumber}</td>
                          <td className="px-3 text-neutral-700">{fmtDate(row.dueDate)}</td>
                          <td className="px-3 text-right font-mono tabular text-neutral-700">{fmtGHS(row.dueAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-400">
                Enter an amount and tenure to preview the repayment schedule.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  </div>
);
```

Note: preserve all existing hooks, state, and calculation logic — only the JSX return changes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/loans/new/new-loan-client.tsx
git commit -m "feat: retheme New loan form with 2-col layout, Field/Input components, live schedule preview"
```

---

### Task 8: Contributions import screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx`

- [ ] **Step 1: Read current import-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/contributions/import/import-client.tsx
```

Preserve: file upload logic, drag-drop state, import mutation, flagged entries table data.

- [ ] **Step 2: Rewrite `import-client.tsx`**

```tsx
'use client';

// Preserve all existing logic (drag-drop handlers, upload mutation, flagged entry state).
// Structural changes to the JSX:

return (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold text-neutral-900">Import contributions</h1>
      <p className="text-base text-neutral-500 mt-0.5">
        Upload a CSV file to import monthly contribution records.
      </p>
    </div>

    {/* Dropzone */}
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'border-2 border-dashed rounded-md flex flex-col items-center justify-center gap-3 py-16 px-8 cursor-pointer transition-colors duration-fast',
        dragOver
          ? 'border-primary-300 bg-primary-50'
          : 'border-neutral-200 bg-white hover:border-neutral-300',
      )}
      onClick={() => fileInputRef.current?.click()}
    >
      <Upload size={32} strokeWidth={1.75} className="text-neutral-400" />
      <div className="text-center">
        <p className="text-md font-medium text-neutral-700">
          Drag a CSV file here, or click to select
        </p>
        <p className="text-sm text-neutral-400 mt-0.5">
          Accepted format: CSV with columns StaffID, Month, Year, Amount
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>

    {/* Upload action */}
    {selectedFile && (
      <Card>
        <CardBody>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-medium text-neutral-900">{selectedFile.name}</p>
              <p className="text-sm text-neutral-400 mt-0.5">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <Button
              variant="primary"
              loading={uploadMutation.isPending}
              onClick={() => uploadMutation.mutate(selectedFile)}
            >
              Import file
            </Button>
          </div>
        </CardBody>
      </Card>
    )}

    {/* Import result */}
    {importResult && (
      <Card>
        <CardHeader title="Import result" />
        <CardBody>
          <div className="flex gap-8">
            <div>
              <p className="text-2xs text-neutral-500 uppercase tracking-widest">Rows imported</p>
              <p className="text-2xl font-semibold text-success-700 mt-0.5">{importResult.imported}</p>
            </div>
            <div>
              <p className="text-2xs text-neutral-500 uppercase tracking-widest">Flagged</p>
              <p className="text-2xl font-semibold text-warning-700 mt-0.5">{importResult.flagged}</p>
            </div>
            <div>
              <p className="text-2xs text-neutral-500 uppercase tracking-widest">Errors</p>
              <p className="text-2xl font-semibold text-danger-700 mt-0.5">{importResult.errors}</p>
            </div>
          </div>
        </CardBody>
      </Card>
    )}

    {/* Flagged entries */}
    {flaggedEntries.length > 0 && (
      <Card>
        <CardHeader
          title="Flagged entries"
          subtitle="Review and resolve flagged rows before they are posted."
        />
        <DataTable
          data={flaggedEntries}
          columns={flaggedColumns}
          emptyHeading="No flagged entries"
        />
      </Card>
    )}
  </div>
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/contributions/import/import-client.tsx
git commit -m "feat: retheme Contributions import with dropzone, result card, flagged entries table"
```

---

### Task 9: Contributions page (hub)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/contributions/page.tsx`

- [ ] **Step 1: Read current contributions/page.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/contributions/page.tsx
```

- [ ] **Step 2: Add navigation cards if the page is a hub linking to import and manual entry**

If the page is a plain hub (not already a list), retheme it:

```tsx
import Link from 'next/link';
import { Upload, PenLine } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';

export default function ContributionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Contributions</h1>
        <p className="text-base text-neutral-500 mt-0.5">Manage staff monthly contribution records</p>
      </div>
      <div className="grid grid-cols-2 gap-4 max-w-xl">
        <Link href="/contributions/import">
          <Card className="hover:border-primary-300 transition-colors duration-fast cursor-pointer">
            <CardBody>
              <Upload size={24} strokeWidth={1.75} className="text-primary-500 mb-3" />
              <h3 className="text-md font-semibold text-neutral-900">Import from CSV</h3>
              <p className="text-sm text-neutral-500 mt-1">
                Upload a monthly contribution file to batch-import records.
              </p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/contributions/manual">
          <Card className="hover:border-primary-300 transition-colors duration-fast cursor-pointer">
            <CardBody>
              <PenLine size={24} strokeWidth={1.75} className="text-primary-500 mb-3" />
              <h3 className="text-md font-semibold text-neutral-900">Manual entry</h3>
              <p className="text-sm text-neutral-500 mt-1">
                Record a single contribution payment manually.
              </p>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/contributions/page.tsx
git commit -m "feat: retheme Contributions hub page with navigation cards"
```

---

### Task 10: Reports screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

- [ ] **Step 1: Read current reports-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/reports/reports-client.tsx
```

Preserve: `getReports` / report query calls, data shape, filter state, export logic.

- [ ] **Step 2: Retheme to left-selector + right-panel layout**

```tsx
'use client';

// Preserve all existing imports and logic.
// Key structural change: 2-panel layout.

const REPORT_GROUPS = [
  {
    label: 'Monthly',
    items: [
      { id: 'monthly-contributions', label: 'Monthly contributions' },
      { id: 'monthly-loans', label: 'Monthly loan disbursements' },
    ],
  },
  {
    label: 'Quarterly',
    items: [
      { id: 'quarterly-summary', label: 'Quarterly summary' },
    ],
  },
  {
    label: 'Operational',
    items: [
      { id: 'defaulters', label: 'Loan defaulters' },
      { id: 'outstanding', label: 'Outstanding balances' },
      { id: 'station-breakdown', label: 'Station breakdown' },
    ],
  },
];

return (
  <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-semibold text-neutral-900">Reports</h1>
      <p className="text-base text-neutral-500 mt-0.5">Generate and export welfare operation reports</p>
    </div>

    <div className="flex gap-6 items-start">
      {/* Left selector panel */}
      <div className="w-[220px] shrink-0">
        <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
          {REPORT_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-4 py-2 text-2xs font-semibold text-neutral-400 uppercase tracking-widest bg-neutral-50 border-b border-neutral-100">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedReport(item.id)}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-base border-b border-neutral-100 transition-colors duration-fast',
                    selectedReport === item.id
                      ? 'bg-primary-50 border-l-[3px] border-primary-500 text-primary-700 pl-[13px] font-medium'
                      : 'text-neutral-600 hover:bg-neutral-50',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right report panel */}
      <div className="flex-1 space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-3">
          <Select
            value={filterStation}
            onChange={(e) => setFilterStation(e.target.value)}
            options={stations.map((s) => ({ value: s, label: s }))}
            placeholder="All stations"
            className="w-44"
          />
          <Input
            type="month"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="w-40"
          />
          <Button variant="primary" onClick={generateReport} loading={isLoading}>
            Generate report
          </Button>
          <Button variant="ghost" Icon={Download} onClick={exportCsv}>
            Export CSV
          </Button>
        </div>

        {/* Stats chips */}
        {reportData && (
          <div className="grid grid-cols-4 gap-3">
            {reportData.stats.map((s: { label: string; value: string }) => (
              <div key={s.label} className="bg-white border border-neutral-200 rounded-md px-4 py-3">
                <p className="text-2xs text-neutral-500 uppercase tracking-widest">{s.label}</p>
                <p className="text-xl font-semibold font-mono tabular text-neutral-900 mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Bar chart */}
        {reportData?.stationData && (
          <Card>
            <CardHeader title="Station breakdown" />
            <CardBody>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={reportData.stationData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="station" tick={{ fontSize: 11, fill: 'var(--text-secondary)', fontFamily: 'Nunito' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)', fontFamily: 'Nunito' }} />
                  <Tooltip
                    formatter={(v: number) => [fmtGHS(v), '']}
                    contentStyle={{ fontFamily: 'Nunito', fontSize: 12, border: '1px solid var(--border-default)', borderRadius: 6 }}
                  />
                  <Bar dataKey="amount" fill="var(--chart-1, #720026)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        )}

        {/* Station detail table */}
        {reportData?.stationRows && (
          <Card>
            <CardHeader title="Station detail" />
            <DataTable
              data={reportData.stationRows}
              columns={stationColumns}
              emptyHeading="No data for this period"
            />
          </Card>
        )}

        {!reportData && !isLoading && (
          <div className="flex items-center justify-center h-64 bg-white border border-neutral-200 rounded-md">
            <p className="text-base text-neutral-400">
              Select a report type and click Generate report.
            </p>
          </div>
        )}
      </div>
    </div>
  </div>
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/reports/reports-client.tsx
git commit -m "feat: retheme Reports with left selector panel, filter bar, charts, and DataTable"
```

---

### Task 11: Settings screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/settings/settings-client.tsx`

- [ ] **Step 1: Read current settings-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/settings/settings-client.tsx
```

Note: what settings sections exist, what form fields, any mutation calls.

- [ ] **Step 2: Retheme to left-nav + stacked-cards layout**

```tsx
'use client';

// Preserve all existing form state, mutations, and validation.
// Key structural change: left section nav + right stacked form cards.

const SECTIONS = [
  { id: 'loan-defaults',    label: 'Loan defaults' },
  { id: 'interest-fees',    label: 'Interest and fees' },
  { id: 'approval',         label: 'Approval workflow' },
  { id: 'documents',        label: 'Required documents' },
  { id: 'automation',       label: 'Automation' },
  { id: 'danger',           label: 'Danger zone' },
];

return (
  <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-semibold text-neutral-900">Settings</h1>
      <p className="text-base text-neutral-500 mt-0.5">Configure welfare scheme parameters</p>
    </div>

    <div className="flex gap-6 items-start">
      {/* Left nav */}
      <div className="w-[220px] shrink-0">
        <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                'w-full text-left px-4 py-2.5 text-base border-b border-neutral-100 transition-colors duration-fast',
                activeSection === s.id
                  ? 'bg-primary-50 border-l-[3px] border-primary-500 text-primary-700 pl-[13px] font-medium'
                  : 'text-neutral-600 hover:bg-neutral-50',
                s.id === 'danger' && 'text-danger-700 hover:bg-danger-50',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 space-y-4">
        {activeSection === 'loan-defaults' && (
          <Card>
            <CardHeader
              title="Loan defaults"
              subtitle="Default parameters applied to new loans."
              action={
                <Button variant="primary" size="sm" onClick={saveLoanDefaults} loading={savingDefaults}>
                  Save changes
                </Button>
              }
            />
            <CardBody>
              <div className="space-y-4 max-w-md">
                <Field label="Default interest rate (%)" helper="Applied to all new loans unless overridden.">
                  <Input
                    {...register('defaultInterestRate')}
                    type="number"
                    step="0.1"
                    suffix="%"
                    mono
                  />
                </Field>
                <Field label="Maximum tenure (months)">
                  <Input {...register('maxTenureMonths')} type="number" suffix="months" mono />
                </Field>
                <Field label="Maximum loan amount (₵)">
                  <Input {...register('maxLoanAmount')} type="number" prefix="₵" mono />
                </Field>
              </div>
            </CardBody>
          </Card>
        )}

        {activeSection === 'danger' && (
          <Card className="border-danger-200">
            <CardHeader title="Danger zone" subtitle="Destructive actions — proceed with caution." />
            <CardBody>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-neutral-100">
                  <div>
                    <p className="text-base font-medium text-neutral-900">Reset all loan parameters</p>
                    <p className="text-sm text-neutral-500">Restore default interest rates and limits.</p>
                  </div>
                  <Button
                    variant="danger"
                    destructive
                    size="sm"
                    onClick={() => setResetConfirmOpen(true)}
                  >
                    Reset parameters
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Add similar Card blocks for each section */}
      </div>
    </div>
  </div>
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/settings/settings-client.tsx
git commit -m "feat: retheme Settings with left section nav and stacked form cards"
```

---

### Task 12: Audit log screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/audit/audit-client.tsx`

- [ ] **Step 1: Read current audit-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/audit/audit-client.tsx
```

Note: query shape — what fields each audit entry has. Typically: `timestamp`, `actor`, `action`, `entityType`, `entityId`, `ipAddress`.

- [ ] **Step 2: Rewrite `audit-client.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { getAuditLog } from '@/lib/audit';
import { DataTable } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtDateTime } from '@/lib/format';

type AuditEntry = {
  _id: string;
  timestamp: string;
  actor: string;
  action: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string;
};

const col = createColumnHelper<AuditEntry>();

const columns = [
  col.accessor('timestamp', {
    header: 'Timestamp',
    cell: (info) => (
      <span className="font-mono tabular text-neutral-700">{fmtDateTime(info.getValue())}</span>
    ),
  }),
  col.accessor('actor', {
    header: 'Actor',
    cell: (info) => <span className="text-neutral-900">{info.getValue()}</span>,
  }),
  col.accessor('action', {
    header: 'Action',
    cell: (info) => <span className="text-neutral-700">{info.getValue()}</span>,
  }),
  col.accessor('entityType', { header: 'Entity type' }),
  col.accessor('entityId', {
    header: 'Entity ID',
    cell: (info) => (
      <span className="font-mono tabular text-sm text-neutral-500">{info.getValue() ?? '—'}</span>
    ),
  }),
  col.accessor('ipAddress', {
    header: 'IP address',
    cell: (info) => (
      <span className="font-mono tabular text-sm text-neutral-500">{info.getValue() ?? '—'}</span>
    ),
  }),
];

export function AuditLogClient() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', { dateFrom, dateTo, actor, action }],
    queryFn: () => getAuditLog({ dateFrom, dateTo, actor, action }),
    staleTime: 30_000,
  });

  const entries: AuditEntry[] = Array.isArray(data) ? data : (data as { entries: AuditEntry[] } | undefined)?.entries ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Audit log</h1>
        <p className="text-base text-neutral-500 mt-0.5">
          Record of all system actions and changes
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40"
          aria-label="From date"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40"
          aria-label="To date"
        />
        <Input
          placeholder="Filter by actor"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="w-44"
        />
        <Input
          placeholder="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="w-44"
        />
        {(dateFrom || dateTo || actor || action) && (
          <Button
            variant="ghost"
            onClick={() => { setDateFrom(''); setDateTo(''); setActor(''); setAction(''); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
        <DataTable
          data={entries}
          columns={columns}
          isLoading={isLoading}
          emptyHeading="No audit entries found"
          emptyBody="Audit entries will appear here as actions are performed."
          pageSize={25}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/audit/audit-client.tsx
git commit -m "feat: retheme Audit log with branded DataTable and date/actor/action filters"
```

---

### Task 13: Email log screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/email-log/email-log-client.tsx`

- [ ] **Step 1: Read current email-log-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/email-log/email-log-client.tsx
```

Note fields: `sentAt`, `recipient`, `subject`, `status`, delivery info.

- [ ] **Step 2: Rewrite `email-log-client.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { getEmailLog } from '@/lib/email';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtDateTime } from '@/lib/format';

type EmailEntry = {
  _id: string;
  sentAt: string;
  recipient: string;
  subject: string;
  status: string;
  deliveredAt?: string;
};

const col = createColumnHelper<EmailEntry>();

const columns = [
  col.accessor('sentAt', {
    header: 'Sent at',
    cell: (info) => (
      <span className="font-mono tabular text-neutral-700">{fmtDateTime(info.getValue())}</span>
    ),
  }),
  col.accessor('recipient', {
    header: 'Recipient',
    cell: (info) => <span className="text-neutral-900">{info.getValue()}</span>,
  }),
  col.accessor('subject', {
    header: 'Subject',
    cell: (info) => (
      <span className="text-neutral-700 truncate max-w-xs block">{info.getValue()}</span>
    ),
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  col.accessor('deliveredAt', {
    header: 'Delivered at',
    cell: (info) => fmtDateTime(info.getValue()),
  }),
];

export function EmailLogClient() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['email-log', { dateFrom, dateTo, status }],
    queryFn: () => getEmailLog({ dateFrom, dateTo, ...(status && { status }) }),
    staleTime: 30_000,
  });

  const entries: EmailEntry[] = Array.isArray(data) ? data : (data as { emails: EmailEntry[] } | undefined)?.emails ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Email log</h1>
        <p className="text-base text-neutral-500 mt-0.5">
          Record of all outbound email notifications
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40"
          aria-label="From date"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40"
          aria-label="To date"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={['Sent', 'Failed', 'Bounced'].map((s) => ({ value: s, label: s }))}
          placeholder="All statuses"
          className="w-40"
        />
        {(dateFrom || dateTo || status) && (
          <Button
            variant="ghost"
            onClick={() => { setDateFrom(''); setDateTo(''); setStatus(''); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
        <DataTable
          data={entries}
          columns={columns}
          isLoading={isLoading}
          emptyHeading="No email records found"
          emptyBody="Outbound emails will appear here once they are sent."
          pageSize={25}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/email-log/email-log-client.tsx
git commit -m "feat: retheme Email log with StatusBadge, DataTable, and date/status filters"
```

---

### Task 14: Manual contribution entry screen

**Files:**
- Rewrite: `apps/web/src/app/(dashboard)/contributions/manual/manual-entry-client.tsx`

- [ ] **Step 1: Read current manual-entry-client.tsx**

```bash
cat apps/web/src/app/\(dashboard\)/contributions/manual/manual-entry-client.tsx
```

Preserve: form schema, mutation, field names.

- [ ] **Step 2: Retheme with Field/Input components**

```tsx
'use client';

// Preserve all existing logic (useForm, zodResolver, mutation).
// Replace JSX with:

return (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold text-neutral-900">Manual contribution entry</h1>
      <p className="text-base text-neutral-500 mt-0.5">Record a single contribution payment</p>
    </div>

    <Card className="max-w-lg">
      <CardHeader title="Contribution details" />
      <CardBody>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Staff member" required error={errors.staffId?.message}>
            <Input
              {...register('staffId')}
              placeholder="Staff ID or name"
              error={!!errors.staffId}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Month" required error={errors.month?.message}>
              <Input {...register('month')} type="number" min={1} max={12} error={!!errors.month} />
            </Field>
            <Field label="Year" required error={errors.year?.message}>
              <Input {...register('year')} type="number" min={2000} error={!!errors.year} />
            </Field>
          </div>
          <Field label="Amount (₵)" required error={errors.amount?.message}>
            <Input
              {...register('amount')}
              type="number"
              step="0.01"
              prefix="₵"
              mono
              error={!!errors.amount}
            />
          </Field>
          <Field label="Notes">
            <Input {...register('notes')} placeholder="Optional notes" />
          </Field>
          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" loading={isPending}>
              Record contribution
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push('/contributions')}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  </div>
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/contributions/manual/manual-entry-client.tsx
git commit -m "feat: retheme Manual contribution entry with Field/Input/Button components"
```

---

### Task 15: Final visual verification

- [ ] **Step 1: Run dev server**

```bash
cd apps/web && npm run dev
```

- [ ] **Step 2: Navigate through all 10 screens and verify**

Verify each screen:

| Screen | URL | Check |
|--------|-----|-------|
| Dashboard | `/` | KPI cards: crimson icons, tabular numerals `₵`. Charts: crimson/amber bars. Cards: white bg, neutral-200 border. |
| Staff list | `/staff` | Filter bar. DataTable compact rows (36px). Avatar initials. StatusBadge with dot. Font mono on Staff ID. |
| Staff detail | `/staff/[id]` | Large avatar, profile card, loan history table. |
| Loans list | `/loans` | RepaymentBar in progress column. Loan number in mono. |
| Loan detail | `/loans/[id]` | RepaymentBar full-width. Payment form in Card. Write-off button is danger (no hover transition). |
| New loan | `/loans/new` | 2-col layout. Schedule preview on right updates on amount change. |
| Contributions import | `/contributions/import` | Dropzone dashed border changes to crimson on drag-over. |
| Reports | `/reports` | Left selector panel. Active item has 3px crimson left border. |
| Settings | `/settings` | Left nav. Stacked form cards. Danger zone card has danger-200 border. |
| Audit log | `/audit` | Timestamps in mono. Compact table. |
| Email log | `/email-log` | StatusBadge for Sent/Failed/Bounced. |

- [ ] **Step 3: Run typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

If no issues found, commit a final verification note:

```bash
cd ../..
git add -A
git commit -m "chore: final visual verification pass — all 10 screens rethemed"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered |
|---|---|
| 6.1 Dashboard | Task 1 |
| 6.2 Staff list | Task 2 |
| 6.3 Staff detail | Task 4 |
| 6.4 Loans list | Task 5 |
| 6.5 Loan detail | Task 6 |
| 6.6 New loan form | Task 7 |
| 6.7 Contributions import | Task 8 |
| 6.8 Reports | Task 10 |
| 6.9 Settings | Task 11 |
| 6.10 Audit log | Task 12 |
| 6.11 Email log | Task 13 |
| Copy rules (§7) | Enforced: sentence case headings, `fmtGHS` for all currency, `fmtDate`/`fmtDateTime` for all dates, no emoji, no exclamation marks |
| Non-goals (§8) | No mobile breakpoints added, no shadcn/ui, no API changes |

**Placeholder scan:** Task 3 (add-staff-modal) and Tasks 7, 10, 11 contain structural templates — they direct the implementer to preserve existing logic and replace only JSX. This is intentional pattern guidance, not a TBD. The key fields and patterns are shown explicitly.

**Type consistency:**
- `fmtGHS`, `fmtDate`, `fmtTime`, `fmtDateTime` — imported from `@/lib/format` consistently
- `DataTable<T>` used with correct generic per table
- `StatusBadge` receives `status: string` — consistent with `@welfare/shared` enum values
- `Card`, `CardHeader`, `CardBody` — same component API across all screens
- `Button` — `variant`, `Icon`, `loading` props used consistently
- `getAuditLog` / `getEmailLog` — called from `@/lib/audit` and `@/lib/email` respectively; these imports must exist (they're referenced in existing files per the original codebase scan)
