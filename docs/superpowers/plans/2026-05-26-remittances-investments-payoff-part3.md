# Remittances, Investments, Loan Pay-Off — Part 3: Reports API + All Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend getFundSummary with discount data, build all frontend pages (remittances list/manual/import, investments list/import, loan pay-off modal), add the Remittances report panel to Reports, and add discount KPIs + breakdown to Fund Summary.

**Architecture:** API lib functions follow the existing `apiClient.get/post` pattern. Pages are Next.js 14 server components wrapping `*-client.tsx` client components. The pay-off modal uses the preview-then-commit UX pattern identical to existing payment modals.

**Tech Stack:** Next.js 14 · React · @tanstack/react-query · react-hook-form · zod · lucide-react · sonner

**Prerequisite:** Parts 1 and 2 must be complete.

---

### Task 18: ReportsService getFundSummary Discount Additions + ReportsModule

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/src/reports/reports.module.ts`

- [ ] **Step 1: Register Discount model in ReportsModule**

In `apps/api/src/reports/reports.module.ts`:

Add imports:
```ts
import { Discount, DiscountSchema } from '../loans/schemas/discount.schema';
```

Add to `MongooseModule.forFeature([...])`:
```ts
{ name: Discount.name, schema: DiscountSchema },
```

Export `ReportsService` so other modules can use `generatePdf`/`generateCsv`:
```ts
exports: [ReportsService],
```

- [ ] **Step 2: Add Discount model injection to ReportsService**

In `apps/api/src/reports/reports.service.ts`:

Add imports:
```ts
import { Discount, DiscountDocument } from '../loans/schemas/discount.schema';
```

Add to constructor after `batchModel`:
```ts
@InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
```

- [ ] **Step 3: Add discount queries to getFundSummary**

In `apps/api/src/reports/reports.service.ts`, in `getFundSummary`, add two queries to the existing `Promise.all` array (after the `defaultRows` query):

```ts
      // 7. All-time total discounts given
      this.discountModel.aggregate([
        { $match: { cancelled: false } },
        { $group: { _id: null, total: { $sum: '$discountAmount' } } },
      ]).exec(),

      // 8. Period discount breakdown with staff name
      this.discountModel.aggregate([
        {
          $match: {
            cancelled: false,
            dateGranted: { $gte: periodStart, $lte: periodEnd },
          },
        },
        {
          $lookup: {
            from: 'staff',
            let: { sid: '$staffId' },
            pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } }],
            as: 'staffDoc',
          },
        },
        { $unwind: { path: '$staffDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
            loanReference: { $substr: ['$loanId', { $subtract: [{ $strLenCP: '$loanId' }, 6] }, 6] },
            discountType: 1,
            rate: '$discountRate',
            amount: '$discountAmount',
            dateGranted: 1,
          },
        },
        { $sort: { dateGranted: -1 } },
      ]).exec(),
```

- [ ] **Step 4: Destructure new values and include in return**

In `getFundSummary`, update the destructured result of `Promise.all` to include:
```ts
    const [
      contribRows,
      loanGroups,
      recoveryGroups,
      allTimeContribs,
      allTimeLoans,
      activeStaff,
      joiners,
      exits,
      defaultRows,
      allTimeDiscountsAgg,
      periodDiscounts,
    ] = await Promise.all([...]);
```

Add to the return value:
```ts
      totalDiscountsGiven: Math.round((allTimeDiscountsAgg[0]?.total ?? 0) * 100) / 100,
      discountBreakdown: periodDiscounts.map((d: any) => ({
        staffName: d.staffName,
        loanReference: String(d.loanReference).toUpperCase(),
        discountType: d.discountType,
        rate: d.rate,
        amount: d.amount,
        dateGranted: d.dateGranted instanceof Date ? d.dateGranted.toISOString() : d.dateGranted,
      })),
```

- [ ] **Step 5: Verify API build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.module.ts
git commit -m "feat(reports): add totalDiscountsGiven and discountBreakdown to getFundSummary"
```

---

### Task 19: Frontend API Lib Files

**Files:**
- Create: `apps/web/src/lib/remittances.ts`
- Create: `apps/web/src/lib/investments.ts`
- Modify: `apps/web/src/lib/loans.ts`

- [ ] **Step 1: Create lib/remittances.ts**

Create `apps/web/src/lib/remittances.ts`:
```ts
import { apiClient } from './api-client';
import type { IRemittanceReport } from '@welfare/shared';

export interface RemittanceRecord {
  _id: string;
  month: number;
  year: number;
  grossAmount: number;
  chargeRate: number;
  charges: number;
  netPayable: number;
  receiptDate: string;
  recordedBy: string;
  createdAt: string;
}

export interface RemittanceGrossPreview {
  grossAmount: number;
  charges: number;
  netPayable: number;
}

export interface PaginatedRemittances {
  data: RemittanceRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RemittanceReportParams {
  fromMonth?: number;
  fromYear?: number;
  toMonth?: number;
  toYear?: number;
}

export async function getRemittanceGrossPreview(month: number, year: number): Promise<RemittanceGrossPreview> {
  const { data } = await apiClient.get('/remittances/gross', { params: { month, year } });
  return data;
}

export async function listRemittances(page = 1, limit = 20): Promise<PaginatedRemittances> {
  const { data } = await apiClient.get('/remittances', { params: { page, limit } });
  return data;
}

export async function createRemittance(payload: { month: number; year: number; receiptDate: string }): Promise<RemittanceRecord> {
  const { data } = await apiClient.post('/remittances', payload);
  return data;
}

export async function importRemittances(file: File): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/remittances/import', form);
  return data;
}

export async function getRemittancesReport(params: RemittanceReportParams): Promise<IRemittanceReport> {
  const { data } = await apiClient.get('/remittances/report', { params });
  return data;
}

export function buildRemittancesReportDownloadUrl(params: RemittanceReportParams & { format: 'csv' | 'pdf' }): string {
  const base = apiClient.defaults.baseURL ?? '';
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
  ).toString();
  return `${base}/remittances/report?${q}`;
}
```

- [ ] **Step 2: Create lib/investments.ts**

Create `apps/web/src/lib/investments.ts`:
```ts
import { apiClient } from './api-client';
import type { IInvestmentRow } from '@welfare/shared';

export interface PaginatedInvestments {
  data: IInvestmentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateInvestmentPayload {
  purchaseDate: string;
  description: string;
  cost: number;
  maturityDate: string;
  faceValue: number;
  instruction: 'One-Time' | 'Roll-Over';
}

export interface UpdateInvestmentPayload extends Partial<CreateInvestmentPayload> {
  reason: string;
}

export async function listInvestments(page = 1, limit = 20): Promise<PaginatedInvestments> {
  const { data } = await apiClient.get('/investments', { params: { page, limit } });
  return data;
}

export async function createInvestment(payload: CreateInvestmentPayload): Promise<IInvestmentRow> {
  const { data } = await apiClient.post('/investments', payload);
  return data;
}

export async function updateInvestment(id: string, payload: UpdateInvestmentPayload): Promise<IInvestmentRow> {
  const { data } = await apiClient.patch(`/investments/${id}`, payload);
  return data;
}

export async function deleteInvestment(id: string, reason: string): Promise<void> {
  await apiClient.delete(`/investments/${id}`, { data: { reason } });
}

export async function importInvestments(file: File): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/investments/import', form);
  return data;
}
```

- [ ] **Step 3: Add pay-off functions to lib/loans.ts**

Append to `apps/web/src/lib/loans.ts`:
```ts
import type { IPayOffPreview } from '@welfare/shared';

export async function getPayOffPreview(loanId: string): Promise<IPayOffPreview> {
  const { data } = await apiClient.get(`/loans/${loanId}/payoff-preview`);
  return data;
}

export async function processPayOff(
  loanId: string,
  payload: { amountReceived: number; paymentDate: string },
): Promise<unknown> {
  const { data } = await apiClient.post(`/loans/${loanId}/payoff`, payload);
  return data;
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/remittances.ts apps/web/src/lib/investments.ts apps/web/src/lib/loans.ts
git commit -m "feat(web): add lib/remittances.ts, lib/investments.ts, and payoff helpers to lib/loans.ts"
```

---

### Task 20: Sidebar Nav Additions

**Files:**
- Modify: `apps/web/src/components/nav/sidebar.tsx`

- [ ] **Step 1: Add Remittances and Investments nav items**

In `apps/web/src/components/nav/sidebar.tsx`:

Add `Receipt` and `TrendingUp` to the lucide-react import:
```ts
import {
  LayoutDashboard,
  Users,
  UserCog,
  Landmark,
  FileBarChart2,
  Settings,
  ScrollText,
  Mail,
  Coins,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
```

In the `navItems` array, add after the Loans entry and before Reports:
```ts
  { href: '/remittances', label: 'Remittances', icon: Receipt,    matchPrefix: true, module: AppModule.Remittances },
  { href: '/investments', label: 'Investments', icon: TrendingUp, matchPrefix: true, module: AppModule.Investments },
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/nav/sidebar.tsx
git commit -m "feat(web): add Remittances and Investments nav items to sidebar"
```

---

### Task 21: Remittances List + Manual Entry Pages

**Files:**
- Create: `apps/web/src/app/(dashboard)/remittances/page.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/remittances-list-client.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/manual/page.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/manual/manual-entry-client.tsx`

- [ ] **Step 1: Create remittances list page**

Create `apps/web/src/app/(dashboard)/remittances/page.tsx`:
```tsx
import { RemittancesListClient } from './remittances-list-client';

export default function RemittancesPage() {
  return <RemittancesListClient />;
}
```

- [ ] **Step 2: Create RemittancesListClient**

Create `apps/web/src/app/(dashboard)/remittances/remittances-list-client.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import { fmtGHS, fmtDate } from '@/lib/format';
import { listRemittances } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
          <Button as={Link} href="/remittances/import" variant="secondary" Icon={Upload}>Bulk Import</Button>
          <Button as={Link} href="/remittances/manual" Icon={Plus}>Add Remittance</Button>
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
                    {['Period','Receipt Date','Gross Amount','Charges','Net Payable'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(data?.data ?? []).length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">No remittances recorded yet</td></tr>
                  ) : (
                    (data?.data ?? []).map(r => (
                      <tr key={r._id} className="hover:bg-neutral-50">
                        <td className="px-4 py-2.5 font-medium">{MONTHS[r.month - 1]} {r.year}</td>
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
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <span className="text-sm text-neutral-500">Page {page} of {data.totalPages}</span>
              <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create manual entry server page**

Create `apps/web/src/app/(dashboard)/remittances/manual/page.tsx`:
```tsx
import { ManualEntryClient } from './manual-entry-client';

export default function ManualRemittancePage() {
  return <ManualEntryClient />;
}
```

- [ ] **Step 4: Create ManualEntryClient**

Create `apps/web/src/app/(dashboard)/remittances/manual/manual-entry-client.tsx`:
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { createRemittance, getRemittanceGrossPreview } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const now = new Date();

const schema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2000),
  receiptDate: z.string().min(1, 'Required'),
});
type Form = z.infer<typeof schema>;

export function ManualEntryClient() {
  const router = useRouter();
  const [preview, setPreview] = useState<{ grossAmount: number; charges: number; netPayable: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear(), receiptDate: '' },
  });

  const { month, year } = form.watch();

  useEffect(() => {
    if (!month || !year || year < 2000) return;
    setLoadingPreview(true);
    getRemittanceGrossPreview(month, year)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setLoadingPreview(false));
  }, [month, year]);

  const mutation = useMutation({
    mutationFn: (values: Form) => createRemittance(values),
    onSuccess: () => {
      toast.success('Remittance recorded successfully');
      router.push('/remittances');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to record remittance');
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Record Remittance</h1>
      </div>

      <Card>
        <CardHeader title="Remittance Details" />
        <CardBody>
          <form onSubmit={form.handleSubmit(v => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Month" error={form.formState.errors.month?.message}>
                <Select {...form.register('month')} value={String(month)}>
                  {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Year" error={form.formState.errors.year?.message}>
                <Input type="number" {...form.register('year')} />
              </Field>
            </div>

            {loadingPreview && <p className="text-sm text-neutral-400">Computing gross amount…</p>}
            {preview && (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-neutral-500">Gross Amount</span><span className="font-medium">{fmtGHS(preview.grossAmount)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Charges ({((preview.charges / (preview.grossAmount || 1)) * 100).toFixed(0)}%)</span><span>{fmtGHS(preview.charges)}</span></div>
                <div className="flex justify-between border-t border-neutral-200 pt-1.5"><span className="font-semibold">Net Payable</span><span className="font-semibold text-primary-700">{fmtGHS(preview.netPayable)}</span></div>
              </div>
            )}

            <Field label="Receipt Date" error={form.formState.errors.receiptDate?.message}>
              <Input type="date" {...form.register('receiptDate')} />
            </Field>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={mutation.isPending || !preview}>
                {mutation.isPending ? 'Saving…' : 'Record Remittance'}
              </Button>
              <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/remittances/
git commit -m "feat(web): add Remittances list page and manual entry form"
```

---

### Task 22: Remittances Import Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/remittances/import/page.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/import/import-client.tsx`

- [ ] **Step 1: Create import server page**

Create `apps/web/src/app/(dashboard)/remittances/import/page.tsx`:
```tsx
import { RemittancesImportClient } from './import-client';

export default function RemittancesImportPage() {
  return <RemittancesImportClient />;
}
```

- [ ] **Step 2: Create RemittancesImportClient**

Create `apps/web/src/app/(dashboard)/remittances/import/import-client.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { importRemittances } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function RemittancesImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ batchId: string; imported: number; flagged: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: () => importRemittances(file!),
    onSuccess: (data) => {
      setResult(data);
      if (data.flagged === 0) toast.success(`${data.imported} remittances imported successfully`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Import failed');
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Bulk Import Remittances</h1>
      </div>

      <Card>
        <CardHeader title="XLSX Template" />
        <CardBody>
          <p className="text-sm text-neutral-500 mb-3">Required columns: <strong>Month</strong> (1–12), <strong>Year</strong>, <strong>Receipt Date</strong> (dd/mm/yyyy)</p>
          <p className="text-sm text-neutral-500">Gross amount, charges, and net payable are computed automatically from contribution records.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Upload File" />
        <CardBody className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          <div
            className="border-2 border-dashed border-neutral-200 rounded-md p-8 text-center cursor-pointer hover:border-primary-300 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={24} className="mx-auto text-neutral-400 mb-2" />
            <p className="text-sm text-neutral-500">{file ? file.name : 'Click to select an XLSX file'}</p>
          </div>

          {file && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} Icon={Upload}>
              {mutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}

          {result && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle size={16} className="text-success-600" />
                <span><strong>{result.imported}</strong> imported of {result.total} rows</span>
              </div>
              {result.flagged > 0 && (
                <div className="flex items-center gap-2 text-sm text-warning-700">
                  <AlertTriangle size={16} />
                  <span><strong>{result.flagged}</strong> rows flagged (duplicate period or validation errors)</span>
                </div>
              )}
              <Button variant="secondary" size="sm" onClick={() => router.push('/remittances')}>
                View Remittances
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/remittances/import/
git commit -m "feat(web): add Remittances bulk import page"
```

---

### Task 23: Investments List Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/investments/page.tsx`
- Create: `apps/web/src/app/(dashboard)/investments/investments-list-client.tsx`

- [ ] **Step 1: Create investments list server page**

Create `apps/web/src/app/(dashboard)/investments/page.tsx`:
```tsx
import { InvestmentsListClient } from './investments-list-client';

export default function InvestmentsPage() {
  return <InvestmentsListClient />;
}
```

- [ ] **Step 2: Create InvestmentsListClient**

Create `apps/web/src/app/(dashboard)/investments/investments-list-client.tsx`:
```tsx
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
import { listInvestments, createInvestment, updateInvestment, deleteInvestment } from '@/lib/investments';
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

function InvestmentStatusBadge({ status }: { status: 'Active' | 'Matured' }) {
  return (
    <span className={cn(
      'inline-flex px-2 py-0.5 rounded text-xs font-medium',
      status === 'Active' ? 'bg-info-50 text-info-700' : 'bg-neutral-100 text-neutral-500',
    )}>
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
    onSuccess: () => { toast.success('Investment recorded'); qc.invalidateQueries({ queryKey: ['investments'] }); setShowCreate(false); createForm.reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const editMut = useMutation({
    mutationFn: (v: InvestmentForm & { reason: string }) => updateInvestment(editTarget!.id, v),
    onSuccess: () => { toast.success('Investment updated'); qc.invalidateQueries({ queryKey: ['investments'] }); setEditTarget(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (v: ReasonForm) => deleteInvestment(deleteTarget!.id, v.reason),
    onSuccess: () => { toast.success('Investment deleted'); qc.invalidateQueries({ queryKey: ['investments'] }); setDeleteTarget(null); },
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

  const COLS = ['Purchase Date','Description','Cost','Face Value','Interest','Rate (%)','Maturity Date','Status','Instruction',''];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Investments</h1>
        <div className="flex gap-2">
          <Button as={Link} href="/investments/import" variant="secondary" Icon={Upload}>Bulk Import</Button>
          <Button onClick={() => setShowCreate(true)} Icon={Plus}>Add Investment</Button>
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
                    {COLS.map(h => <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(data?.data ?? []).length === 0 ? (
                    <tr><td colSpan={COLS.length} className="px-4 py-8 text-center text-neutral-400">No investments recorded yet</td></tr>
                  ) : (
                    (data?.data ?? []).map(inv => (
                      <tr key={inv.id} className="hover:bg-neutral-50">
                        <td className="px-3 py-2.5">{fmtDate(inv.purchaseDate)}</td>
                        <td className="px-3 py-2.5 max-w-[200px] truncate" title={inv.description}>{inv.description}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.cost)}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.faceValue)}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.interest)}</td>
                        <td className="px-3 py-2.5">{inv.rate.toFixed(2)}%</td>
                        <td className="px-3 py-2.5">{fmtDate(inv.maturityDate)}</td>
                        <td className="px-3 py-2.5"><InvestmentStatusBadge status={inv.status} /></td>
                        <td className="px-3 py-2.5">{inv.instruction}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            <button onClick={() => openEdit(inv)} className="p-1 text-neutral-400 hover:text-primary-600 rounded" title="Edit"><Pencil size={14} /></button>
                            <button onClick={() => { setDeleteTarget(inv); deleteForm.reset(); }} className="p-1 text-neutral-400 hover:text-danger-600 rounded" title="Delete"><Trash2 size={14} /></button>
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
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <span className="text-sm text-neutral-500">Page {page} of {data.totalPages}</span>
              <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Investment">
        <form onSubmit={createForm.handleSubmit(v => createMut.mutate(v))} className="space-y-4 p-4">
          <Field label="Purchase Date" error={createForm.formState.errors.purchaseDate?.message}><Input type="date" {...createForm.register('purchaseDate')} /></Field>
          <Field label="Description" error={createForm.formState.errors.description?.message}><Input {...createForm.register('description')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost (GHS)" error={createForm.formState.errors.cost?.message}><Input type="number" step="0.01" {...createForm.register('cost')} /></Field>
            <Field label="Face Value (GHS)" error={createForm.formState.errors.faceValue?.message}><Input type="number" step="0.01" {...createForm.register('faceValue')} /></Field>
          </div>
          <Field label="Maturity Date" error={createForm.formState.errors.maturityDate?.message}><Input type="date" {...createForm.register('maturityDate')} /></Field>
          <Field label="Instruction"><Select {...createForm.register('instruction')}><option value="One-Time">One-Time</option><option value="Roll-Over">Roll-Over</option></Select></Field>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Saving…' : 'Save'}</Button>
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      {editTarget && (
        <Modal open onClose={() => setEditTarget(null)} title="Edit Investment">
          <form onSubmit={editForm.handleSubmit(v => editMut.mutate(v))} className="space-y-4 p-4">
            <Field label="Purchase Date"><Input type="date" {...editForm.register('purchaseDate')} /></Field>
            <Field label="Description"><Input {...editForm.register('description')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost (GHS)"><Input type="number" step="0.01" {...editForm.register('cost')} /></Field>
              <Field label="Face Value (GHS)"><Input type="number" step="0.01" {...editForm.register('faceValue')} /></Field>
            </div>
            <Field label="Maturity Date"><Input type="date" {...editForm.register('maturityDate')} /></Field>
            <Field label="Instruction"><Select {...editForm.register('instruction')}><option value="One-Time">One-Time</option><option value="Roll-Over">Roll-Over</option></Select></Field>
            <Field label="Reason for edit (required)" error={editForm.formState.errors.reason?.message}><Input {...editForm.register('reason')} placeholder="Describe the change" /></Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={editMut.isPending}>{editMut.isPending ? 'Saving…' : 'Save Changes'}</Button>
              <Button variant="secondary" type="button" onClick={() => setEditTarget(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <Modal open onClose={() => setDeleteTarget(null)} title="Delete Investment">
          <form onSubmit={deleteForm.handleSubmit(v => deleteMut.mutate(v))} className="space-y-4 p-4">
            <p className="text-sm text-neutral-600">
              Delete <strong>{deleteTarget.description}</strong>? This action is irreversible in the UI; the record is archived for audit.
            </p>
            <Field label="Reason for deletion (required)" error={deleteForm.formState.errors.reason?.message}><Input {...deleteForm.register('reason')} placeholder="State reason" /></Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="danger" disabled={deleteMut.isPending}>{deleteMut.isPending ? 'Deleting…' : 'Delete'}</Button>
              <Button variant="secondary" type="button" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/investments/
git commit -m "feat(web): add Investments list page with create/edit/delete modals"
```

---

### Task 24: Investments Import Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/investments/import/page.tsx`
- Create: `apps/web/src/app/(dashboard)/investments/import/import-client.tsx`

- [ ] **Step 1: Create investments import server page**

Create `apps/web/src/app/(dashboard)/investments/import/page.tsx`:
```tsx
import { InvestmentsImportClient } from './import-client';

export default function InvestmentsImportPage() {
  return <InvestmentsImportClient />;
}
```

- [ ] **Step 2: Create InvestmentsImportClient**

Create `apps/web/src/app/(dashboard)/investments/import/import-client.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { importInvestments } from '@/lib/investments';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function InvestmentsImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ batchId: string; imported: number; flagged: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: () => importInvestments(file!),
    onSuccess: (data) => {
      setResult(data);
      if (data.flagged === 0) toast.success(`${data.imported} investments imported`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Import failed'),
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Bulk Import Investments</h1>
      </div>

      <Card>
        <CardHeader title="XLSX Template" />
        <CardBody>
          <p className="text-sm text-neutral-500">Required columns: <strong>Purchase Date</strong>, <strong>Description</strong>, <strong>Cost</strong>, <strong>Maturity Date</strong>, <strong>Face Value</strong>, <strong>Instruction</strong> (One-Time or Roll-Over)</p>
          <p className="text-sm text-neutral-400 mt-2">Interest and rate are computed automatically from Cost and Face Value.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Upload File" />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div
            className="border-2 border-dashed border-neutral-200 rounded-md p-8 text-center cursor-pointer hover:border-primary-300 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={24} className="mx-auto text-neutral-400 mb-2" />
            <p className="text-sm text-neutral-500">{file ? file.name : 'Click to select an XLSX file'}</p>
          </div>

          {file && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} Icon={Upload}>
              {mutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}

          {result && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm"><CheckCircle size={16} className="text-success-600" /><span><strong>{result.imported}</strong> imported of {result.total}</span></div>
              {result.flagged > 0 && (
                <div className="flex items-center gap-2 text-sm text-warning-700"><AlertTriangle size={16} /><span><strong>{result.flagged}</strong> rows flagged</span></div>
              )}
              <Button variant="secondary" size="sm" onClick={() => router.push('/investments')}>View Investments</Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/investments/import/
git commit -m "feat(web): add Investments bulk import page"
```

---

### Task 25: Loan Detail Pay-Off Modal

**Files:**
- Modify: `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

- [ ] **Step 1: Add pay-off state, query, and mutation to LoanDetailClient**

In `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`:

Add import:
```ts
import { getPayOffPreview, processPayOff } from '@/lib/loans';
import type { IPayOffPreview } from '@welfare/shared';
```

Add to existing imports from lucide-react: `Banknote`

Add state variables inside the component (near other `useState` declarations):
```ts
const [showPayOff, setShowPayOff] = useState(false);
const [payOffDate, setPayOffDate] = useState(today());
const [amountReceived, setAmountReceived] = useState('');
```

Add pay-off preview query (near other `useQuery` calls):
```ts
const { data: payOffPreview, isLoading: previewLoading } = useQuery({
  queryKey: ['payoff-preview', loanId],
  queryFn: () => getPayOffPreview(loanId),
  enabled: showPayOff,
});
```

Add when `payOffPreview` loads, pre-fill amountReceived:
```ts
useEffect(() => {
  if (payOffPreview) setAmountReceived(String(payOffPreview.netPayable));
}, [payOffPreview]);
```

Add pay-off mutation (near other `useMutation` declarations):
```ts
const payOffMut = useMutation({
  mutationFn: () =>
    processPayOff(loanId, { amountReceived: parseFloat(amountReceived), paymentDate: payOffDate }),
  onSuccess: () => {
    toast.success('Loan settled successfully');
    setShowPayOff(false);
    queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
    queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
  },
  onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Pay-off failed'),
});
```

- [ ] **Step 2: Add "Settle Loan" button and modal JSX**

In the JSX, locate where the existing action buttons are rendered (near `CreditCard` / record payment button). Add a "Settle Loan" button visible only when `loan.status === LoanStatus.Active` and `permission === 'full'`:

```tsx
{loan.status === LoanStatus.Active && permission === 'full' && (
  <Button onClick={() => setShowPayOff(true)} Icon={Banknote} variant="secondary">
    Settle Loan
  </Button>
)}
```

Add the pay-off modal (near other modals, before the closing `</div>`):
```tsx
{showPayOff && (
  <Modal open onClose={() => setShowPayOff(false)} title="Settle Loan (Early Pay-Off)">
    <div className="p-4 space-y-4">
      {previewLoading && <p className="text-sm text-neutral-400">Computing pay-off amount…</p>}
      {payOffPreview && (
        <>
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-neutral-500">Remaining Principal</span><span>{fmtGHS(payOffPreview.remainingPrincipal)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Remaining Interest</span><span>{fmtGHS(payOffPreview.remainingInterest)}</span></div>
            {payOffPreview.discountApplied && (
              <div className="flex justify-between text-success-700">
                <span>Pay-Off Discount ({payOffPreview.discountRate}%)</span>
                <span>−{fmtGHS(payOffPreview.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-neutral-200 pt-2">
              <span>Net Payable</span>
              <span className="text-primary-700">{fmtGHS(payOffPreview.netPayable)}</span>
            </div>
            {!payOffPreview.discountApplied && payOffPreview.tier === 2 && (
              <p className="text-xs text-neutral-400 pt-1">No pay-off discount — loan is past the 6-month early settlement window.</p>
            )}
            {payOffPreview.tier === 1 && (
              <p className="text-xs text-neutral-400 pt-1">Tier 1 loan — origination discount already applied at disbursement.</p>
            )}
          </div>
          <Field label="Amount Received (GHS)">
            <Input type="number" step="0.01" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} />
          </Field>
          <Field label="Payment Date">
            <Input type="date" value={payOffDate} onChange={e => setPayOffDate(e.target.value)} max={today()} />
          </Field>
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => payOffMut.mutate()}
              disabled={payOffMut.isPending || !amountReceived || !payOffDate}
            >
              {payOffMut.isPending ? 'Processing…' : 'Confirm Settlement'}
            </Button>
            <Button variant="secondary" onClick={() => setShowPayOff(false)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  </Modal>
)}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/loans/
git commit -m "feat(web): add Settle Loan pay-off modal to loan detail page"
```

---

### Task 26: Remittances Report Panel in Reports

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

- [ ] **Step 1: Add RemittancesReportPanel component and section**

In `apps/web/src/app/(dashboard)/reports/reports-client.tsx`:

Add import:
```ts
import { getRemittancesReport, buildRemittancesReportDownloadUrl } from '@/lib/remittances';
import type { IRemittanceReport, IRemittanceReportRow } from '@welfare/shared';
```

Add `RemittancesReportPanel` component (near other panel components, before `SECTIONS`):
```tsx
function RemittancesReportPanel() {
  const now = new Date();
  const [fromMonth, setFromMonth] = useState(1);
  const [fromYear, setFromYear]   = useState(now.getFullYear());
  const [toMonth, setToMonth]     = useState(now.getMonth() + 1);
  const [toYear, setToYear]       = useState(now.getFullYear());
  const [params, setParams]       = useState<{ fromMonth: number; fromYear: number; toMonth: number; toYear: number } | null>(null);
  const [rangeError, setRangeError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['remittances-report', params],
    queryFn: () => getRemittancesReport(params!),
    enabled: params !== null,
  });

  const colRem = createColumnHelper<IRemittanceReportRow>();
  const COLS = [
    colRem.accessor('period', { header: 'Period' }),
    colRem.accessor('receiptDate', { header: 'Receipt Date' }),
    colRem.accessor('grossAmount', { header: 'Gross Amt (GHS)', cell: i => fmtGHS(i.getValue()) }),
    colRem.accessor('charges', { header: 'Charges (GHS)', cell: i => fmtGHS(i.getValue()) }),
    colRem.accessor('netPayable', { header: 'Net Payable (GHS)', cell: i => fmtGHS(i.getValue()) }),
  ];

  const table = useReactTable({ data: data?.rows ?? [], columns: COLS, getCoreRowModel: getCoreRowModel() });

  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

  const handleRun = () => {
    if (toYear < fromYear || (toYear === fromYear && toMonth < fromMonth)) {
      setRangeError('To period must not be before From period');
      return;
    }
    setRangeError('');
    setParams({ fromMonth, fromYear, toMonth, toYear });
  };

  const downloadUrl = (format: 'csv' | 'pdf') =>
    params ? buildRemittancesReportDownloadUrl({ ...params, format }) : '#';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 p-4 bg-neutral-50 border border-neutral-200 rounded-md">
        <Field label="From Month">
          <Select value={String(fromMonth)} onChange={e => setFromMonth(+e.target.value)}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="From Year">
          <Input type="number" value={fromYear} onChange={e => setFromYear(+e.target.value)} style={{ width: 90 }} />
        </Field>
        <Field label="To Month">
          <Select value={String(toMonth)} onChange={e => setToMonth(+e.target.value)}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="To Year">
          <Input type="number" value={toYear} onChange={e => setToYear(+e.target.value)} style={{ width: 90 }} />
        </Field>
        <Button onClick={handleRun} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Run Report'}
        </Button>
      </div>
      {rangeError && <p className="text-sm text-danger-600">{rangeError}</p>}

      {data && (
        <>
          <div className="flex gap-2">
            <a href={downloadUrl('csv')} download>
              <Button variant="secondary" size="sm" Icon={Download}>CSV</Button>
            </a>
            <a href={downloadUrl('pdf')} download>
              <Button variant="secondary" size="sm" Icon={Download}>PDF</Button>
            </a>
          </div>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Gross</p><p className="font-semibold">{fmtGHS(data.totalGross)}</p></div>
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Charges</p><p className="font-semibold">{fmtGHS(data.totalCharges)}</p></div>
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Net Payable</p><p className="font-semibold text-primary-700">{fmtGHS(data.totalNet)}</p></div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                {table.getHeaderGroups().map(hg => (
                  <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
                    {hg.headers.map(h => (
                      <th key={h.id} className="px-3 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {table.getRowModel().rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">No remittance records in this period</td></tr>
                ) : (
                  table.getRowModel().rows.map(row => (
                    <tr key={row.id} className="hover:bg-neutral-50">
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-3 py-2.5 text-neutral-700 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !isLoading && params === null && (
        <p className="text-sm text-neutral-400 text-center py-8">Select a period and click Run Report.</p>
      )}
    </div>
  );
}
```

Add to `SECTIONS` array (after `exit-clearance`):
```ts
  { id: 'remittances', label: 'Remittances' },
```

Add to the panel switch block (after `exit-clearance` panel):
```tsx
{active === 'remittances' && <RemittancesReportPanel />}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/reports/reports-client.tsx
git commit -m "feat(web): add Remittances report panel to Reports with filter-first + CSV/PDF download"
```

---

### Task 27: Fund Summary Discount KPI + Breakdown Table

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx`

- [ ] **Step 1: Add IFundSummaryDiscountRow import**

In `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx`, add to imports from `@welfare/shared`:
```ts
import type {
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
  IFundSummaryDefaultRow,
  IFundSummaryDiscountRow,
} from '@welfare/shared';
```

- [ ] **Step 2: Add discount column definitions**

After the existing `COLS_DEFAULTS` definition, add:
```ts
const colDiscount = createColumnHelper<IFundSummaryDiscountRow>();
const COLS_DISCOUNTS = [
  colDiscount.accessor('staffName',     { header: 'Staff Name' }),
  colDiscount.accessor('loanReference', { header: 'Loan Ref' }),
  colDiscount.accessor('discountType',  { header: 'Type' }),
  colDiscount.accessor('rate',          { header: 'Rate (%)', cell: i => `${i.getValue()}%` }),
  colDiscount.accessor('amount',        { header: 'Amount (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colDiscount.accessor('dateGranted',   { header: 'Date Granted', cell: i => i.getValue() ? new Date(i.getValue()).toLocaleDateString('en-GB') : '—' }),
];
```

- [ ] **Step 3: Add Total Discounts Given KPI to all-time block**

In `FundSummaryPanel`, in the "All-Time Fund Overview" grid, add a 5th KpiCard after Active Members:
```tsx
<KpiCard
  label="Total Discounts Given"
  value={fmtGHSShort(data.totalDiscountsGiven ?? 0)}
  title={fmtGHS(data.totalDiscountsGiven ?? 0)}
  icon={AlertCircle}
  iconKind="warning"
/>
```

Also change the grid from `grid-cols-2 md:grid-cols-4` to `grid-cols-2 md:grid-cols-5` to accommodate 5 KPIs.

- [ ] **Step 4: Add Discount Breakdown section to period summary**

Locate where the `defaultDetails` Section is rendered (near the bottom of period data). After it, add:
```tsx
{data.discountBreakdown.length > 0 && (
  <Section title="Discount Breakdown">
    <SummaryTable columns={COLS_DISCOUNTS} data={data.discountBreakdown} />
  </Section>
)}
```

- [ ] **Step 5: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx
git commit -m "feat(web): add Total Discounts KPI and discount breakdown table to Fund Summary"
```
