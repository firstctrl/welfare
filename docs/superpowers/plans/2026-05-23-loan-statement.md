# Loan Statement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Loan Statement panel to the Reports page — select a borrower, select one of their loans, view KPI summary + instalment table, download PDF or send by email.

**Architecture:** Mirror the existing Contribution Statement pattern end-to-end: shared types in `@welfare/shared`, service methods in `ReportsService`, 4 new routes in `ReportsController`, React Email template for email delivery, inline Puppeteer HTML for PDF, and a `LoanStatementPanel` component in `reports-client.tsx`.

**Tech Stack:** NestJS (MongoDB/Mongoose, Puppeteer), React Email, Next.js App Router, TanStack Query, Tailwind CSS, Sonner toasts.

---

## File Map

| Action | File |
|--------|------|
| Modify | `packages/shared/src/interfaces/report.interface.ts` |
| Modify | `packages/shared/src/index.ts` |
| Modify | `apps/api/src/reports/reports.service.ts` |
| Modify | `apps/api/src/reports/reports.service.spec.ts` |
| Modify | `apps/api/src/reports/reports.controller.ts` |
| Create | `apps/api/src/email/templates/loan-statement-email.template.tsx` |
| Modify | `apps/web/src/lib/reports.ts` |
| Modify | `apps/web/src/app/(dashboard)/reports/reports-client.tsx` |

---

## Task 1: Add shared types

**Files:**
- Modify: `packages/shared/src/interfaces/report.interface.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add `ILoanBorrower` and `ILoanStatement` interfaces to `report.interface.ts`**

Append to the end of `packages/shared/src/interfaces/report.interface.ts`:

```ts
export interface ILoanBorrower {
  staffId: string;
  staffNo: string;
  displayName: string;
}

export interface ILoanStatementInstalment {
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  principalAmount: number;
  interestAmount: number;
  paidAmount: number;
  penaltyAmount: number;
  paidDate?: string;
  status: LoanRepaymentStatus;
  source?: string;
}

export interface ILoanStatement {
  staff: {
    staffNo: string;
    displayName: string;
    department: string;
  };
  loan: {
    id: string;
    principalAmount: number;
    interestRate: number;
    totalRepayable: number;
    tenureMonths: number;
    disbursedDate: string;
    status: LoanStatus;
    chequeNo?: string;
    pvNo?: string;
    guarantor: {
      staffNo: string;
      displayName: string;
    };
  };
  kpis: {
    totalPaid: number;
    outstanding: number;
    penaltyPaid: number;
    completionRate: number;
  };
  instalments: ILoanStatementInstalment[];
}
```

- [ ] **Step 2: Export new types from `packages/shared/src/index.ts`**

Find the existing report interface export block (lines 33–45) and add the two new types:

```ts
export type {
  IMonthlyContributionRow,
  IMonthlyContributionReport,
  IArrearRow,
  IGuarantorOffsetRow,
  IActiveLoanRow,
  IOverdueLoanRow,
  IRepaidLoanRow,
  IGuarantorExposureRow,
  IBadDebtRow,
  IExitClearanceRow,
  IDashboardStats,
  ILoanBorrower,
  ILoanStatement,
  ILoanStatementInstalment,
} from './interfaces/report.interface';
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/interfaces/report.interface.ts packages/shared/src/index.ts
git commit -m "feat(shared): add ILoanBorrower and ILoanStatement types"
```

---

## Task 2: `getLoanBorrowers()` service method + tests

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/src/reports/reports.service.spec.ts`

- [ ] **Step 1: Write failing test**

Add to `apps/api/src/reports/reports.service.spec.ts` inside the `describe('ReportsService', ...)` block. The existing mock setup uses `mockLoanModel = { find: mockLoanFind, aggregate: mockLoanAggregate }` and `mockStaffModel = { find: mockStaffFind }`. You need to add `distinct` to the loan mock.

At the top of the file, update the loan mock definition:
```ts
const mockLoanDistinct = jest.fn();
const mockLoanModel = { find: mockLoanFind, aggregate: mockLoanAggregate, distinct: mockLoanDistinct };
```

Then add the test:
```ts
describe('getLoanBorrowers', () => {
  it('returns borrowers sorted by displayName', async () => {
    mockLoanDistinct.mockResolvedValue(['staff2', 'staff1']);
    mockStaffFind.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { _id: { toString: () => 'staff1' }, fullName: 'Alice', staffId: 'GL001' },
            { _id: { toString: () => 'staff2' }, fullName: 'Bob', staffId: 'GL002' },
          ]),
        }),
      }),
    });

    const result = await service.getLoanBorrowers();

    expect(result).toEqual([
      { staffId: 'staff1', staffNo: 'GL001', displayName: 'Alice' },
      { staffId: 'staff2', staffNo: 'GL002', displayName: 'Bob' },
    ]);
  });

  it('returns empty array when no loans exist', async () => {
    mockLoanDistinct.mockResolvedValue([]);
    const result = await service.getLoanBorrowers();
    expect(result).toEqual([]);
    expect(mockStaffFind).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && npx jest reports.service.spec.ts --testNamePattern="getLoanBorrowers" --no-coverage
```

Expected: FAIL — `service.getLoanBorrowers is not a function`

- [ ] **Step 3: Implement `getLoanBorrowers()` in `reports.service.ts`**

Add after the `getBadDebt()` method, before the `// ─── STAFF ───` section:

```ts
async getLoanBorrowers(): Promise<ILoanBorrower[]> {
  const staffIds = await this.loanModel.distinct('staffId');
  if (staffIds.length === 0) return [];

  const staffDocs = await this.staffModel
    .find({ _id: { $in: staffIds } })
    .select('_id fullName staffId')
    .lean()
    .exec();

  return (staffDocs as Array<{ _id: { toString(): string }; fullName: string; staffId: string }>)
    .map(s => ({ staffId: s._id.toString(), staffNo: s.staffId, displayName: s.fullName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
```

Also add `ILoanBorrower` to the import from `@welfare/shared` at the top of `reports.service.ts`.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && npx jest reports.service.spec.ts --testNamePattern="getLoanBorrowers" --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(reports): add getLoanBorrowers service method"
```

---

## Task 3: `getLoanStatement()` service method + tests

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/src/reports/reports.service.spec.ts`

- [ ] **Step 1: Add `findById` and `findOne` to the mock loan model**

In `reports.service.spec.ts`, update the loan mock (near the top):

```ts
const mockLoanFindById = jest.fn();
const mockLoanModel = {
  find: mockLoanFind,
  aggregate: mockLoanAggregate,
  distinct: mockLoanDistinct,
  findById: mockLoanFindById,
};
```

Also add `mockStaffFindById` to the staff mock:

```ts
const mockStaffFindById = jest.fn();
const mockStaffModel = { find: mockStaffFind, findById: mockStaffFindById };
```

- [ ] **Step 2: Write failing tests for `getLoanStatement()`**

Add inside `describe('ReportsService', ...)`:

```ts
describe('getLoanStatement', () => {
  const staffId = 'staff1';
  const loanId = 'loan1';

  const fakeLoan = {
    _id: { toString: () => loanId },
    staffId,
    guarantorId: 'guar1',
    principalAmount: 1000,
    interestRate: 5,
    totalRepayable: 1050,
    tenureMonths: 3,
    disbursedDate: new Date('2025-01-01'),
    status: 'Active',
    chequeNo: 'CHQ001',
    pvNo: 'PV001',
  };

  const fakeInstalments = [
    {
      instalmentNumber: 1,
      dueDate: new Date('2025-02-05'),
      dueAmount: 350,
      principalAmount: 333.33,
      interestAmount: 16.67,
      paidAmount: 350,
      penaltyAmount: 0,
      paidDate: new Date('2025-02-03'),
      status: 'Paid',
      source: 'DirectPayment',
    },
    {
      instalmentNumber: 2,
      dueDate: new Date('2025-03-05'),
      dueAmount: 350,
      principalAmount: 333.33,
      interestAmount: 16.67,
      paidAmount: 0,
      penaltyAmount: 0,
      status: 'Pending',
    },
    {
      instalmentNumber: 3,
      dueDate: new Date('2025-04-05'),
      dueAmount: 350,
      principalAmount: 333.34,
      interestAmount: 16.66,
      paidAmount: 0,
      penaltyAmount: 0,
      status: 'Pending',
    },
  ];

  beforeEach(() => {
    mockLoanFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(fakeLoan) });
    mockStaffFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ fullName: 'Alice', staffId: 'GL001', department: 'IT' }) });
    mockStaffFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: { toString: () => 'guar1' }, fullName: 'Bob', staffId: 'GL002' }]) });
    mockRepaymentFind.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(fakeInstalments) }) });
  });

  it('returns shaped statement with correct KPIs', async () => {
    const result = await service.getLoanStatement(staffId, loanId);

    expect(result.staff).toEqual({ staffNo: 'GL001', displayName: 'Alice', department: 'IT' });
    expect(result.loan.id).toBe(loanId);
    expect(result.loan.guarantor).toEqual({ staffNo: 'GL002', displayName: 'Bob' });
    expect(result.kpis.totalPaid).toBe(350);
    expect(result.kpis.outstanding).toBe(700);
    expect(result.kpis.penaltyPaid).toBe(0);
    expect(result.kpis.completionRate).toBe(33);
    expect(result.instalments).toHaveLength(3);
    expect(result.instalments[0].status).toBe('Paid');
  });

  it('throws BadRequestException when loan does not belong to staff', async () => {
    mockLoanFindById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...fakeLoan, staffId: 'other-staff' }),
    });

    await expect(service.getLoanStatement(staffId, loanId)).rejects.toThrow('Loan does not belong to this staff member');
  });

  it('throws NotFoundException when loan not found', async () => {
    mockLoanFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    await expect(service.getLoanStatement(staffId, loanId)).rejects.toThrow('Loan not found');
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd apps/api && npx jest reports.service.spec.ts --testNamePattern="getLoanStatement" --no-coverage
```

Expected: FAIL — `service.getLoanStatement is not a function`

- [ ] **Step 4: Implement `getLoanStatement()` in `reports.service.ts`**

Add to imports at top of file:
```ts
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
```
(Replace existing `Injectable, Logger` import — add `BadRequestException` and `NotFoundException`.)

Add the method after `getLoanBorrowers()`:

```ts
async getLoanStatement(staffId: string, loanId: string): Promise<ILoanStatement> {
  const loan = await this.loanModel.findById(loanId).exec();
  if (!loan) throw new NotFoundException('Loan not found');
  if (loan.staffId !== staffId) throw new BadRequestException('Loan does not belong to this staff member');

  const [staffDoc, guarantorDoc] = await Promise.all([
    this.staffModel.findById(staffId).exec(),
    this.staffModel.find({ _id: { $in: [loan.guarantorId] } }).exec(),
  ]);

  const guarantor = guarantorDoc[0];
  const repayments = await this.repaymentModel
    .find({ loanId })
    .sort({ instalmentNumber: 1 })
    .exec();

  const totalPaid = repayments.reduce((s, r) => s + r.paidAmount, 0);
  const outstanding = Math.max(0, Math.round((loan.totalRepayable - totalPaid) * 100) / 100);
  const penaltyPaid = repayments.reduce((s, r) => s + r.penaltyAmount, 0);
  const paidCount = repayments.filter(
    r => r.status === LoanRepaymentStatus.Paid || r.status === LoanRepaymentStatus.Waived,
  ).length;
  const completionRate = loan.tenureMonths > 0
    ? Math.round((paidCount / loan.tenureMonths) * 100)
    : 0;

  return {
    staff: {
      staffNo: staffDoc?.staffId ?? '',
      displayName: staffDoc?.fullName ?? 'Unknown',
      department: (staffDoc as any)?.department ?? '',
    },
    loan: {
      id: loan._id.toString(),
      principalAmount: loan.principalAmount,
      interestRate: loan.interestRate,
      totalRepayable: loan.totalRepayable,
      tenureMonths: loan.tenureMonths,
      disbursedDate: loan.disbursedDate.toISOString(),
      status: loan.status,
      chequeNo: loan.chequeNo,
      pvNo: loan.pvNo,
      guarantor: {
        staffNo: guarantor?.staffId ?? '',
        displayName: guarantor?.fullName ?? 'Unknown',
      },
    },
    kpis: {
      totalPaid: Math.round(totalPaid * 100) / 100,
      outstanding,
      penaltyPaid: Math.round(penaltyPaid * 100) / 100,
      completionRate,
    },
    instalments: repayments.map(r => ({
      instalmentNumber: r.instalmentNumber,
      dueDate: r.dueDate.toISOString(),
      dueAmount: r.dueAmount,
      principalAmount: r.principalAmount ?? 0,
      interestAmount: r.interestAmount ?? 0,
      paidAmount: r.paidAmount,
      penaltyAmount: r.penaltyAmount,
      paidDate: r.paidDate?.toISOString(),
      status: r.status,
      source: r.source,
    })),
  };
}
```

Also add `ILoanStatement` to the import from `@welfare/shared` at the top of `reports.service.ts`.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd apps/api && npx jest reports.service.spec.ts --testNamePattern="getLoanStatement" --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(reports): add getLoanStatement service method"
```

---

## Task 4: `generateLoanStatementPdf()` service method

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts`

- [ ] **Step 1: Implement `generateLoanStatementPdf()` in `reports.service.ts`**

Add after `getLoanStatement()`:

```ts
async generateLoanStatementPdf(staffId: string, loanId: string): Promise<Buffer> {
  const stmt = await this.getLoanStatement(staffId, loanId);
  const fmt = (n: number) =>
    `GHS ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const logoPath = path.join(__dirname, 'assets', 'ncc-logo.png');
  const logoBase64 = fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : '';

  const statusBg: Record<string, string> = {
    Paid: '#dcfce7',
    Partial: '#fef9c3',
    Overdue: '#fee2e2',
    Pending: '#f1f5f9',
    Waived: '#f1f5f9',
  };

  const instalmentRows = stmt.instalments
    .map(
      (r, i) => `
      <tr>
        <td>${r.instalmentNumber}</td>
        <td>${new Date(r.dueDate).toLocaleDateString('en-GB')}</td>
        <td style="text-align:right">${fmt(r.dueAmount)}</td>
        <td style="text-align:right">${fmt(r.principalAmount)}</td>
        <td style="text-align:right">${fmt(r.interestAmount)}</td>
        <td style="text-align:right">${fmt(r.paidAmount)}</td>
        <td style="text-align:right">${r.penaltyAmount > 0 ? fmt(r.penaltyAmount) : '—'}</td>
        <td>${r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-GB') : '—'}</td>
        <td style="background:${statusBg[r.status] ?? '#fff'};font-weight:bold;font-size:10px">${r.status}</td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:20px;color:#111}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;border-bottom:2px solid #bc4680;padding-bottom:10px}
  .org{font-size:18px;font-weight:bold;color:#bc4680}
  .title{font-size:13px;font-weight:bold;margin-top:4px}
  .meta{color:#666;font-size:10px;margin-top:2px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;font-size:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px}
  .info-row{display:flex;gap:6px}
  .info-label{color:#64748b;min-width:90px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
  .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px}
  .kpi-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .kpi-value{font-size:14px;font-weight:bold;color:#1e293b;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#bc4680;color:#fff;padding:5px 6px;text-align:left;white-space:nowrap;font-size:10px}
  th:not(:first-child){text-align:right}
  th:last-child, th:nth-child(8){text-align:left}
  td{padding:4px 6px;border:1px solid #e5e7eb;white-space:nowrap}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;background-image:url('${logoBase64}');background-size:contain;background-repeat:no-repeat;background-position:center;opacity:0.05;z-index:0;pointer-events:none}
</style>
</head>
<body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<div class="header">
  <div>
    <div class="org">NACOC Welfare</div>
    <div class="title">Loan Statement — ${stmt.staff.displayName}</div>
    <div class="meta">Staff No: ${stmt.staff.staffNo} &nbsp;|&nbsp; Dept: ${stmt.staff.department} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString('en-GB')}</div>
  </div>
</div>
<div class="info-grid">
  <div class="info-row"><span class="info-label">Principal:</span><span>${fmt(stmt.loan.principalAmount)}</span></div>
  <div class="info-row"><span class="info-label">Total Repayable:</span><span>${fmt(stmt.loan.totalRepayable)}</span></div>
  <div class="info-row"><span class="info-label">Interest Rate:</span><span>${stmt.loan.interestRate}%</span></div>
  <div class="info-row"><span class="info-label">Tenure:</span><span>${stmt.loan.tenureMonths} months</span></div>
  <div class="info-row"><span class="info-label">Disbursed:</span><span>${new Date(stmt.loan.disbursedDate).toLocaleDateString('en-GB')}</span></div>
  <div class="info-row"><span class="info-label">Status:</span><span style="font-weight:bold">${stmt.loan.status}</span></div>
  <div class="info-row"><span class="info-label">Guarantor:</span><span>${stmt.loan.guarantor.displayName} (${stmt.loan.guarantor.staffNo})</span></div>
  <div class="info-row"><span class="info-label">Cheque / PV:</span><span>${stmt.loan.chequeNo ?? '—'} / ${stmt.loan.pvNo ?? '—'}</span></div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kpi-label">Amount Paid</div><div class="kpi-value">${fmt(stmt.kpis.totalPaid)}</div></div>
  <div class="kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">${fmt(stmt.kpis.outstanding)}</div></div>
  <div class="kpi"><div class="kpi-label">Penalty Paid</div><div class="kpi-value">${fmt(stmt.kpis.penaltyPaid)}</div></div>
  <div class="kpi"><div class="kpi-label">Completion</div><div class="kpi-value">${stmt.kpis.completionRate}%</div></div>
</div>
<table>
  <thead>
    <tr>
      <th>#</th><th>Due Date</th><th>Due (GHS)</th><th>Principal</th><th>Interest</th>
      <th>Paid (GHS)</th><th>Penalty</th><th>Paid Date</th><th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${instalmentRows || '<tr><td colspan="9" style="text-align:center;padding:20px;color:#999">No instalment records found</td></tr>'}
  </tbody>
</table>
</body></html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const confidentialBand = `
      <div style="width:100%;font-size:8px;font-family:Arial,sans-serif;color:#b91c1c;
                  text-align:center;font-weight:bold;letter-spacing:4px;padding:3px 0;">
        CONFIDENTIAL
      </div>`;
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: confidentialBand,
      footerTemplate: confidentialBand,
      margin: { top: '16mm', right: '10mm', bottom: '16mm', left: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Run all reports service tests — expect no regressions**

```bash
cd apps/api && npx jest reports.service.spec.ts --no-coverage
```

Expected: all existing tests still PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/reports/reports.service.ts
git commit -m "feat(reports): add generateLoanStatementPdf service method"
```

---

## Task 5: Email template

**Files:**
- Create: `apps/api/src/email/templates/loan-statement-email.template.tsx`

- [ ] **Step 1: Create the React Email template**

Create `apps/api/src/email/templates/loan-statement-email.template.tsx`:

```tsx
import * as React from 'react';
import { render } from '@react-email/render';
import { LoanRepaymentStatus } from '@welfare/shared';

interface LoanStatementEmailInstalment {
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  penaltyAmount: number;
  paidDate?: string;
  status: LoanRepaymentStatus;
}

interface LoanStatementEmailProps {
  staffName: string;
  staffNo: string;
  organisationName: string;
  loan: {
    principalAmount: number;
    totalRepayable: number;
    interestRate: number;
    tenureMonths: number;
    disbursedDate: string;
    status: string;
    guarantorName: string;
  };
  kpis: {
    totalPaid: number;
    outstanding: number;
    penaltyPaid: number;
    completionRate: number;
  };
  instalments: LoanStatementEmailInstalment[];
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function statusColor(s: LoanRepaymentStatus): string {
  if (s === LoanRepaymentStatus.Paid) return '#16a34a';
  if (s === LoanRepaymentStatus.Partial) return '#d97706';
  if (s === LoanRepaymentStatus.Overdue) return '#dc2626';
  if (s === LoanRepaymentStatus.Waived) return '#6b7280';
  return '#374151';
}

export function LoanStatementEmail(props: LoanStatementEmailProps) {
  const { staffName, staffNo, organisationName, loan, kpis, instalments } = props;

  return (
    <html>
      <body style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#111827', margin: 0, padding: 0, backgroundColor: '#f9fafb' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#f9fafb', padding: '24px 0' }}>
          <tr>
            <td align="center">
              <table width="600" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                {/* Header */}
                <tr>
                  <td style={{ backgroundColor: '#1e40af', padding: '24px 32px', color: '#ffffff' }}>
                    <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>{organisationName}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.85 }}>Loan Statement</p>
                  </td>
                </tr>
                {/* Staff + loan info */}
                <tr>
                  <td style={{ padding: '20px 32px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ fontSize: '13px' }}>
                      <tr>
                        <td><strong>Name:</strong> {staffName}</td>
                        <td align="right"><strong>Staff No:</strong> {staffNo}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '4px' }}><strong>Principal:</strong> GHS {fmt(loan.principalAmount)}</td>
                        <td align="right" style={{ paddingTop: '4px' }}><strong>Total Repayable:</strong> GHS {fmt(loan.totalRepayable)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '4px' }}><strong>Disbursed:</strong> {new Date(loan.disbursedDate).toLocaleDateString('en-GB')}</td>
                        <td align="right" style={{ paddingTop: '4px' }}><strong>Tenure:</strong> {loan.tenureMonths} months</td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '4px' }}><strong>Guarantor:</strong> {loan.guarantorName}</td>
                        <td align="right" style={{ paddingTop: '4px' }}><strong>Status:</strong> {loan.status}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                {/* KPI box */}
                <tr>
                  <td style={{ padding: '20px 32px' }}>
                    <table width="100%" cellPadding={8} cellSpacing={0} style={{ backgroundColor: '#eff6ff', borderRadius: '6px', fontSize: '13px' }}>
                      <tr>
                        <td><strong>Paid:</strong> GHS {fmt(kpis.totalPaid)}</td>
                        <td><strong>Outstanding:</strong> GHS {fmt(kpis.outstanding)}</td>
                        <td><strong>Penalty:</strong> GHS {fmt(kpis.penaltyPaid)}</td>
                        <td><strong>Completion:</strong> {kpis.completionRate}%</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                {/* Instalment table */}
                <tr>
                  <td style={{ padding: '0 32px 24px' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#1e40af', color: '#ffffff' }}>
                          <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 'normal' }}>#</th>
                          <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 'normal' }}>Due Date</th>
                          <th style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 'normal' }}>Due (GHS)</th>
                          <th style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 'normal' }}>Paid (GHS)</th>
                          <th style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 'normal' }}>Penalty</th>
                          <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 'normal' }}>Paid Date</th>
                          <th style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 'normal' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {instalments.map((r, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>{r.instalmentNumber}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>{new Date(r.dueDate).toLocaleDateString('en-GB')}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(r.dueAmount)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{fmt(r.paidAmount)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>{r.penaltyAmount > 0 ? fmt(r.penaltyAmount) : '—'}</td>
                            <td style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>{r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-GB') : '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: statusColor(r.status), fontWeight: 'bold', fontSize: '11px' }}>{r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
                {/* Footer */}
                <tr>
                  <td style={{ padding: '16px 32px', backgroundColor: '#f8fafc', borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#6b7280' }}>
                    Generated: {new Date().toLocaleDateString('en-GB')} | {organisationName} — Welfare Department
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  );
}

export async function renderLoanStatementEmail(props: LoanStatementEmailProps): Promise<string> {
  return render(<LoanStatementEmail {...props} />);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/email/templates/loan-statement-email.template.tsx
git commit -m "feat(email): add loan statement email template"
```

---

## Task 6: Controller routes

**Files:**
- Modify: `apps/api/src/reports/reports.controller.ts`

- [ ] **Step 1: Add 4 new routes to `reports.controller.ts`**

Add these routes after the existing `@Get('loans/bad-debt')` handler (around line 255), before the `@Post('contributions/bulk-send')` handler:

```ts
@Get('loans/borrowers')
@RequirePermission(AppModule.Reports, 'readonly')
getLoanBorrowers() {
  return this.reportsService.getLoanBorrowers();
}

@Get('loans/staff-statement')
@RequirePermission(AppModule.Reports, 'readonly')
getLoanStatement(
  @Query('staffId') staffId: string,
  @Query('loanId') loanId: string,
) {
  if (!staffId) throw new BadRequestException('staffId is required');
  if (!loanId) throw new BadRequestException('loanId is required');
  return this.reportsService.getLoanStatement(staffId, loanId);
}

@Get('loans/staff-statement/pdf')
@RequirePermission(AppModule.Reports, 'readonly')
async getLoanStatementPdf(
  @Query('staffId') staffId: string,
  @Query('loanId') loanId: string,
  @Res() res: Response,
) {
  if (!staffId) throw new BadRequestException('staffId is required');
  if (!loanId) throw new BadRequestException('loanId is required');
  const { staff, loan } = await this.reportsService.getLoanStatement(staffId, loanId);
  const pdf = await this.reportsService.generateLoanStatementPdf(staffId, loanId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="loan-statement-${staff.staffNo}-${loan.id}.pdf"`,
  );
  res.end(pdf);
}

@Post('loans/staff-statement/send')
@RequirePermission(AppModule.Reports, 'full')
async sendLoanStatement(
  @Body('staffId') staffId: string,
  @Body('loanId') loanId: string,
) {
  if (!staffId) throw new BadRequestException('staffId is required');
  if (!loanId) throw new BadRequestException('loanId is required');
  const stmt = await this.reportsService.getLoanStatement(staffId, loanId);
  const staffDoc = await this.staffModel.findById(staffId).exec();
  if (!staffDoc?.email) throw new BadRequestException('Staff has no email address on record');
  const pdf = await this.reportsService.generateLoanStatementPdf(staffId, loanId);
  await this.emailService.sendWithAttachment(
    { staffId, staffName: stmt.staff.displayName, email: staffDoc.email },
    `Your NACOC Welfare Loan Statement`,
    `<p>Dear ${stmt.staff.displayName},</p><p>Please find attached your welfare loan statement.</p><p>NACOC Welfare</p>`,
    [{ filename: `loan-statement-${stmt.staff.staffNo}-${stmt.loan.id}.pdf`, content: pdf }],
    EmailTriggerSource.Manual,
  );
  return { sent: true, email: staffDoc.email };
}
```

- [ ] **Step 2: Run all reports spec tests — expect no regressions**

```bash
cd apps/api && npx jest reports --no-coverage
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/reports/reports.controller.ts
git commit -m "feat(reports): add loan statement controller routes"
```

---

## Task 7: Client library functions

**Files:**
- Modify: `apps/web/src/lib/reports.ts`

- [ ] **Step 1: Add types and functions to `reports.ts`**

Add `ILoanBorrower` and `ILoanStatement` to the import from `@welfare/shared`:

```ts
import type {
  IMonthlyContributionReport,
  IArrearRow,
  IGuarantorOffsetRow,
  IActiveLoanRow,
  IOverdueLoanRow,
  IRepaidLoanRow,
  IGuarantorExposureRow,
  IBadDebtRow,
  IExitClearanceRow,
  IDashboardStats,
  ILoanBorrower,
  ILoanStatement,
} from '@welfare/shared';
```

Append the following 4 functions to the end of `apps/web/src/lib/reports.ts`:

```ts
export async function getLoanBorrowers(): Promise<ILoanBorrower[]> {
  const { data } = await apiClient.get('/reports/loans/borrowers');
  return data;
}

export async function getLoanStatement(staffId: string, loanId: string): Promise<ILoanStatement> {
  const { data } = await apiClient.get('/reports/loans/staff-statement', {
    params: { staffId, loanId },
  });
  return data;
}

export async function downloadLoanStatementPdf(
  staffId: string,
  loanId: string,
  staffNo: string,
): Promise<void> {
  const { data } = await apiClient.get('/reports/loans/staff-statement/pdf', {
    params: { staffId, loanId },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `loan-statement-${staffNo}-${loanId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function sendLoanStatement(
  staffId: string,
  loanId: string,
): Promise<{ sent: boolean; email: string }> {
  const { data } = await apiClient.post('/reports/loans/staff-statement/send', { staffId, loanId });
  return data;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/reports.ts
git commit -m "feat(reports): add loan statement client library functions"
```

---

## Task 8: `LoanStatementPanel` component + sidebar wiring

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

- [ ] **Step 1: Add imports at the top of `reports-client.tsx`**

Add to the existing import from `@/lib/reports`:

```ts
import {
  // ... existing imports ...
  getLoanBorrowers,
  getLoanStatement,
  downloadLoanStatementPdf,
  sendLoanStatement,
} from '@/lib/reports';
import { listLoans } from '@/lib/loans';
import type { ILoan } from '@welfare/shared';
```

Also add `LoanStatus` to the `@welfare/shared` import block.

- [ ] **Step 2: Add status color map and `LoanStatementPanel` component**

Add after the existing `STATUS_BG` constant and before `StaffStatementPanel`:

```ts
const LOAN_STATUS_BADGE: Record<string, string> = {
  Active:     'bg-info-50 text-info-700',
  Completed:  'bg-success-50 text-success-700',
  WrittenOff: 'bg-neutral-100 text-neutral-500',
  BadDebt:    'bg-danger-50 text-danger-700',
  Defaulted:  'bg-warning-50 text-warning-700',
};

const INSTALMENT_STATUS_BG: Record<string, string> = {
  Paid:    'bg-success-50 text-success-700',
  Partial: 'bg-warning-50 text-warning-700',
  Overdue: 'bg-danger-50 text-danger-700',
  Pending: 'bg-neutral-50 text-neutral-500',
  Waived:  'bg-neutral-100 text-neutral-400',
};

function LoanStatementPanel({ canSend }: { canSend: boolean }) {
  const [selectedBorrower, setSelectedBorrower] = useState<{ staffId: string; staffNo: string; displayName: string } | null>(null);
  const [selectedLoan, setSelectedLoan]         = useState<ILoan | null>(null);

  const { data: borrowers = [], isLoading: loadingBorrowers } = useQuery({
    queryKey: ['loan-borrowers'],
    queryFn: getLoanBorrowers,
  });

  const { data: loansPage } = useQuery({
    queryKey: ['loans-for-borrower', selectedBorrower?.staffId],
    queryFn: () => listLoans({ staffId: selectedBorrower!.staffId, limit: 100 }),
    enabled: !!selectedBorrower,
  });
  const loans = loansPage?.data ?? [];

  const { data: stmt, isLoading: loadingStmt } = useQuery({
    queryKey: ['loan-statement', selectedBorrower?.staffId, selectedLoan?._id],
    queryFn: () => getLoanStatement(selectedBorrower!.staffId, selectedLoan!._id as string),
    enabled: !!selectedBorrower && !!selectedLoan,
  });

  const sendMutation = useMutation({
    mutationFn: () => sendLoanStatement(selectedBorrower!.staffId, selectedLoan!._id as string),
    onSuccess: (res) => toast.success(`Statement sent to ${res.email}`),
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to send statement'),
  });

  function handleBorrowerChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const b = borrowers.find(b => b.staffId === e.target.value) ?? null;
    setSelectedBorrower(b);
    setSelectedLoan(null);
  }

  function handleLoanChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const l = loans.find(l => (l._id as string) === e.target.value) ?? null;
    setSelectedLoan(l);
  }

  const { kpis, instalments, loan } = stmt ?? {};

  return (
    <div className="space-y-5">
      {/* Selectors */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Select Borrower">
          <Select
            value={selectedBorrower?.staffId ?? ''}
            onChange={handleBorrowerChange}
            options={[
              { value: '', label: loadingBorrowers ? 'Loading…' : 'Select borrower…' },
              ...borrowers.map(b => ({ value: b.staffId, label: `${b.displayName} (${b.staffNo})` })),
            ]}
            style={{ minWidth: 240 }}
          />
        </Field>

        {selectedBorrower && (
          <Field label="Select Loan">
            <Select
              value={(selectedLoan?._id as string) ?? ''}
              onChange={handleLoanChange}
              options={[
                { value: '', label: loans.length === 0 ? 'No loans found' : 'Select loan…' },
                ...loans.map(l => ({
                  value: l._id as string,
                  label: `GHS ${l.principalAmount.toLocaleString()} · ${new Date(l.disbursedDate).toLocaleDateString('en-GB')} · ${l.status}`,
                })),
              ]}
              style={{ minWidth: 280 }}
            />
          </Field>
        )}

        {selectedBorrower && selectedLoan && stmt && (
          <div className="flex gap-2 ml-auto">
            <Button
              variant="secondary"
              size="sm"
              Icon={FileText}
              onClick={() =>
                downloadLoanStatementPdf(
                  selectedBorrower.staffId,
                  selectedLoan._id as string,
                  selectedBorrower.staffNo,
                ).catch(() => toast.error('Download failed'))
              }
            >
              Download PDF
            </Button>
            {canSend && (
              <Button
                variant="primary"
                size="sm"
                Icon={Send}
                loading={sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                Send Statement
              </Button>
            )}
          </div>
        )}
      </div>

      {!selectedBorrower && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">
          Select a borrower to view their loan statement
        </div>
      )}

      {selectedBorrower && !selectedLoan && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">
          Select a loan to view the statement
        </div>
      )}

      {selectedBorrower && selectedLoan && loadingStmt && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">Loading…</div>
      )}

      {stmt && kpis && loan && (
        <>
          {/* Loan info block */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs bg-neutral-50 border border-neutral-200 rounded-md px-4 py-3">
            <div><span className="text-neutral-400">Disbursed</span><br /><span className="font-medium">{fmtDate(new Date(loan.disbursedDate))}</span></div>
            <div><span className="text-neutral-400">Tenure</span><br /><span className="font-medium">{loan.tenureMonths} months</span></div>
            <div><span className="text-neutral-400">Interest Rate</span><br /><span className="font-medium">{loan.interestRate}%</span></div>
            <div><span className="text-neutral-400">Guarantor</span><br /><span className="font-medium">{loan.guarantor.displayName} ({loan.guarantor.staffNo})</span></div>
            <div><span className="text-neutral-400">Cheque No</span><br /><span className="font-medium">{loan.chequeNo ?? '—'}</span></div>
            <div><span className="text-neutral-400">PV No</span><br /><span className="font-medium">{loan.pvNo ?? '—'}</span></div>
            <div><span className="text-neutral-400">Status</span><br />
              <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium', LOAN_STATUS_BADGE[loan.status] ?? 'bg-neutral-100 text-neutral-600')}>{loan.status}</span>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Principal" value={fmtGHS(loan.principalAmount)} icon={Banknote} iconKind="primary" />
            <KpiCard label="Amount Paid" value={fmtGHS(kpis.totalPaid)} icon={TrendingUp} iconKind="success" />
            <KpiCard label="Outstanding" value={fmtGHS(kpis.outstanding)} icon={AlertCircle} iconKind={kpis.outstanding === 0 ? 'success' : kpis.outstanding > loan.principalAmount / 2 ? 'danger' : 'warning'} />
            <KpiCard label="Completion" value={`${kpis.completionRate}%`} icon={BarChart3} iconKind={kpis.completionRate === 100 ? 'success' : kpis.completionRate >= 50 ? 'warning' : 'danger'} subtext={kpis.penaltyPaid > 0 ? `Penalty: ${fmtGHS(kpis.penaltyPaid)}` : undefined} />
          </div>

          {/* Instalment table */}
          {instalments && instalments.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-primary-600 text-white">
                    <th className="px-3 py-2.5 text-left font-semibold">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">Due Date</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Due (GHS)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Principal</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Interest</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Paid (GHS)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Penalty</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">Paid Date</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {instalments.map(r => (
                    <tr key={r.instalmentNumber} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-neutral-500">{r.instalmentNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(new Date(r.dueDate))}</td>
                      <td className="px-3 py-2 text-right font-mono tabular">{fmtGHS(r.dueAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-neutral-500">{fmtGHS(r.principalAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-neutral-500">{fmtGHS(r.interestAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular font-medium">{fmtGHS(r.paidAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-danger-600">{r.penaltyAmount > 0 ? fmtGHS(r.penaltyAmount) : <span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.paidDate ? fmtDate(new Date(r.paidDate)) : <span className="text-neutral-300">—</span>}</td>
                      <td className="px-3 py-2">
                        <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium', INSTALMENT_STATUS_BG[r.status] ?? 'bg-neutral-100 text-neutral-600')}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 border border-neutral-200 rounded-md text-neutral-400 text-sm">
              No instalment records found
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add `loan-statement` to the `SECTIONS` array**

Find the `SECTIONS` array (around line 724). Add a new entry after `'bulk-statements'`:

```ts
const SECTIONS = [
  { id: 'monthly-contrib', label: 'Contribution Statement' },
  { id: 'bulk-statements', label: 'Bulk Statements' },
  { id: 'loan-statement', label: 'Loan Statement' },   // ← add this
  { id: 'arrears', label: 'Arrears' },
  // ... rest unchanged
];
```

- [ ] **Step 4: Add panel render in `ReportsClient`**

Find the `{active === 'bulk-statements' && ...}` line in the `ReportsClient` render. Add after it:

```tsx
{active === 'loan-statement' && <LoanStatementPanel canSend={canSend} />}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/reports/reports-client.tsx apps/web/src/lib/reports.ts
git commit -m "feat(reports): add LoanStatementPanel UI component"
```

---

## Task 9: Full run verification

- [ ] **Step 1: Run all API tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: all tests PASS with no regressions

- [ ] **Step 2: Build shared package to generate updated `.d.ts` files**

```bash
cd packages/shared && npm run build
```

Expected: build completes with no errors

- [ ] **Step 3: TypeScript check on web app**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 4: TypeScript check on API**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 5: Final commit if any minor fixes were made**

```bash
git add -A
git commit -m "fix(reports): address type errors in loan statement feature"
```

(Only commit if there were actual fixes. Skip if Task 1–8 produced clean output.)
