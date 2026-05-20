# Phase 6 — Reports Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement report APIs (NestJS) and frontend pages (Next.js) covering contributions, loans, staff exit, and a live dashboard.

**Architecture:** NestJS `ReportsModule` registers Contribution/Loan/LoanRepayment/Staff/ImportBatch models directly and exposes 10 GET endpoints; optional `?format=pdf|csv` triggers Puppeteer HTML-to-PDF or json2csv streaming. Next.js dashboard replaces the placeholder at `/` and a new `/reports` page hosts a sidebar-driven report viewer.

**Tech Stack:** NestJS, Mongoose aggregations, Puppeteer, json2csv, Next.js 14 App Router, Recharts, Tanstack Table, React Query, Tailwind CSS.

---

## File Map

**New — API:**
- `apps/api/src/reports/dto/report-query.dto.ts`
- `apps/api/src/reports/reports.service.ts`
- `apps/api/src/reports/reports.service.spec.ts`
- `apps/api/src/reports/reports.controller.ts`
- `apps/api/src/reports/reports.module.ts`

**Modified — API:**
- `apps/api/src/app.module.ts` — add `ReportsModule`
- `apps/api/package.json` — add `puppeteer`, `json2csv`

**New — Shared:**
- `packages/shared/src/interfaces/report.interface.ts`

**Modified — Shared:**
- `packages/shared/src/index.ts` — export report interfaces

**New — Web:**
- `apps/web/src/lib/reports.ts`
- `apps/web/src/app/(dashboard)/page.tsx` — replace placeholder
- `apps/web/src/app/(dashboard)/dashboard-client.tsx`
- `apps/web/src/app/(dashboard)/reports/page.tsx`
- `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

---

## Task 1: Install API Dependencies

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install packages**

```bash
cd apps/api && npm install puppeteer json2csv
cd apps/api && npm install --save-dev @types/json2csv
```

- [ ] **Step 2: Verify import compiles**

Add to any temp file and remove: `import puppeteer from 'puppeteer'; import { parse } from 'json2csv';`

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "chore(api): add puppeteer and json2csv dependencies"
```

---

## Task 2: Shared Report Interfaces

**Files:**
- Create: `packages/shared/src/interfaces/report.interface.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create report interfaces**

Create `packages/shared/src/interfaces/report.interface.ts`:

```typescript
import { ContributionStatus } from '../enums/contribution-status.enum';
import { LoanRepaymentStatus } from '../enums/loan-repayment-status.enum';
import { LoanStatus } from '../enums/loan-status.enum';
import { StaffStatus } from '../enums/staff-status.enum';

export interface IMonthlyContributionRow {
  staffId: string;
  staffName: string;
  staffNo: string;
  expectedAmount: number;
  paidAmount: number;
  surplusCarriedForward: number;
  status: ContributionStatus;
}

export interface IMonthlyContributionReport {
  month: number;
  year: number;
  rows: IMonthlyContributionRow[];
  totalExpected: number;
  totalPaid: number;
  totalSurplus: number;
}

export interface IArrearRow {
  staffId: string;
  staffName: string;
  staffNo: string;
  month: number;
  year: number;
  expectedAmount: number;
  paidAmount: number;
  shortfall: number;
  status: ContributionStatus;
}

export interface IGuarantorOffsetRow {
  guarantorStaffId: string;
  guarantorName: string;
  borrowerStaffId: string;
  borrowerName: string;
  loanId: string;
  instalmentNumber: number;
  offsetAmount: number;
  offsetDate: string;
}

export interface IActiveLoanRow {
  loanId: string;
  staffId: string;
  staffName: string;
  staffNo: string;
  guarantorId: string;
  guarantorName: string;
  principalAmount: number;
  outstandingBalance: number;
  nextDueDate: string | null;
  nextDueAmount: number | null;
  disbursedDate: string;
}

export interface IOverdueLoanRow {
  loanId: string;
  staffId: string;
  staffName: string;
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  penaltyAmount: number;
  daysOverdue: number;
  status: LoanRepaymentStatus;
}

export interface IRepaidLoanRow {
  loanId: string;
  staffId: string;
  staffName: string;
  principalAmount: number;
  totalRepayable: number;
  settledAt: string;
  disbursedDate: string;
  tenureMonths: number;
}

export interface IGuarantorExposureRow {
  guarantorId: string;
  guarantorName: string;
  guarantorStaffNo: string;
  totalOutstanding: number;
  activeLoansCount: number;
  totalOffsetAmount: number;
  offsetHistory: Array<{
    loanId: string;
    borrowerName: string;
    offsetAmount: number;
    offsetDate: string;
  }>;
}

export interface IBadDebtRow {
  loanId: string;
  staffId: string;
  staffName: string;
  principalAmount: number;
  totalRepayable: number;
  exitDeductionAmount: number;
  guarantorOffsetAmount: number;
  badDebtAmount: number;
  settledAt: string;
}

export interface IExitClearanceRow {
  staffId: string;
  staffName: string;
  staffNo: string;
  status: StaffStatus;
  outstandingLoanBalance: number;
  missedContributionsCount: number;
  activeLoanIds: string[];
}

export interface IDashboardStats {
  thisMonth: {
    year: number;
    month: number;
    collected: number;
    expected: number;
    collectionRate: number;
  };
  loans: {
    activeCount: number;
    totalOutstanding: number;
  };
  overdueInstalments: number;
  membersInArrears: number;
  monthlyTrend: Array<{
    year: number;
    month: number;
    label: string;
    collected: number;
    expected: number;
  }>;
  loanStatusDistribution: Array<{
    status: LoanStatus;
    count: number;
  }>;
  upcomingPayments: Array<{
    loanId: string;
    staffName: string;
    dueDate: string;
    dueAmount: number;
    instalmentNumber: number;
  }>;
  recentFlaggedBatches: Array<{
    batchId: string;
    month: number;
    year: number;
    flaggedRows: number;
    fileName: string;
    uploadedAt: string;
  }>;
}
```

- [ ] **Step 2: Export from shared index**

Open `packages/shared/src/index.ts` and add:
```typescript
export * from './interfaces/report.interface';
```
(Add after the existing interface exports.)

- [ ] **Step 3: Verify compile**

```bash
cd packages/shared && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/interfaces/report.interface.ts packages/shared/src/index.ts
git commit -m "feat(shared): add report response interfaces"
```

---

## Task 3: Report Query DTO

**Files:**
- Create: `apps/api/src/reports/dto/report-query.dto.ts`

- [ ] **Step 1: Write failing test for DTO validation**

Create `apps/api/src/reports/dto/report-query.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReportQueryDto } from './report-query.dto';

describe('ReportQueryDto', () => {
  it('accepts empty query (all optional)', async () => {
    const dto = plainToInstance(ReportQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid format', async () => {
    const dto = plainToInstance(ReportQueryDto, { format: 'xml' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'format')).toBe(true);
  });

  it('coerces month/year strings to numbers', async () => {
    const dto = plainToInstance(ReportQueryDto, { month: '3', year: '2025' });
    expect(dto.month).toBe(3);
    expect(dto.year).toBe(2025);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && npx jest src/reports/dto/report-query.dto.spec.ts --no-coverage
```
Expected: FAIL (file not found)

- [ ] **Step 3: Create DTO**

Create `apps/api/src/reports/dto/report-query.dto.ts`:

```typescript
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  month?: number;

  @IsOptional()
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year?: number;

  @IsOptional()
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  fromYear?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  fromMonth?: number;

  @IsOptional()
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  toYear?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  toMonth?: number;

  @IsOptional()
  @IsEnum(['json', 'pdf', 'csv'])
  format?: 'json' | 'pdf' | 'csv';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  limit?: number;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && npx jest src/reports/dto/report-query.dto.spec.ts --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/dto/
git commit -m "feat(reports): add ReportQueryDto with format/date-range params"
```

---

## Task 4: Reports Service — Contribution Reports

**Files:**
- Create: `apps/api/src/reports/reports.service.ts` (contributions section)
- Create: `apps/api/src/reports/reports.service.spec.ts` (contributions tests)

- [ ] **Step 1: Write failing tests for contribution reports**

Create `apps/api/src/reports/reports.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ReportsService } from './reports.service';
import { Contribution } from '../contributions/schemas/contribution.schema';
import { Loan } from '../loans/schemas/loan.schema';
import { LoanRepayment } from '../loans/schemas/loan-repayment.schema';
import { Staff } from '../staff/schemas/staff.schema';
import { ImportBatch } from '../contributions/schemas/import-batch.schema';
import { ContributionStatus, LoanStatus, LoanRepaymentStatus, StaffStatus } from '@welfare/shared';

const mockContribAggregate = jest.fn();
const mockLoanFind = jest.fn();
const mockLoanAggregate = jest.fn();
const mockRepaymentFind = jest.fn();
const mockRepaymentAggregate = jest.fn();
const mockStaffFind = jest.fn();
const mockBatchFind = jest.fn();

const mockContribModel = { aggregate: mockContribAggregate };
const mockLoanModel = { find: mockLoanFind, aggregate: mockLoanAggregate };
const mockRepaymentModel = { find: mockRepaymentFind, aggregate: mockRepaymentAggregate };
const mockStaffModel = { find: mockStaffFind };
const mockBatchModel = { find: mockBatchFind };

beforeEach(() => jest.clearAllMocks());

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: mockRepaymentModel },
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
        { provide: getModelToken(ImportBatch.name), useValue: mockBatchModel },
      ],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
  });

  describe('getMonthlyContributions', () => {
    it('returns aggregated rows with totals', async () => {
      mockContribAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            staffId: 'staff1',
            staffName: 'Alice',
            staffNo: 'GL001',
            expectedAmount: 100,
            paidAmount: 100,
            surplusCarriedForward: 0,
            status: ContributionStatus.Paid,
          },
        ]),
      });

      const result = await service.getMonthlyContributions(1, 2025);

      expect(result.month).toBe(1);
      expect(result.year).toBe(2025);
      expect(result.rows).toHaveLength(1);
      expect(result.totalExpected).toBe(100);
      expect(result.totalPaid).toBe(100);
    });
  });

  describe('getArrearsReport', () => {
    it('returns only missed/partial entries with shortfall', async () => {
      mockContribAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          {
            staffId: 'staff2',
            staffName: 'Bob',
            staffNo: 'GL002',
            month: 2,
            year: 2025,
            expectedAmount: 100,
            paidAmount: 50,
            status: ContributionStatus.Partial,
          },
        ]),
      });

      const result = await service.getArrearsReport(1, 2025, 3, 2025);

      expect(result).toHaveLength(1);
      expect(result[0].shortfall).toBe(50);
    });
  });

  describe('getGuarantorOffsets', () => {
    it('returns repayments with guarantor source', async () => {
      mockRepaymentFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'rep1',
              loanId: 'loan1',
              staffId: 'borrower1',
              guarantorStaffId: 'guarantor1',
              instalmentNumber: 3,
              paidAmount: 200,
              paidDate: new Date('2025-03-05'),
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: 'borrower1', fullName: 'Borrower One', staffId: 'S001' },
          { _id: 'guarantor1', fullName: 'Guarantor One', staffId: 'S002' },
        ]),
      });

      const result = await service.getGuarantorOffsets();
      expect(result).toHaveLength(1);
      expect(result[0].offsetAmount).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage
```
Expected: FAIL (ReportsService not found)

- [ ] **Step 3: Create reports.service.ts with contribution methods**

Create `apps/api/src/reports/reports.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ContributionStatus,
  LoanRepaymentStatus,
  LoanStatus,
  RepaymentSource,
  StaffStatus,
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
} from '@welfare/shared';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { Loan, LoanDocument } from '../loans/schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from '../loans/schemas/loan-repayment.schema';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { ImportBatch, ImportBatchDocument } from '../contributions/schemas/import-batch.schema';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    @InjectModel(ImportBatch.name) private readonly batchModel: Model<ImportBatchDocument>,
  ) {}

  async getMonthlyContributions(month: number, year: number): Promise<IMonthlyContributionReport> {
    const rows = await this.contribModel
      .aggregate([
        { $match: { month, year, isDebit: { $ne: true } } },
        {
          $lookup: {
            from: 'staff',
            localField: 'staffId',
            foreignField: '_id',
            as: 'staffDoc',
          },
        },
        { $unwind: { path: '$staffDoc', preserveNullAndEmpty: true } },
        {
          $project: {
            staffId: 1,
            staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
            staffNo: { $ifNull: ['$staffDoc.staffId', ''] },
            expectedAmount: 1,
            paidAmount: 1,
            surplusCarriedForward: 1,
            status: 1,
          },
        },
        { $sort: { staffName: 1 } },
      ])
      .exec();

    const totalExpected = rows.reduce((s, r) => s + (r.expectedAmount ?? 0), 0);
    const totalPaid = rows.reduce((s, r) => s + (r.paidAmount ?? 0), 0);
    const totalSurplus = rows.reduce((s, r) => s + (r.surplusCarriedForward ?? 0), 0);

    return { month, year, rows, totalExpected, totalPaid, totalSurplus };
  }

  async getArrearsReport(
    fromMonth: number,
    fromYear: number,
    toMonth: number,
    toYear: number,
  ): Promise<IArrearRow[]> {
    const rows = await this.contribModel
      .aggregate([
        {
          $match: {
            status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] },
            isDebit: { $ne: true },
            $or: [
              { year: { $gt: fromYear } },
              { year: fromYear, month: { $gte: fromMonth } },
            ],
            $and: [
              {
                $or: [
                  { year: { $lt: toYear } },
                  { year: toYear, month: { $lte: toMonth } },
                ],
              },
            ],
          },
        },
        {
          $lookup: {
            from: 'staff',
            localField: 'staffId',
            foreignField: '_id',
            as: 'staffDoc',
          },
        },
        { $unwind: { path: '$staffDoc', preserveNullAndEmpty: true } },
        {
          $project: {
            staffId: 1,
            staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
            staffNo: { $ifNull: ['$staffDoc.staffId', ''] },
            month: 1,
            year: 1,
            expectedAmount: 1,
            paidAmount: 1,
            shortfall: { $subtract: ['$expectedAmount', '$paidAmount'] },
            status: 1,
          },
        },
        { $sort: { year: 1, month: 1, staffName: 1 } },
      ])
      .exec();

    return rows;
  }

  async getGuarantorOffsets(
    fromDate?: Date,
    toDate?: Date,
  ): Promise<IGuarantorOffsetRow[]> {
    const match: Record<string, unknown> = {
      source: RepaymentSource.GuarantorOffset,
    };
    if (fromDate || toDate) {
      const dateFilter: Record<string, unknown> = {};
      if (fromDate) dateFilter.$gte = fromDate;
      if (toDate) dateFilter.$lte = toDate;
      match.paidDate = dateFilter;
    }

    const repayments = await this.repaymentModel
      .find(match)
      .sort({ paidDate: -1 })
      .exec();

    if (repayments.length === 0) return [];

    const allIds = [
      ...new Set([
        ...repayments.map(r => r.staffId),
        ...repayments.filter(r => r.guarantorStaffId).map(r => r.guarantorStaffId as string),
      ]),
    ];
    const staffDocs = await this.staffModel.find({ _id: { $in: allIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return repayments.map(r => {
      const borrower = staffMap.get(r.staffId);
      const guarantor = r.guarantorStaffId ? staffMap.get(r.guarantorStaffId) : undefined;
      return {
        guarantorStaffId: r.guarantorStaffId ?? '',
        guarantorName: guarantor?.fullName ?? 'Unknown',
        borrowerStaffId: r.staffId,
        borrowerName: borrower?.fullName ?? 'Unknown',
        loanId: r.loanId,
        instalmentNumber: r.instalmentNumber,
        offsetAmount: r.paidAmount,
        offsetDate: r.paidDate?.toISOString() ?? '',
      };
    });
  }
```

- [ ] **Step 4: Run tests — expect PASS (3 tests)**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage --testNamePattern="getMonthlyContributions|getArrearsReport|getGuarantorOffsets"
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/
git commit -m "feat(reports): contribution report methods (monthly, arrears, guarantor offsets)"
```

---

## Task 5: Reports Service — Loan Reports

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts` (append loan methods)
- Modify: `apps/api/src/reports/reports.service.spec.ts` (append loan tests)

- [ ] **Step 1: Add loan report tests to spec file**

Append to the `describe('ReportsService')` block in `apps/api/src/reports/reports.service.spec.ts`:

```typescript
  describe('getActiveLoans', () => {
    it('returns active loans with outstanding balance', async () => {
      mockLoanFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'loan1',
              staffId: 'staff1',
              guarantorId: 'staff2',
              principalAmount: 5000,
              totalRepayable: 5500,
              disbursedDate: new Date('2025-01-01'),
            },
          ]),
        }),
      });
      mockRepaymentFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { status: LoanRepaymentStatus.Pending, dueAmount: 500, paidAmount: 0, dueDate: new Date('2025-06-05') },
        ]),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: 'staff1', fullName: 'Alice', staffId: 'S001' },
          { _id: 'staff2', fullName: 'Bob', staffId: 'S002' },
        ]),
      });

      const result = await service.getActiveLoans();
      expect(result).toHaveLength(1);
      expect(result[0].outstandingBalance).toBe(500);
    });
  });

  describe('getOverdueLoans', () => {
    it('returns overdue instalments with daysOverdue', async () => {
      const today = new Date();
      const pastDate = new Date(today);
      pastDate.setDate(pastDate.getDate() - 10);

      mockRepaymentFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'rep1',
              loanId: 'loan1',
              staffId: 'staff1',
              instalmentNumber: 2,
              dueDate: pastDate,
              dueAmount: 500,
              paidAmount: 0,
              penaltyAmount: 25,
              status: LoanRepaymentStatus.Overdue,
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: 'staff1', fullName: 'Alice', staffId: 'S001' },
        ]),
      });

      const result = await service.getOverdueLoans();
      expect(result).toHaveLength(1);
      expect(result[0].daysOverdue).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getRepaidLoans', () => {
    it('returns completed and bad-debt loans', async () => {
      mockLoanFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'loan2',
              staffId: 'staff1',
              principalAmount: 3000,
              totalRepayable: 3300,
              settledAt: new Date('2025-04-01'),
              disbursedDate: new Date('2024-04-01'),
              tenureMonths: 12,
              status: LoanStatus.Completed,
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: 'staff1', fullName: 'Alice', staffId: 'S001' },
        ]),
      });

      const result = await service.getRepaidLoans();
      expect(result).toHaveLength(1);
      expect(result[0].totalRepayable).toBe(3300);
    });
  });

  describe('getBadDebt', () => {
    it('returns loans with BadDebt status', async () => {
      mockLoanFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'loan3',
              staffId: 'staff1',
              principalAmount: 4000,
              totalRepayable: 4400,
              exitDeductionAmount: 1000,
              guarantorOffsetAmount: 500,
              badDebtAmount: 2900,
              settledAt: new Date('2025-05-01'),
              status: LoanStatus.BadDebt,
            },
          ]),
        }),
      });
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: 'staff1', fullName: 'Alice', staffId: 'S001' },
        ]),
      });

      const result = await service.getBadDebt();
      expect(result).toHaveLength(1);
      expect(result[0].badDebtAmount).toBe(2900);
    });
  });
```

- [ ] **Step 2: Run new tests — expect FAIL**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage --testNamePattern="getActiveLoans|getOverdueLoans|getRepaidLoans|getBadDebt"
```
Expected: FAIL (methods not defined)

- [ ] **Step 3: Append loan methods to reports.service.ts**

Append inside the `ReportsService` class (before the closing `}`):

```typescript
  async getActiveLoans(): Promise<IActiveLoanRow[]> {
    const loans = await this.loanModel
      .find({ status: LoanStatus.Active })
      .sort({ disbursedDate: -1 })
      .exec();

    if (loans.length === 0) return [];

    const staffIds = [...new Set([...loans.map(l => l.staffId), ...loans.map(l => l.guarantorId)])];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    const rows: IActiveLoanRow[] = [];
    for (const loan of loans) {
      const repayments = await this.repaymentModel
        .find({
          loanId: loan._id.toString(),
          status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
        })
        .exec();

      const outstandingBalance = repayments.reduce(
        (s, r) => s + (r.dueAmount - r.paidAmount),
        0,
      );
      const next = repayments
        .filter(r => r.status !== LoanRepaymentStatus.Overdue)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

      const staff = staffMap.get(loan.staffId);
      const guarantor = staffMap.get(loan.guarantorId);

      rows.push({
        loanId: loan._id.toString(),
        staffId: loan.staffId,
        staffName: staff?.fullName ?? 'Unknown',
        staffNo: staff?.staffId ?? '',
        guarantorId: loan.guarantorId,
        guarantorName: guarantor?.fullName ?? 'Unknown',
        principalAmount: loan.principalAmount,
        outstandingBalance: Math.round(outstandingBalance * 100) / 100,
        nextDueDate: next ? next.dueDate.toISOString() : null,
        nextDueAmount: next ? next.dueAmount - next.paidAmount : null,
        disbursedDate: loan.disbursedDate.toISOString(),
      });
    }
    return rows;
  }

  async getOverdueLoans(): Promise<IOverdueLoanRow[]> {
    const now = new Date();
    const repayments = await this.repaymentModel
      .find({ status: LoanRepaymentStatus.Overdue })
      .sort({ dueDate: 1 })
      .exec();

    if (repayments.length === 0) return [];

    const staffIds = [...new Set(repayments.map(r => r.staffId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return repayments.map(r => {
      const staff = staffMap.get(r.staffId);
      const daysOverdue = Math.floor((now.getTime() - r.dueDate.getTime()) / (1000 * 60 * 60 * 24));
      return {
        loanId: r.loanId,
        staffId: r.staffId,
        staffName: staff?.fullName ?? 'Unknown',
        instalmentNumber: r.instalmentNumber,
        dueDate: r.dueDate.toISOString(),
        dueAmount: r.dueAmount,
        paidAmount: r.paidAmount,
        penaltyAmount: r.penaltyAmount,
        daysOverdue,
        status: r.status,
      };
    });
  }

  async getRepaidLoans(): Promise<IRepaidLoanRow[]> {
    const loans = await this.loanModel
      .find({ status: { $in: [LoanStatus.Completed, LoanStatus.Settled] } })
      .sort({ settledAt: -1 })
      .exec();

    if (loans.length === 0) return [];

    const staffIds = [...new Set(loans.map(l => l.staffId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return loans.map(l => ({
      loanId: l._id.toString(),
      staffId: l.staffId,
      staffName: staffMap.get(l.staffId)?.fullName ?? 'Unknown',
      principalAmount: l.principalAmount,
      totalRepayable: l.totalRepayable,
      settledAt: l.settledAt?.toISOString() ?? '',
      disbursedDate: l.disbursedDate.toISOString(),
      tenureMonths: l.tenureMonths,
    }));
  }

  async getGuarantorExposure(): Promise<IGuarantorExposureRow[]> {
    const activeLoans = await this.loanModel
      .find({ status: LoanStatus.Active })
      .exec();

    if (activeLoans.length === 0) return [];

    const guarantorIds = [...new Set(activeLoans.map(l => l.guarantorId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: guarantorIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    const rows: IGuarantorExposureRow[] = [];

    for (const gId of guarantorIds) {
      const gLoans = activeLoans.filter(l => l.guarantorId === gId);
      let totalOutstanding = 0;

      for (const loan of gLoans) {
        const pending = await this.repaymentModel
          .find({
            loanId: loan._id.toString(),
            status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
          })
          .exec();
        totalOutstanding += pending.reduce((s, r) => s + r.dueAmount - r.paidAmount, 0);
      }

      const offsetRepayments = await this.repaymentModel
        .find({ guarantorStaffId: gId, source: RepaymentSource.GuarantorOffset })
        .exec();

      const totalOffsetAmount = offsetRepayments.reduce((s, r) => s + r.paidAmount, 0);

      const borrowerIds = [...new Set(offsetRepayments.map(r => r.staffId))];
      const borrowerDocs = await this.staffModel.find({ _id: { $in: borrowerIds } }).exec();
      const borrowerMap = new Map(borrowerDocs.map(s => [s._id.toString(), s]));

      const staff = staffMap.get(gId);
      rows.push({
        guarantorId: gId,
        guarantorName: staff?.fullName ?? 'Unknown',
        guarantorStaffNo: staff?.staffId ?? '',
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        activeLoansCount: gLoans.length,
        totalOffsetAmount: Math.round(totalOffsetAmount * 100) / 100,
        offsetHistory: offsetRepayments.map(r => ({
          loanId: r.loanId,
          borrowerName: borrowerMap.get(r.staffId)?.fullName ?? 'Unknown',
          offsetAmount: r.paidAmount,
          offsetDate: r.paidDate?.toISOString() ?? '',
        })),
      });
    }

    return rows.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  async getBadDebt(): Promise<IBadDebtRow[]> {
    const loans = await this.loanModel
      .find({ status: LoanStatus.BadDebt })
      .sort({ settledAt: -1 })
      .exec();

    if (loans.length === 0) return [];

    const staffIds = [...new Set(loans.map(l => l.staffId))];
    const staffDocs = await this.staffModel.find({ _id: { $in: staffIds } }).exec();
    const staffMap = new Map(staffDocs.map(s => [s._id.toString(), s]));

    return loans.map(l => ({
      loanId: l._id.toString(),
      staffId: l.staffId,
      staffName: staffMap.get(l.staffId)?.fullName ?? 'Unknown',
      principalAmount: l.principalAmount,
      totalRepayable: l.totalRepayable,
      exitDeductionAmount: l.exitDeductionAmount ?? 0,
      guarantorOffsetAmount: l.guarantorOffsetAmount ?? 0,
      badDebtAmount: l.badDebtAmount ?? 0,
      settledAt: l.settledAt?.toISOString() ?? '',
    }));
  }
```

- [ ] **Step 4: Run loan tests — expect PASS**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage
```
Expected: all loan tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(reports): loan report methods (active, overdue, repaid, guarantor exposure, bad debt)"
```

---

## Task 6: Reports Service — Staff + Dashboard

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts` (append staff + dashboard methods)
- Modify: `apps/api/src/reports/reports.service.spec.ts` (append tests)

- [ ] **Step 1: Add staff + dashboard tests**

Append to the `describe('ReportsService')` block:

```typescript
  describe('getExitClearanceReport', () => {
    it('returns non-active staff with outstanding balances', async () => {
      mockStaffFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: 'staff3', fullName: 'Charlie', staffId: 'GL003', status: StaffStatus.Resigned },
        ]),
      });
      mockLoanFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: 'loan1', staffId: 'staff3', totalRepayable: 5000 },
        ]),
      });
      mockRepaymentFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { dueAmount: 500, paidAmount: 200, status: LoanRepaymentStatus.Overdue },
        ]),
      });
      mockContribAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ count: 2 }]),
      });

      const result = await service.getExitClearanceReport();
      expect(result).toHaveLength(1);
      expect(result[0].outstandingLoanBalance).toBe(300);
      expect(result[0].missedContributionsCount).toBe(2);
    });
  });

  describe('getDashboardStats', () => {
    it('returns structured dashboard stats', async () => {
      const now = new Date();
      mockContribAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: null, collected: 5000, expected: 6000 },
        ]),
      });
      mockLoanAggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { status: LoanStatus.Active, count: 10 },
          { status: LoanStatus.Completed, count: 5 },
        ]),
      });
      mockRepaymentFind.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });
      mockBatchFind.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.getDashboardStats();
      expect(result.thisMonth.month).toBe(now.getMonth() + 1);
      expect(result.loans.activeCount).toBe(10);
    });
  });
```

- [ ] **Step 2: Run new tests — expect FAIL**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage --testNamePattern="getExitClearanceReport|getDashboardStats"
```
Expected: FAIL

- [ ] **Step 3: Append staff + dashboard methods**

Append inside the `ReportsService` class:

```typescript
  async getExitClearanceReport(): Promise<IExitClearanceRow[]> {
    const exitedStaff = await this.staffModel
      .find({ status: { $in: [StaffStatus.Resigned, StaffStatus.Dismissed, StaffStatus.Deceased] } })
      .exec();

    if (exitedStaff.length === 0) return [];

    const rows: IExitClearanceRow[] = [];

    for (const staff of exitedStaff) {
      const sid = staff._id.toString();

      const activeLoans = await this.loanModel
        .find({ staffId: sid, status: LoanStatus.Active })
        .exec();

      let outstandingLoanBalance = 0;
      for (const loan of activeLoans) {
        const pending = await this.repaymentModel
          .find({
            loanId: loan._id.toString(),
            status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
          })
          .exec();
        outstandingLoanBalance += pending.reduce((s, r) => s + r.dueAmount - r.paidAmount, 0);
      }

      const missedAgg = await this.contribModel
        .aggregate([
          {
            $match: {
              staffId: sid,
              status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] },
              isDebit: { $ne: true },
            },
          },
          { $count: 'count' },
        ])
        .exec();

      rows.push({
        staffId: sid,
        staffName: staff.fullName,
        staffNo: staff.staffId,
        status: staff.status,
        outstandingLoanBalance: Math.round(outstandingLoanBalance * 100) / 100,
        missedContributionsCount: missedAgg[0]?.count ?? 0,
        activeLoanIds: activeLoans.map(l => l._id.toString()),
      });
    }

    return rows.filter(r => r.outstandingLoanBalance > 0 || r.missedContributionsCount > 0);
  }

  async getDashboardStats(): Promise<IDashboardStats> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // This month contributions
    const contribAgg = await this.contribModel
      .aggregate([
        { $match: { month, year, isDebit: { $ne: true } } },
        {
          $group: {
            _id: null,
            collected: { $sum: '$paidAmount' },
            expected: { $sum: '$expectedAmount' },
          },
        },
      ])
      .exec();
    const collected = contribAgg[0]?.collected ?? 0;
    const expected = contribAgg[0]?.expected ?? 0;
    const collectionRate = expected > 0 ? Math.round((collected / expected) * 100) : 0;

    // Loan status distribution
    const loanStatusAgg = await this.loanModel
      .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      .exec();
    const loanStatusDistribution = loanStatusAgg.map(a => ({ status: a._id, count: a.count }));
    const activeEntry = loanStatusDistribution.find(d => d.status === LoanStatus.Active);
    const activeCount = activeEntry?.count ?? 0;

    // Total outstanding for active loans
    const outstandingAgg = await this.repaymentModel
      .aggregate([
        { $match: { status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] } } },
        { $group: { _id: null, total: { $sum: { $subtract: ['$dueAmount', '$paidAmount'] } } } },
      ])
      .exec();
    const totalOutstanding = Math.round((outstandingAgg[0]?.total ?? 0) * 100) / 100;

    // Overdue count
    const overdueInstalments = await this.repaymentModel
      .find({ status: LoanRepaymentStatus.Overdue })
      .exec();

    // Members in arrears (this month)
    const arrearsAgg = await this.contribModel
      .aggregate([
        { $match: { month, year, status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] }, isDebit: { $ne: true } } },
        { $group: { _id: '$staffId' } },
        { $count: 'count' },
      ])
      .exec();
    const membersInArrears = arrearsAgg[0]?.count ?? 0;

    // Monthly trend (last 12 months)
    const months: Array<{ year: number; month: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const monthlyTrend = await Promise.all(
      months.map(async ({ year: y, month: m }) => {
        const agg = await this.contribModel
          .aggregate([
            { $match: { year: y, month: m, isDebit: { $ne: true } } },
            { $group: { _id: null, collected: { $sum: '$paidAmount' }, expected: { $sum: '$expectedAmount' } } },
          ])
          .exec();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return {
          year: y,
          month: m,
          label: `${monthNames[m - 1]} ${y}`,
          collected: agg[0]?.collected ?? 0,
          expected: agg[0]?.expected ?? 0,
        };
      }),
    );

    // Upcoming payments (next 7 days)
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const upcoming = await this.repaymentModel
      .find({
        dueDate: { $gte: now, $lte: weekFromNow },
        status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] },
      })
      .sort({ dueDate: 1 })
      .limit(5)
      .exec();

    const upcomingStaffIds = [...new Set(upcoming.map(r => r.staffId))];
    const upcomingStaff = await this.staffModel.find({ _id: { $in: upcomingStaffIds } }).exec();
    const upcomingStaffMap = new Map(upcomingStaff.map(s => [s._id.toString(), s]));

    const upcomingPayments = upcoming.map(r => ({
      loanId: r.loanId,
      staffName: upcomingStaffMap.get(r.staffId)?.fullName ?? 'Unknown',
      dueDate: r.dueDate.toISOString(),
      dueAmount: r.dueAmount - r.paidAmount,
      instalmentNumber: r.instalmentNumber,
    }));

    // Recent flagged import batches
    const flaggedBatches = await this.batchModel
      .find({ flaggedRows: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();

    const recentFlaggedBatches = flaggedBatches.map(b => ({
      batchId: b._id.toString(),
      month: b.month,
      year: b.year,
      flaggedRows: b.flaggedRows,
      fileName: b.fileName,
      uploadedAt: (b as any).createdAt?.toISOString() ?? '',
    }));

    return {
      thisMonth: { year, month, collected, expected, collectionRate },
      loans: { activeCount, totalOutstanding },
      overdueInstalments: overdueInstalments.length,
      membersInArrears,
      monthlyTrend,
      loanStatusDistribution,
      upcomingPayments,
      recentFlaggedBatches,
    };
  }
```

Close the class with `}` at the end of the file.

- [ ] **Step 4: Run all reports service tests**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(reports): staff exit clearance and dashboard stats methods"
```

---

## Task 7: PDF + CSV Generation

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts` (append PDF/CSV helpers)

- [ ] **Step 1: Write test for CSV generation**

Append to `reports.service.spec.ts` inside the describe block:

```typescript
  describe('generateCsv', () => {
    it('returns CSV string with headers', async () => {
      const data = [{ name: 'Alice', amount: 100 }, { name: 'Bob', amount: 200 }];
      const csv = await service.generateCsv(data, ['name', 'amount']);
      expect(csv).toContain('name');
      expect(csv).toContain('Alice');
      expect(csv).toContain('200');
    });
  });
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage --testNamePattern="generateCsv"
```
Expected: FAIL

- [ ] **Step 3: Add PDF + CSV methods to reports.service.ts**

Add at the top of the file (with other imports):
```typescript
import puppeteer from 'puppeteer';
import { parse as toCsv } from 'json2csv';
```

Append inside the `ReportsService` class:

```typescript
  async generateCsv(data: object[], fields: string[]): Promise<string> {
    return toCsv(data, { fields });
  }

  async generatePdf(
    title: string,
    columns: Array<{ header: string; field: string }>,
    rows: object[],
  ): Promise<Buffer> {
    const headers = columns.map(c => `<th>${c.header}</th>`).join('');
    const bodyRows = rows
      .map(row => {
        const cells = columns
          .map(c => `<td>${(row as Record<string, unknown>)[c.field] ?? ''}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e40af; color: white; padding: 6px 8px; text-align: left; font-size: 11px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  tr:nth-child(even) td { background: #f9fafb; }
</style>
</head>
<body>
<h1>${title}</h1>
<div class="meta">Generated: ${new Date().toLocaleString('en-GB')}</div>
<table>
  <thead><tr>${headers}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
```

- [ ] **Step 4: Run CSV test — expect PASS**

```bash
cd apps/api && npx jest src/reports/reports.service.spec.ts --no-coverage
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(reports): add PDF (puppeteer) and CSV (json2csv) generation helpers"
```

---

## Task 8: Reports Controller + Module + AppModule

**Files:**
- Create: `apps/api/src/reports/reports.controller.ts`
- Create: `apps/api/src/reports/reports.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create reports controller**

Create `apps/api/src/reports/reports.controller.ts`:

```typescript
import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

const CSV_COLUMNS = {
  monthlyContributions: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Expected (GHS)', field: 'expectedAmount' },
    { header: 'Paid (GHS)', field: 'paidAmount' },
    { header: 'Surplus C/F', field: 'surplusCarriedForward' },
    { header: 'Status', field: 'status' },
  ],
  arrears: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Month', field: 'month' },
    { header: 'Year', field: 'year' },
    { header: 'Expected (GHS)', field: 'expectedAmount' },
    { header: 'Paid (GHS)', field: 'paidAmount' },
    { header: 'Shortfall (GHS)', field: 'shortfall' },
    { header: 'Status', field: 'status' },
  ],
  activeLoans: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Guarantor', field: 'guarantorName' },
    { header: 'Principal (GHS)', field: 'principalAmount' },
    { header: 'Outstanding (GHS)', field: 'outstandingBalance' },
    { header: 'Disbursed', field: 'disbursedDate' },
  ],
  overdueLoans: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Instalment #', field: 'instalmentNumber' },
    { header: 'Due Date', field: 'dueDate' },
    { header: 'Due (GHS)', field: 'dueAmount' },
    { header: 'Paid (GHS)', field: 'paidAmount' },
    { header: 'Penalty (GHS)', field: 'penaltyAmount' },
    { header: 'Days Overdue', field: 'daysOverdue' },
  ],
  badDebt: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Principal (GHS)', field: 'principalAmount' },
    { header: 'Exit Deduction (GHS)', field: 'exitDeductionAmount' },
    { header: 'Guarantor Offset (GHS)', field: 'guarantorOffsetAmount' },
    { header: 'Bad Debt (GHS)', field: 'badDebtAmount' },
    { header: 'Settled At', field: 'settledAt' },
  ],
  exitClearance: [
    { header: 'Staff Name', field: 'staffName' },
    { header: 'Staff No', field: 'staffNo' },
    { header: 'Status', field: 'status' },
    { header: 'Outstanding Loans (GHS)', field: 'outstandingLoanBalance' },
    { header: 'Missed Contributions', field: 'missedContributionsCount' },
  ],
};

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  getDashboard() {
    return this.reportsService.getDashboardStats();
  }

  @Get('contributions/monthly')
  async getMonthlyContributions(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const now = new Date();
    const month = q.month ?? now.getMonth() + 1;
    const year = q.year ?? now.getFullYear();
    const report = await this.reportsService.getMonthlyContributions(month, year);

    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="contributions-${year}-${month}.csv"`);
      return this.reportsService.generateCsv(report.rows, CSV_COLUMNS.monthlyContributions.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf(
        `Contributions Monthly Report — ${month}/${year}`,
        CSV_COLUMNS.monthlyContributions,
        report.rows,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="contributions-${year}-${month}.pdf"`);
      res.end(pdf);
      return;
    }
    return report;
  }

  @Get('contributions/arrears')
  async getArrears(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const now = new Date();
    const fromMonth = q.fromMonth ?? 1;
    const fromYear = q.fromYear ?? now.getFullYear();
    const toMonth = q.toMonth ?? now.getMonth() + 1;
    const toYear = q.toYear ?? now.getFullYear();
    const rows = await this.reportsService.getArrearsReport(fromMonth, fromYear, toMonth, toYear);

    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="arrears.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.arrears.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf('Contribution Arrears Report', CSV_COLUMNS.arrears, rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="arrears.pdf"');
      res.end(pdf);
      return;
    }
    return rows;
  }

  @Get('contributions/guarantor-offsets')
  async getGuarantorOffsets(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getGuarantorOffsets();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="guarantor-offsets.csv"');
      return this.reportsService.generateCsv(rows, ['guarantorName', 'borrowerName', 'loanId', 'instalmentNumber', 'offsetAmount', 'offsetDate']);
    }
    return rows;
  }

  @Get('loans/active')
  async getActiveLoans(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getActiveLoans();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="active-loans.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.activeLoans.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf('Active Loans Report', CSV_COLUMNS.activeLoans, rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="active-loans.pdf"');
      res.end(pdf);
      return;
    }
    return rows;
  }

  @Get('loans/overdue')
  async getOverdueLoans(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getOverdueLoans();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="overdue-loans.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.overdueLoans.map(c => c.field));
    }
    return rows;
  }

  @Get('loans/repaid')
  async getRepaidLoans(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getRepaidLoans();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="repaid-loans.csv"');
      return this.reportsService.generateCsv(rows, ['staffName', 'principalAmount', 'totalRepayable', 'disbursedDate', 'settledAt', 'tenureMonths']);
    }
    return rows;
  }

  @Get('loans/guarantor-exposure')
  getGuarantorExposure() {
    return this.reportsService.getGuarantorExposure();
  }

  @Get('loans/bad-debt')
  async getBadDebt(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getBadDebt();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="bad-debt.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.badDebt.map(c => c.field));
    }
    return rows;
  }

  @Get('staff/exit')
  async getExitClearance(@Query() q: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.reportsService.getExitClearanceReport();
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="exit-clearance.csv"');
      return this.reportsService.generateCsv(rows, CSV_COLUMNS.exitClearance.map(c => c.field));
    }
    if (q.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf('Staff Exit Clearance Report', CSV_COLUMNS.exitClearance, rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="exit-clearance.pdf"');
      res.end(pdf);
      return;
    }
    return rows;
  }
}
```

- [ ] **Step 2: Create reports module**

Create `apps/api/src/reports/reports.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { Contribution, ContributionSchema } from '../contributions/schemas/contribution.schema';
import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
import { LoanRepayment, LoanRepaymentSchema } from '../loans/schemas/loan-repayment.schema';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { ImportBatch, ImportBatchSchema } from '../contributions/schemas/import-batch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contribution.name, schema: ContributionSchema },
      { name: Loan.name, schema: LoanSchema },
      { name: LoanRepayment.name, schema: LoanRepaymentSchema },
      { name: Staff.name, schema: StaffSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

- [ ] **Step 3: Register in AppModule**

Open `apps/api/src/app.module.ts`. Add import and registration:

```typescript
import { ReportsModule } from './reports/reports.module';
```

Add `ReportsModule` to the `imports` array after `LoansModule`.

- [ ] **Step 4: Type-check**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Run all reports tests**

```bash
cd apps/api && npx jest src/reports/ --no-coverage
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports/ apps/api/src/app.module.ts
git commit -m "feat(reports): controller, module, AppModule registration — all 10 report endpoints"
```

---

## Task 9: Web Reports API Client

**Files:**
- Create: `apps/web/src/lib/reports.ts`

- [ ] **Step 1: Create reports API client**

Create `apps/web/src/lib/reports.ts`:

```typescript
import apiClient from './api-client';
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
} from '@welfare/shared';

export async function getDashboardStats(): Promise<IDashboardStats> {
  const { data } = await apiClient.get<IDashboardStats>('/reports/dashboard');
  return data;
}

export async function getMonthlyContributions(month: number, year: number): Promise<IMonthlyContributionReport> {
  const { data } = await apiClient.get<IMonthlyContributionReport>(
    `/reports/contributions/monthly?month=${month}&year=${year}`,
  );
  return data;
}

export async function getArrearsReport(
  fromMonth: number, fromYear: number, toMonth: number, toYear: number,
): Promise<IArrearRow[]> {
  const { data } = await apiClient.get<IArrearRow[]>(
    `/reports/contributions/arrears?fromMonth=${fromMonth}&fromYear=${fromYear}&toMonth=${toMonth}&toYear=${toYear}`,
  );
  return data;
}

export async function getGuarantorOffsets(): Promise<IGuarantorOffsetRow[]> {
  const { data } = await apiClient.get<IGuarantorOffsetRow[]>('/reports/contributions/guarantor-offsets');
  return data;
}

export async function getActiveLoans(): Promise<IActiveLoanRow[]> {
  const { data } = await apiClient.get<IActiveLoanRow[]>('/reports/loans/active');
  return data;
}

export async function getOverdueLoans(): Promise<IOverdueLoanRow[]> {
  const { data } = await apiClient.get<IOverdueLoanRow[]>('/reports/loans/overdue');
  return data;
}

export async function getRepaidLoans(): Promise<IRepaidLoanRow[]> {
  const { data } = await apiClient.get<IRepaidLoanRow[]>('/reports/loans/repaid');
  return data;
}

export async function getGuarantorExposure(): Promise<IGuarantorExposureRow[]> {
  const { data } = await apiClient.get<IGuarantorExposureRow[]>('/reports/loans/guarantor-exposure');
  return data;
}

export async function getBadDebt(): Promise<IBadDebtRow[]> {
  const { data } = await apiClient.get<IBadDebtRow[]>('/reports/loans/bad-debt');
  return data;
}

export async function getExitClearance(): Promise<IExitClearanceRow[]> {
  const { data } = await apiClient.get<IExitClearanceRow[]>('/reports/staff/exit');
  return data;
}

export function getReportDownloadUrl(path: string, format: 'pdf' | 'csv', params?: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const qs = params ? `${params}&format=${format}` : `format=${format}`;
  return `${base}${path}?${qs}`;
}
```

- [ ] **Step 2: Type-check web**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/reports.ts
git commit -m "feat(web): reports API client"
```

---

## Task 10: Dashboard Page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard-client.tsx`

- [ ] **Step 1: Replace dashboard page server component**

Replace contents of `apps/web/src/app/(dashboard)/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { Suspense } from 'react';
import DashboardClient from './dashboard-client';

export const metadata: Metadata = { title: 'Dashboard — Welfare System' };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <Suspense fallback={<div className="text-gray-500 text-sm">Loading dashboard…</div>}>
        <DashboardClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Create dashboard client component**

Create `apps/web/src/app/(dashboard)/dashboard-client.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { getDashboardStats } from '@/lib/reports';
import type { IDashboardStats } from '@welfare/shared';

const PIE_COLORS: Record<string, string> = {
  Active: '#3b82f6',
  Completed: '#22c55e',
  Settled: '#84cc16',
  Defaulted: '#ef4444',
  BadDebt: '#dc2626',
};

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-1">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function DashboardClient() {
  const { data, isLoading, error } = useQuery<IDashboardStats>({
    queryKey: ['reports', 'dashboard'],
    queryFn: getDashboardStats,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (error || !data) return <div className="text-sm text-red-600">Failed to load dashboard data.</div>;

  const collectionRateColor = data.thisMonth.collectionRate >= 80 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Contributions collected"
          value={`GHS ${fmt(data.thisMonth.collected)}`}
          sub={`of GHS ${fmt(data.thisMonth.expected)} expected`}
          accent={collectionRateColor}
        />
        <KpiCard
          label={`Collection rate — ${data.thisMonth.month}/${data.thisMonth.year}`}
          value={`${data.thisMonth.collectionRate}%`}
        />
        <KpiCard
          label="Active loans outstanding"
          value={`GHS ${fmt(data.loans.totalOutstanding)}`}
          sub={`${data.loans.activeCount} active loan${data.loans.activeCount !== 1 ? 's' : ''}`}
        />
        <KpiCard
          label="Overdue instalments"
          value={String(data.overdueInstalments)}
          accent={data.overdueInstalments > 0 ? 'text-red-600' : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Members in arrears"
          value={String(data.membersInArrears)}
          accent={data.membersInArrears > 0 ? 'text-amber-600' : undefined}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly Contributions — Last 12 Months</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.monthlyTrend} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number) => `GHS ${fmt(v)}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="expected" name="Expected" fill="#e5e7eb" radius={[2, 2, 0, 0]} />
              <Bar dataKey="collected" name="Collected" fill="#3b82f6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Loan Status Distribution</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={data.loanStatusDistribution}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ status, count }) => `${status}: ${count}`}
                labelLine={false}
              >
                {data.loanStatusDistribution.map(entry => (
                  <Cell key={entry.status} fill={PIE_COLORS[entry.status] ?? '#94a3b8'} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming payments */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Upcoming Loan Payments (7 days)</h2>
            <Link href="/reports" className="text-xs text-blue-600 hover:underline">View all</Link>
          </div>
          {data.upcomingPayments.length === 0 ? (
            <p className="text-xs text-gray-500">No upcoming payments.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Staff</th>
                  <th className="pb-2 font-medium">Due</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.upcomingPayments.map((p, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5">{p.staffName}</td>
                    <td className="py-1.5">{new Date(p.dueDate).toLocaleDateString('en-GB')}</td>
                    <td className="py-1.5 text-right">GHS {fmt(p.dueAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent flagged batches */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Recently Flagged Import Batches</h2>
            <Link href="/contributions" className="text-xs text-blue-600 hover:underline">Resolve</Link>
          </div>
          {data.recentFlaggedBatches.length === 0 ? (
            <p className="text-xs text-gray-500">No flagged entries.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">File</th>
                  <th className="pb-2 font-medium">Period</th>
                  <th className="pb-2 font-medium text-right">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFlaggedBatches.map((b, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5 max-w-[140px] truncate">{b.fileName}</td>
                    <td className="py-1.5">{b.month}/{b.year}</td>
                    <td className="py-1.5 text-right text-amber-600 font-medium">{b.flaggedRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check web**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/page.tsx apps/web/src/app/\(dashboard\)/dashboard-client.tsx
git commit -m "feat(web): dashboard page with KPIs, contribution bar chart, loan pie chart, upcoming payments table"
```

---

## Task 11: Reports Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/reports/page.tsx`
- Create: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

- [ ] **Step 1: Create reports server page**

Create `apps/web/src/app/(dashboard)/reports/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { Suspense } from 'react';
import ReportsClient from './reports-client';

export const metadata: Metadata = { title: 'Reports — Welfare System' };

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
        <ReportsClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Create reports client component**

Create `apps/web/src/app/(dashboard)/reports/reports-client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getMonthlyContributions,
  getArrearsReport,
  getGuarantorOffsets,
  getActiveLoans,
  getOverdueLoans,
  getRepaidLoans,
  getGuarantorExposure,
  getBadDebt,
  getExitClearance,
  getReportDownloadUrl,
} from '@/lib/reports';

type ReportId =
  | 'contributions-monthly'
  | 'contributions-arrears'
  | 'contributions-guarantor-offsets'
  | 'loans-active'
  | 'loans-overdue'
  | 'loans-repaid'
  | 'loans-guarantor-exposure'
  | 'loans-bad-debt'
  | 'staff-exit';

const REPORT_GROUPS = [
  {
    label: 'Contributions',
    items: [
      { id: 'contributions-monthly' as ReportId, label: 'Monthly Summary' },
      { id: 'contributions-arrears' as ReportId, label: 'Arrears Report' },
      { id: 'contributions-guarantor-offsets' as ReportId, label: 'Guarantor Offsets' },
    ],
  },
  {
    label: 'Loans',
    items: [
      { id: 'loans-active' as ReportId, label: 'Active Loans' },
      { id: 'loans-overdue' as ReportId, label: 'Overdue Payments' },
      { id: 'loans-repaid' as ReportId, label: 'Completed Loans' },
      { id: 'loans-guarantor-exposure' as ReportId, label: 'Guarantor Exposure' },
      { id: 'loans-bad-debt' as ReportId, label: 'Bad Debt' },
    ],
  },
  {
    label: 'Staff',
    items: [
      { id: 'staff-exit' as ReportId, label: 'Exit Clearance' },
    ],
  },
];

function fmt(n: number) {
  return new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function PrintButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 print:hidden"
    >
      Print
    </button>
  );
}

function ExportButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 print:hidden"
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}

// ──────────── MONTHLY CONTRIBUTIONS ────────────
function MonthlyContributionsPanel() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'contributions-monthly', month, year],
    queryFn: () => getMonthlyContributions(month, year),
  });

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-4 print:hidden">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="border border-gray-300 rounded text-sm px-2 py-1"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i).toLocaleString('en-GB', { month: 'long' })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Year</label>
          <input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-300 rounded text-sm px-2 py-1 w-24"
          />
        </div>
        <div className="flex gap-2">
          <ExportButton
            href={getReportDownloadUrl('/reports/contributions/monthly', 'csv', `month=${month}&year=${year}`)}
            label="Export CSV"
          />
          <ExportButton
            href={getReportDownloadUrl('/reports/contributions/monthly', 'pdf', `month=${month}&year=${year}`)}
            label="Export PDF"
          />
          <PrintButton onClick={() => window.print()} />
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Staff</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Staff No</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Expected (GHS)</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Paid (GHS)</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Surplus C/F</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600 border-b">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">{r.staffName}</td>
                    <td className="px-3 py-2 text-gray-500">{r.staffNo}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.expectedAmount)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.paidAmount)}</td>
                    <td className="px-3 py-2 text-right text-green-600">{fmt(r.surplusCarriedForward)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.status === 'Paid' ? 'bg-green-100 text-green-700' :
                        r.status === 'Partial' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right">{fmt(data.totalExpected)}</td>
                  <td className="px-3 py-2 text-right">{fmt(data.totalPaid)}</td>
                  <td className="px-3 py-2 text-right text-green-600">{fmt(data.totalSurplus)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ──────────── ARREARS REPORT ────────────
function ArrearsPanel() {
  const now = new Date();
  const [fromMonth, setFromMonth] = useState(1);
  const [fromYear, setFromYear] = useState(now.getFullYear());
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const [toYear, setToYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'arrears', fromMonth, fromYear, toMonth, toYear],
    queryFn: () => getArrearsReport(fromMonth, fromYear, toMonth, toYear),
  });

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-4 print:hidden">
        {[['From', fromMonth, setFromMonth, fromYear, setFromYear], ['To', toMonth, setToMonth, toYear, setToYear]].map(
          ([label, m, setM, y, setY]) => (
            <div key={label as string} className="flex gap-2 items-end">
              <span className="text-xs text-gray-500 mb-1">{label as string}</span>
              <select
                value={m as number}
                onChange={e => (setM as (v: number) => void)(Number(e.target.value))}
                className="border border-gray-300 rounded text-sm px-2 py-1"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}</option>
                ))}
              </select>
              <span className="text-xs text-gray-400">/</span>
              <input
                type="number"
                value={y as number}
                min={2000}
                max={2100}
                onChange={e => (setY as (v: number) => void)(Number(e.target.value))}
                className="border border-gray-300 rounded text-sm px-2 py-1 w-24"
              />
            </div>
          ),
        )}
        <ExportButton
          href={getReportDownloadUrl('/reports/contributions/arrears', 'csv', `fromMonth=${fromMonth}&fromYear=${fromYear}&toMonth=${toMonth}&toYear=${toYear}`)}
          label="Export CSV"
        />
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Staff</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600 border-b">Period</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Expected</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Paid</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 border-b">Shortfall</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600 border-b">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">{r.staffName} <span className="text-gray-400 text-xs">{r.staffNo}</span></td>
                  <td className="px-3 py-2 text-gray-500">{r.month}/{r.year}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.expectedAmount)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.paidAmount)}</td>
                  <td className="px-3 py-2 text-right text-red-600 font-medium">{fmt(r.shortfall)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'Partial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No arrears found.</p>}
        </div>
      )}
    </div>
  );
}

// ──────────── SIMPLE TABLE PANELS ────────────
function useSimpleReport<T>(id: ReportId, fetcher: () => Promise<T[]>) {
  return useQuery<T[]>({ queryKey: ['reports', id], queryFn: fetcher });
}

function ActiveLoansPanel() {
  const { data, isLoading } = useSimpleReport('loans-active', getActiveLoans);
  return (
    <div>
      <div className="flex justify-end mb-3 print:hidden">
        <ExportButton href={getReportDownloadUrl('/reports/loans/active', 'csv')} label="Export CSV" />
      </div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['Staff', 'Guarantor', 'Principal', 'Outstanding', 'Next Due', 'Next Amount', 'Disbursed'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 text-sm">
                  <td className="px-3 py-2">{r.staffName} <span className="text-gray-400 text-xs">{r.staffNo}</span></td>
                  <td className="px-3 py-2 text-gray-600">{r.guarantorName}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.principalAmount)}</td>
                  <td className="px-3 py-2 text-right font-medium text-blue-700">{fmt(r.outstandingBalance)}</td>
                  <td className="px-3 py-2">{r.nextDueDate ? new Date(r.nextDueDate).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.nextDueAmount != null ? fmt(r.nextDueAmount) : '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(r.disbursedDate).toLocaleDateString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No active loans.</p>}
        </div>
      )}
    </div>
  );
}

function OverdueLoansPanel() {
  const { data, isLoading } = useSimpleReport('loans-overdue', getOverdueLoans);
  return (
    <div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['Staff', 'Instalment #', 'Due Date', 'Due Amount', 'Paid', 'Penalty', 'Days Overdue'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className={`border-b border-gray-100 ${r.daysOverdue > 30 ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-3 py-2">{r.staffName}</td>
                  <td className="px-3 py-2 text-center">{r.instalmentNumber}</td>
                  <td className="px-3 py-2">{new Date(r.dueDate).toLocaleDateString('en-GB')}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dueAmount)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.paidAmount)}</td>
                  <td className="px-3 py-2 text-right text-red-600">{fmt(r.penaltyAmount)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.daysOverdue > 30 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.daysOverdue}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No overdue instalments.</p>}
        </div>
      )}
    </div>
  );
}

function BadDebtPanel() {
  const { data, isLoading } = useSimpleReport('loans-bad-debt', getBadDebt);
  return (
    <div>
      <div className="flex justify-end mb-3 print:hidden">
        <ExportButton href={getReportDownloadUrl('/reports/loans/bad-debt', 'csv')} label="Export CSV" />
      </div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['Staff', 'Principal', 'Exit Deduction', 'Guarantor Offset', 'Bad Debt', 'Settled'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">{r.staffName}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.principalAmount)}</td>
                  <td className="px-3 py-2 text-right text-green-700">{fmt(r.exitDeductionAmount)}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{fmt(r.guarantorOffsetAmount)}</td>
                  <td className="px-3 py-2 text-right text-red-700 font-medium">{fmt(r.badDebtAmount)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.settledAt ? new Date(r.settledAt).toLocaleDateString('en-GB') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No bad debt records.</p>}
        </div>
      )}
    </div>
  );
}

function RepaidLoansPanel() {
  const { data, isLoading } = useSimpleReport('loans-repaid', getRepaidLoans);
  return (
    <div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['Staff', 'Principal', 'Total Repayable', 'Tenure', 'Disbursed', 'Settled'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">{r.staffName}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.principalAmount)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.totalRepayable)}</td>
                  <td className="px-3 py-2 text-center">{r.tenureMonths}m</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(r.disbursedDate).toLocaleDateString('en-GB')}</td>
                  <td className="px-3 py-2 text-gray-500">{r.settledAt ? new Date(r.settledAt).toLocaleDateString('en-GB') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No completed loans.</p>}
        </div>
      )}
    </div>
  );
}

function GuarantorExposurePanel() {
  const { data, isLoading } = useSimpleReport('loans-guarantor-exposure', getGuarantorExposure);
  return (
    <div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['Guarantor', 'Staff No', 'Active Loans', 'Total Outstanding', 'Total Offset Given'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">{r.guarantorName}</td>
                  <td className="px-3 py-2 text-gray-500">{r.guarantorStaffNo}</td>
                  <td className="px-3 py-2 text-center">{r.activeLoansCount}</td>
                  <td className="px-3 py-2 text-right font-medium text-blue-700">{fmt(r.totalOutstanding)}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{fmt(r.totalOffsetAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No guarantor exposure data.</p>}
        </div>
      )}
    </div>
  );
}

function GuarantorOffsetsPanel() {
  const { data, isLoading } = useSimpleReport('contributions-guarantor-offsets', getGuarantorOffsets);
  return (
    <div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['Guarantor', 'Borrower', 'Loan', 'Instalment #', 'Amount Offset', 'Date'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">{r.guarantorName}</td>
                  <td className="px-3 py-2">{r.borrowerName}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs font-mono">{r.loanId}</td>
                  <td className="px-3 py-2 text-center">{r.instalmentNumber}</td>
                  <td className="px-3 py-2 text-right font-medium text-amber-700">{fmt(r.offsetAmount)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.offsetDate ? new Date(r.offsetDate).toLocaleDateString('en-GB') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No guarantor offsets recorded.</p>}
        </div>
      )}
    </div>
  );
}

function ExitClearancePanel() {
  const { data, isLoading } = useSimpleReport('staff-exit', getExitClearance);
  return (
    <div>
      <div className="flex justify-end mb-3 print:hidden">
        <ExportButton href={getReportDownloadUrl('/reports/staff/exit', 'csv')} label="Export CSV" />
      </div>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {['Staff', 'Staff No', 'Status', 'Outstanding Loan Balance', 'Missed Contributions'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">{r.staffName}</td>
                  <td className="px-3 py-2 text-gray-500">{r.staffNo}</td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-red-600">{fmt(r.outstandingLoanBalance)}</td>
                  <td className="px-3 py-2 text-center">{r.missedContributionsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="text-sm text-gray-500 py-4 text-center">No outstanding exit clearances.</p>}
        </div>
      )}
    </div>
  );
}

const PANELS: Record<ReportId, React.FC> = {
  'contributions-monthly': MonthlyContributionsPanel,
  'contributions-arrears': ArrearsPanel,
  'contributions-guarantor-offsets': GuarantorOffsetsPanel,
  'loans-active': ActiveLoansPanel,
  'loans-overdue': OverdueLoansPanel,
  'loans-repaid': RepaidLoansPanel,
  'loans-guarantor-exposure': GuarantorExposurePanel,
  'loans-bad-debt': BadDebtPanel,
  'staff-exit': ExitClearancePanel,
};

export default function ReportsClient() {
  const [active, setActive] = useState<ReportId>('contributions-monthly');
  const ActivePanel = PANELS[active];
  const activeLabel = REPORT_GROUPS.flatMap(g => g.items).find(i => i.id === active)?.label ?? '';

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <div className="w-52 shrink-0 space-y-4 print:hidden">
        {REPORT_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-1">{group.label}</p>
            {group.items.map(item => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  active === item.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Report Panel */}
      <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">{activeLabel}</h2>
          <span className="text-xs text-gray-400 print:block hidden">
            Generated: {new Date().toLocaleDateString('en-GB')}
          </span>
        </div>

        {/* Print header (hidden on screen) */}
        <div className="hidden print:block mb-6 border-b pb-4">
          <h1 className="text-xl font-bold">Welfare Management System</h1>
          <p className="text-sm text-gray-600">{activeLabel} — Generated {new Date().toLocaleDateString('en-GB')}</p>
        </div>

        <ActivePanel />
      </div>
    </div>
  );
}
```

Add to the bottom of `apps/web/src/app/(dashboard)/reports/reports-client.tsx`, inside a `<style>` block or as a separate CSS file — add print styles via Tailwind in the component (already included via `print:hidden` and `print:block` utility classes).

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/reports/
git commit -m "feat(web): reports page with sidebar, all 9 report panels, export CSV/PDF, print support"
```

---

## Final Verification

- [ ] **Run all API tests**

```bash
cd apps/api && npx jest --no-coverage
```
Expected: all previous tests pass + new reports tests pass

- [ ] **TypeScript check both apps**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```
Expected: no errors in either

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: Phase 6 — Reports Module complete (API + dashboard + reports pages)"
```
