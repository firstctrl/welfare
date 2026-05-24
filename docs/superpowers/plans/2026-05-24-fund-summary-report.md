# Fund Summary Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Fund Summary" panel to the Reports page that shows KPI cards and filterable detail tables for contributions, loans, defaults, recovery, fund balance, and membership — with CSV/PDF export.

**Architecture:** New `IFundSummaryReport` type in shared → `FundSummaryQueryDto` + `ReportsService.getFundSummary()` + 4 controller routes on the API → `getFundSummary()` client function + `FundSummaryPanel` React component on the web. The panel slots into the existing Reports sidebar as the first entry — no new pages or routes.

**Tech Stack:** NestJS (API), class-validator/class-transformer (DTOs), Mongoose aggregations, json2csv + puppeteer (exports), Next.js App Router + TanStack Query (frontend), existing `KpiCard`/`Card`/`Field`/`Button` UI primitives.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/shared/src/interfaces/report.interface.ts` | Add `IFundSummaryReport` type |
| Modify | `packages/shared/src/index.ts` | Export `IFundSummaryReport` |
| Modify | `apps/api/src/reports/dto/report-query.dto.ts` | Add `FundSummaryQueryDto` |
| Modify | `apps/api/src/reports/dto/report-query.dto.spec.ts` | Tests for `FundSummaryQueryDto` |
| Modify | `apps/api/src/reports/reports.service.ts` | Add `getFundSummary()` method |
| Modify | `apps/api/src/reports/reports.service.spec.ts` | Tests for `getFundSummary()` |
| Modify | `apps/api/src/reports/reports.controller.ts` | Add 4 new routes + CSV column defs |
| Modify | `apps/web/src/lib/reports.ts` | Add `getFundSummary()` client function |
| Create | `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx` | Panel component |
| Modify | `apps/web/src/app/(dashboard)/reports/reports-client.tsx` | Wire up new panel in sidebar |

---

## Task 1: Add `IFundSummaryReport` to shared types

**Files:**
- Modify: `packages/shared/src/interfaces/report.interface.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the interface**

Open `packages/shared/src/interfaces/report.interface.ts` and append at the end of the file (after the `ILoanStatement` interface):

```ts
export interface IFundSummaryContributions {
  totalExpected: number;
  totalCollected: number;
  collectionRate: number;
  missedCount: number;
  partialCount: number;
}

export interface IFundSummaryLoans {
  disbursedCount: number;
  disbursedAmount: number;
  activeCount: number;
  activeAmount: number;
  completedCount: number;
  completedAmount: number;
  defaultedCount: number;
  defaultedAmount: number;
  writtenOffCount: number;
  writtenOffAmount: number;
}

export interface IFundSummaryRecovery {
  totalRecovered: number;
  totalUnrecovered: number;
  recoveryRate: number;
}

export interface IFundSummaryBalance {
  totalContributionsAllTime: number;
  totalDisbursedAllTime: number;
  netBalance: number;
}

export interface IFundSummaryMembership {
  activeCount: number;
  joinersInPeriod: number;
  exitsInPeriod: number;
}

export interface IFundSummaryDefaultRow {
  loanId: string;
  staffName: string;
  principalAmount: number;
  totalRecovered: number;
  badDebtAmount: number;
  settledAt: string;
}

export interface IFundSummaryContributionBreakdownRow {
  month: number;
  year: number;
  totalExpected: number;
  totalCollected: number;
  missedCount: number;
  partialCount: number;
}

export interface IFundSummaryLoanBreakdownRow {
  status: string;
  count: number;
  totalAmount: number;
}

export interface IFundSummaryReport {
  period: { year: number; fromMonth: number; toMonth: number };
  contributions: IFundSummaryContributions;
  loans: IFundSummaryLoans;
  recovery: IFundSummaryRecovery;
  fundBalance: IFundSummaryBalance;
  membership: IFundSummaryMembership;
  contributionBreakdown: IFundSummaryContributionBreakdownRow[];
  loanBreakdown: IFundSummaryLoanBreakdownRow[];
  defaultDetails: IFundSummaryDefaultRow[];
}
```

- [ ] **Step 2: Export from shared index**

In `packages/shared/src/index.ts`, find the existing report type export block (lines 33–48) and add `IFundSummaryReport` and its sub-interfaces:

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
  IFundSummaryReport,
  IFundSummaryContributions,
  IFundSummaryLoans,
  IFundSummaryRecovery,
  IFundSummaryBalance,
  IFundSummaryMembership,
  IFundSummaryDefaultRow,
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
} from './interfaces/report.interface';
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/interfaces/report.interface.ts packages/shared/src/index.ts
git commit -m "feat(shared): add IFundSummaryReport type and sub-interfaces"
```

---

## Task 2: Add `FundSummaryQueryDto` with tests

**Files:**
- Modify: `apps/api/src/reports/dto/report-query.dto.ts`
- Modify: `apps/api/src/reports/dto/report-query.dto.spec.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/api/src/reports/dto/report-query.dto.spec.ts`. Add these tests after the existing `ReportQueryDto` describe block:

```ts
import { FundSummaryQueryDto } from './report-query.dto';

describe('FundSummaryQueryDto', () => {
  it('requires year', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, {});
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'year')).toBe(true);
  });

  it('accepts year only (fromMonth/toMonth/quarter optional)', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts year with quarter', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025, quarter: 2 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects quarter outside 1–4', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025, quarter: 5 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'quarter')).toBe(true);
  });

  it('rejects fromMonth outside 1–12', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025, fromMonth: 13 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'fromMonth')).toBe(true);
  });

  it('coerces string values to numbers', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: '2025', quarter: '1' });
    expect(dto.year).toBe(2025);
    expect(dto.quarter).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest reports/dto/report-query.dto.spec.ts --no-coverage
```

Expected: tests for `FundSummaryQueryDto` fail with "Cannot read properties of undefined" or similar — DTO class doesn't exist yet.

- [ ] **Step 3: Implement the DTO**

Open `apps/api/src/reports/dto/report-query.dto.ts` and append after the existing `ReportQueryDto` class:

```ts
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FundSummaryQueryDto {
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  fromMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  toMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  @Type(() => Number)
  quarter?: number;

  @IsOptional()
  @IsEnum(['json', 'pdf', 'csv'])
  format?: 'json' | 'pdf' | 'csv';
}
```

Note: you need to add `IsEnum` and `IsInt` to the existing import at the top of the file if not already present.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest reports/dto/report-query.dto.spec.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/dto/report-query.dto.ts apps/api/src/reports/dto/report-query.dto.spec.ts
git commit -m "feat(reports): add FundSummaryQueryDto with validation"
```

---

## Task 3: Implement `ReportsService.getFundSummary()` with tests

**Files:**
- Modify: `apps/api/src/reports/reports.service.spec.ts`
- Modify: `apps/api/src/reports/reports.service.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/reports/reports.service.spec.ts`, add a new describe block after the existing tests. The mock models at the top of the file already provide `mockContribAggregate`, `mockLoanAggregate`, `mockStaffFind`. Add this describe block:

```ts
describe('getFundSummary', () => {
  const year = 2025;
  const fromMonth = 1;
  const toMonth = 12;

  beforeEach(() => {
    // contributions aggregate: returns per-month breakdown rows
    mockContribAggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { month: 1, year: 2025, totalExpected: 5000, totalCollected: 4800, missedCount: 1, partialCount: 0 },
        { month: 2, year: 2025, totalExpected: 5000, totalCollected: 5000, missedCount: 0, partialCount: 0 },
      ]),
    });

    // loans aggregate: returns status groups
    mockLoanAggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { _id: 'Active',    count: 10, totalAmount: 50000 },
        { _id: 'Completed', count: 5,  totalAmount: 20000 },
        { _id: 'Defaulted', count: 2,  totalAmount: 8000  },
        { _id: 'WrittenOff', count: 1, totalAmount: 3000  },
      ]),
    });

    // staff find for active count and period joiners/exits
    mockStaffFind.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ _id: 'staff1' }, { _id: 'staff2' }]),
    });
  });

  it('returns period with resolved months', async () => {
    const result = await service.getFundSummary(year, fromMonth, toMonth);
    expect(result.period).toEqual({ year: 2025, fromMonth: 1, toMonth: 12 });
  });

  it('aggregates contribution totals from breakdown rows', async () => {
    const result = await service.getFundSummary(year, fromMonth, toMonth);
    expect(result.contributions.totalExpected).toBe(10000);
    expect(result.contributions.totalCollected).toBe(9800);
    expect(result.contributions.collectionRate).toBe(98);
    expect(result.contributions.missedCount).toBe(1);
  });

  it('aggregates loan counts and amounts by status', async () => {
    const result = await service.getFundSummary(year, fromMonth, toMonth);
    expect(result.loans.activeCount).toBe(10);
    expect(result.loans.activeAmount).toBe(50000);
    expect(result.loans.defaultedCount).toBe(2);
    expect(result.loans.defaultedAmount).toBe(8000);
  });

  it('computes collection rate as 0 when totalExpected is 0', async () => {
    mockContribAggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    const result = await service.getFundSummary(year, fromMonth, toMonth);
    expect(result.contributions.collectionRate).toBe(0);
  });

  it('returns empty breakdown arrays when no data', async () => {
    mockContribAggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    mockLoanAggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    const result = await service.getFundSummary(year, fromMonth, toMonth);
    expect(result.contributionBreakdown).toEqual([]);
    expect(result.loanBreakdown).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest reports/reports.service.spec.ts --no-coverage -t "getFundSummary"
```

Expected: FAIL — `service.getFundSummary is not a function`.

- [ ] **Step 3: Implement the service method**

Open `apps/api/src/reports/reports.service.ts`. Add the following import at the top (within the existing `@welfare/shared` import block):

```ts
import type {
  IFundSummaryReport,
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
  IFundSummaryDefaultRow,
} from '@welfare/shared';
```

Then add the method inside the `ReportsService` class, after the existing methods:

```ts
async getFundSummary(year: number, fromMonth: number, toMonth: number): Promise<IFundSummaryReport> {
  const periodStart = new Date(year, fromMonth - 1, 1);
  const periodEnd   = new Date(year, toMonth, 0, 23, 59, 59); // last day of toMonth

  const [contribRows, loanGroups, recoveryGroups, allTimeContribs, allTimeLoans, activeStaff, joiners, exits, defaultRows] =
    await Promise.all([
      // 1. Per-month contribution breakdown
      this.contribModel.aggregate([
        { $match: { year, month: { $gte: fromMonth, $lte: toMonth }, isDebit: { $ne: true } } },
        {
          $group: {
            _id: { month: '$month', year: '$year' },
            totalExpected:   { $sum: '$expectedAmount' },
            totalCollected:  { $sum: '$paidAmount' },
            missedCount:     { $sum: { $cond: [{ $eq: ['$status', 'Missed'] }, 1, 0] } },
            partialCount:    { $sum: { $cond: [{ $eq: ['$status', 'Partial'] }, 1, 0] } },
          },
        },
        { $sort: { '_id.month': 1 } },
      ]).exec(),

      // 2. Loan counts/amounts by status (disbursed in period)
      this.loanModel.aggregate([
        { $match: { disbursedDate: { $gte: periodStart, $lte: periodEnd } } },
        {
          $group: {
            _id: '$status',
            count:       { $sum: 1 },
            totalAmount: { $sum: '$principalAmount' },
          },
        },
      ]).exec(),

      // 3. Recovery from defaulted/written-off/bad-debt loans disbursed in period
      this.loanModel.aggregate([
        {
          $match: {
            disbursedDate: { $gte: periodStart, $lte: periodEnd },
            status: { $in: [LoanStatus.Defaulted, LoanStatus.WrittenOff, LoanStatus.BadDebt] },
          },
        },
        {
          $group: {
            _id: null,
            totalRecovered:   { $sum: { $add: ['$exitDeductionAmount', '$guarantorOffsetAmount'] } },
            totalUnrecovered: { $sum: '$badDebtAmount' },
          },
        },
      ]).exec(),

      // 4a. All-time total contributions collected (not debit)
      this.contribModel.aggregate([
        { $match: { isDebit: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } },
      ]).exec(),

      // 4b. All-time total loans disbursed
      this.loanModel.aggregate([
        { $group: { _id: null, total: { $sum: '$principalAmount' } } },
      ]).exec(),

      // 5a. Active staff count
      this.staffModel.find({ status: StaffStatus.Active }).select('_id').lean().exec(),

      // 5b. Joiners in period (createdAt within period)
      this.staffModel.find({ createdAt: { $gte: periodStart, $lte: periodEnd } }).select('_id').lean().exec(),

      // 5c. Exits in period (status=Inactive, updatedAt within period)
      this.staffModel.find({ status: StaffStatus.Inactive, updatedAt: { $gte: periodStart, $lte: periodEnd } }).select('_id').lean().exec(),

      // 6. Defaulted loan detail rows (for the detail table)
      this.loanModel.aggregate([
        {
          $match: {
            disbursedDate: { $gte: periodStart, $lte: periodEnd },
            status: { $in: [LoanStatus.Defaulted, LoanStatus.WrittenOff, LoanStatus.BadDebt] },
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
            loanId:         { $toString: '$_id' },
            staffName:      { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
            principalAmount: 1,
            totalRecovered: { $add: ['$exitDeductionAmount', '$guarantorOffsetAmount'] },
            badDebtAmount:  1,
            settledAt:      1,
          },
        },
        { $sort: { settledAt: -1 } },
      ]).exec(),
    ]);

  // ── Contribution summary ──
  const contributionBreakdown: IFundSummaryContributionBreakdownRow[] = contribRows.map((r: any) => ({
    month:          r._id.month,
    year:           r._id.year,
    totalExpected:  r.totalExpected,
    totalCollected: r.totalCollected,
    missedCount:    r.missedCount,
    partialCount:   r.partialCount,
  }));
  const totalExpected  = contributionBreakdown.reduce((s, r) => s + r.totalExpected, 0);
  const totalCollected = contributionBreakdown.reduce((s, r) => s + r.totalCollected, 0);
  const totalMissed    = contributionBreakdown.reduce((s, r) => s + r.missedCount, 0);
  const totalPartial   = contributionBreakdown.reduce((s, r) => s + r.partialCount, 0);
  const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

  // ── Loan summary ──
  const statusMap = new Map<string, { count: number; totalAmount: number }>(
    loanGroups.map((g: any) => [g._id, { count: g.count, totalAmount: g.totalAmount }]),
  );
  const ls = (status: string) => statusMap.get(status) ?? { count: 0, totalAmount: 0 };
  const loanBreakdown: IFundSummaryLoanBreakdownRow[] = loanGroups.map((g: any) => ({
    status:      g._id,
    count:       g.count,
    totalAmount: g.totalAmount,
  }));

  // ── Recovery ──
  const rec = recoveryGroups[0] ?? { totalRecovered: 0, totalUnrecovered: 0 };
  const totalRecovered   = rec.totalRecovered ?? 0;
  const totalUnrecovered = rec.totalUnrecovered ?? 0;
  const totalDefaulted   = totalRecovered + totalUnrecovered;
  const recoveryRate     = totalDefaulted > 0 ? Math.round((totalRecovered / totalDefaulted) * 100) : 0;

  // ── Fund balance ──
  const totalContributionsAllTime = allTimeContribs[0]?.total ?? 0;
  const totalDisbursedAllTime     = allTimeLoans[0]?.total ?? 0;

  // ── Default detail rows ──
  const defaultDetails: IFundSummaryDefaultRow[] = defaultRows.map((r: any) => ({
    loanId:          r.loanId,
    staffName:       r.staffName,
    principalAmount: r.principalAmount,
    totalRecovered:  r.totalRecovered ?? 0,
    badDebtAmount:   r.badDebtAmount ?? 0,
    settledAt:       r.settledAt ? new Date(r.settledAt).toISOString() : '',
  }));

  return {
    period: { year, fromMonth, toMonth },
    contributions: {
      totalExpected,
      totalCollected,
      collectionRate,
      missedCount:  totalMissed,
      partialCount: totalPartial,
    },
    loans: {
      disbursedCount:   loanGroups.reduce((s: number, g: any) => s + g.count, 0),
      disbursedAmount:  loanGroups.reduce((s: number, g: any) => s + g.totalAmount, 0),
      activeCount:      ls(LoanStatus.Active).count,
      activeAmount:     ls(LoanStatus.Active).totalAmount,
      completedCount:   ls(LoanStatus.Completed).count,
      completedAmount:  ls(LoanStatus.Completed).totalAmount,
      defaultedCount:   ls(LoanStatus.Defaulted).count,
      defaultedAmount:  ls(LoanStatus.Defaulted).totalAmount,
      writtenOffCount:  ls(LoanStatus.WrittenOff).count,
      writtenOffAmount: ls(LoanStatus.WrittenOff).totalAmount,
    },
    recovery: {
      totalRecovered,
      totalUnrecovered,
      recoveryRate,
    },
    fundBalance: {
      totalContributionsAllTime,
      totalDisbursedAllTime,
      netBalance: totalContributionsAllTime - totalDisbursedAllTime,
    },
    membership: {
      activeCount:      (activeStaff as any[]).length,
      joinersInPeriod:  (joiners as any[]).length,
      exitsInPeriod:    (exits as any[]).length,
    },
    contributionBreakdown,
    loanBreakdown,
    defaultDetails,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest reports/reports.service.spec.ts --no-coverage -t "getFundSummary"
```

Expected: all 5 `getFundSummary` tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(reports): add getFundSummary service method with tests"
```

---

## Task 4: Add controller routes

**Files:**
- Modify: `apps/api/src/reports/reports.controller.ts`

- [ ] **Step 1: Add CSV column definitions**

In `apps/api/src/reports/reports.controller.ts`, add to the `CSV_COLUMNS` object (before the closing `};` on line 67):

```ts
  fundSummaryContributions: [
    { header: 'Month',           field: 'month' },
    { header: 'Year',            field: 'year' },
    { header: 'Expected (GHS)',  field: 'totalExpected' },
    { header: 'Collected (GHS)', field: 'totalCollected' },
    { header: 'Missed',          field: 'missedCount' },
    { header: 'Partial',         field: 'partialCount' },
  ],
  fundSummaryLoans: [
    { header: 'Status',          field: 'status' },
    { header: 'Count',           field: 'count' },
    { header: 'Total (GHS)',     field: 'totalAmount' },
  ],
  fundSummaryDefaults: [
    { header: 'Staff Name',      field: 'staffName' },
    { header: 'Principal (GHS)', field: 'principalAmount' },
    { header: 'Recovered (GHS)', field: 'totalRecovered' },
    { header: 'Bad Debt (GHS)',  field: 'badDebtAmount' },
    { header: 'Settled At',      field: 'settledAt' },
  ],
```

- [ ] **Step 2: Add the import for `FundSummaryQueryDto`**

At the top of `apps/api/src/reports/reports.controller.ts`, update the DTO import:

```ts
import { ReportQueryDto, FundSummaryQueryDto } from './dto/report-query.dto';
```

- [ ] **Step 3: Add 4 new routes**

Append the following methods inside `ReportsController` (before the closing `}`), after the existing `getExitClearance` route:

```ts
@Get('fund-summary')
@RequirePermission(AppModule.Reports, 'readonly')
async getFundSummary(@Query() dto: FundSummaryQueryDto) {
  let fromMonth = dto.fromMonth ?? 1;
  let toMonth   = dto.toMonth ?? 12;
  if (dto.quarter) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    [fromMonth, toMonth] = quarterMap[dto.quarter];
  }
  return this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
}

@Get('fund-summary/contributions')
@RequirePermission(AppModule.Reports, 'readonly')
async getFundSummaryContributions(
  @Query() dto: FundSummaryQueryDto,
  @Res({ passthrough: true }) res: Response,
) {
  let fromMonth = dto.fromMonth ?? 1;
  let toMonth   = dto.toMonth ?? 12;
  if (dto.quarter) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    [fromMonth, toMonth] = quarterMap[dto.quarter];
  }
  const summary = await this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
  if (dto.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="fund-summary-contributions-${dto.year}.csv"`);
    return this.reportsService.generateCsv(
      summary.contributionBreakdown,
      CSV_COLUMNS.fundSummaryContributions.map(c => c.field),
    );
  }
  return summary.contributionBreakdown;
}

@Get('fund-summary/loans')
@RequirePermission(AppModule.Reports, 'readonly')
async getFundSummaryLoans(
  @Query() dto: FundSummaryQueryDto,
  @Res({ passthrough: true }) res: Response,
) {
  let fromMonth = dto.fromMonth ?? 1;
  let toMonth   = dto.toMonth ?? 12;
  if (dto.quarter) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    [fromMonth, toMonth] = quarterMap[dto.quarter];
  }
  const summary = await this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
  if (dto.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="fund-summary-loans-${dto.year}.csv"`);
    return this.reportsService.generateCsv(
      summary.loanBreakdown,
      CSV_COLUMNS.fundSummaryLoans.map(c => c.field),
    );
  }
  if (dto.format === 'pdf') {
    const pdf = await this.reportsService.generatePdf(
      `Fund Summary — Loans ${dto.year}`,
      CSV_COLUMNS.fundSummaryLoans,
      summary.loanBreakdown,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fund-summary-loans-${dto.year}.pdf"`);
    res.end(pdf);
    return;
  }
  return summary.loanBreakdown;
}

@Get('fund-summary/defaults')
@RequirePermission(AppModule.Reports, 'readonly')
async getFundSummaryDefaults(
  @Query() dto: FundSummaryQueryDto,
  @Res({ passthrough: true }) res: Response,
) {
  let fromMonth = dto.fromMonth ?? 1;
  let toMonth   = dto.toMonth ?? 12;
  if (dto.quarter) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    [fromMonth, toMonth] = quarterMap[dto.quarter];
  }
  const summary = await this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
  if (dto.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="fund-summary-defaults-${dto.year}.csv"`);
    return this.reportsService.generateCsv(
      summary.defaultDetails,
      CSV_COLUMNS.fundSummaryDefaults.map(c => c.field),
    );
  }
  if (dto.format === 'pdf') {
    const pdf = await this.reportsService.generatePdf(
      `Fund Summary — Defaulted Loans ${dto.year}`,
      CSV_COLUMNS.fundSummaryDefaults,
      summary.defaultDetails,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fund-summary-defaults-${dto.year}.pdf"`);
    res.end(pdf);
    return;
  }
  return summary.defaultDetails;
}
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the full reports test suite**

```bash
cd apps/api && npx jest reports/ --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports/reports.controller.ts
git commit -m "feat(reports): add fund-summary controller routes (summary + 3 export endpoints)"
```

---

## Task 5: Add web client function

**Files:**
- Modify: `apps/web/src/lib/reports.ts`

- [ ] **Step 1: Add the type import and client function**

Open `apps/web/src/lib/reports.ts`. In the import block from `@welfare/shared`, add `IFundSummaryReport`:

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
  IFundSummaryReport,
} from '@welfare/shared';
```

Then add the param interface and client function at the end of the file:

```ts
export interface FundSummaryParams {
  year: number;
  fromMonth?: number;
  toMonth?: number;
  quarter?: 1 | 2 | 3 | 4;
}

export async function getFundSummary(params: FundSummaryParams): Promise<IFundSummaryReport> {
  const { data } = await apiClient.get('/reports/fund-summary', { params });
  return data;
}

export function buildFundSummaryDownloadUrl(
  sub: 'contributions' | 'loans' | 'defaults',
  params: FundSummaryParams,
  format: 'csv' | 'pdf',
): string {
  const base = apiClient.defaults.baseURL ?? '';
  const q = new URLSearchParams({
    year: String(params.year),
    ...(params.fromMonth ? { fromMonth: String(params.fromMonth) } : {}),
    ...(params.toMonth   ? { toMonth:   String(params.toMonth)   } : {}),
    ...(params.quarter   ? { quarter:   String(params.quarter)   } : {}),
    format,
  });
  return `${base}/reports/fund-summary/${sub}?${q.toString()}`;
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/reports.ts
git commit -m "feat(reports): add getFundSummary client function and download URL helper"
```

---

## Task 6: Build the `FundSummaryPanel` component

**Files:**
- Create: `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx`

- [ ] **Step 1: Create the component file**

Create `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx` with the following content:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Banknote, TrendingUp, AlertCircle, BarChart3, Users, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { getFundSummary, buildFundSummaryDownloadUrl } from '@/lib/reports';
import type { FundSummaryParams } from '@/lib/reports';
import type {
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
  IFundSummaryDefaultRow,
} from '@welfare/shared';
import { KpiCard } from '@/components/ui/kpi-card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CUR_YEAR = new Date().getFullYear();

// ── Column defs ────────────────────────────────────────────────────────────────

const colContrib = createColumnHelper<IFundSummaryContributionBreakdownRow>();
const COLS_CONTRIB = [
  colContrib.accessor('month', { header: 'Month', cell: i => MONTHS[i.getValue() - 1] }),
  colContrib.accessor('year', { header: 'Year' }),
  colContrib.accessor('totalExpected',  { header: 'Expected (GHS)',  cell: i => fmtGHS(i.getValue()) }),
  colContrib.accessor('totalCollected', { header: 'Collected (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colContrib.accessor('missedCount',  { header: 'Missed' }),
  colContrib.accessor('partialCount', { header: 'Partial' }),
];

const colLoan = createColumnHelper<IFundSummaryLoanBreakdownRow>();
const COLS_LOANS = [
  colLoan.accessor('status',      { header: 'Status' }),
  colLoan.accessor('count',       { header: 'Count' }),
  colLoan.accessor('totalAmount', { header: 'Total (GHS)', cell: i => fmtGHS(i.getValue()) }),
];

const colDefault = createColumnHelper<IFundSummaryDefaultRow>();
const COLS_DEFAULTS = [
  colDefault.accessor('staffName',       { header: 'Staff Name' }),
  colDefault.accessor('principalAmount', { header: 'Principal (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colDefault.accessor('totalRecovered',  { header: 'Recovered (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colDefault.accessor('badDebtAmount',   { header: 'Bad Debt (GHS)',  cell: i => fmtGHS(i.getValue()) }),
  colDefault.accessor('settledAt',       { header: 'Settled At', cell: i => i.getValue() ? new Date(i.getValue()).toLocaleDateString('en-GB') : '—' }),
];

// ── Generic table ──────────────────────────────────────────────────────────────

function SummaryTable<T>({ columns, data }: { columns: any[]; data: T[] }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
              {hg.headers.map(h => (
                <th key={h.id} className="px-3 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-neutral-400">No data</td>
            </tr>
          ) : (
            table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-neutral-50">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-3 py-2 whitespace-nowrap text-neutral-700">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Collapsible section ────────────────────────────────────────────────────────

function Section({
  title,
  downloadLinks,
  children,
}: {
  title: string;
  downloadLinks?: { label: string; href: string }[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-neutral-200 rounded-md overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-neutral-50 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-neutral-400" /> : <ChevronRight size={14} className="text-neutral-400" />}
          <span className="text-sm font-semibold text-neutral-700">{title}</span>
        </div>
        {downloadLinks && (
          <div className="flex gap-2" onClick={e => e.stopPropagation()}>
            {downloadLinks.map(l => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm" Icon={Download}>{l.label}</Button>
              </a>
            ))}
          </div>
        )}
      </div>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

type FilterMode = 'full' | 'quarter' | 'range';

export function FundSummaryPanel() {
  const [year,       setYear]       = useState(CUR_YEAR);
  const [mode,       setMode]       = useState<FilterMode>('full');
  const [quarter,    setQuarter]    = useState<1|2|3|4>(1);
  const [fromMonth,  setFromMonth]  = useState(1);
  const [toMonth,    setToMonth]    = useState(12);

  const params: FundSummaryParams = {
    year,
    ...(mode === 'quarter' ? { quarter } : {}),
    ...(mode === 'range'   ? { fromMonth, toMonth } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['fund-summary', params],
    queryFn:  () => getFundSummary(params),
  });

  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 p-4 bg-neutral-50 border border-neutral-200 rounded-md">
        <Field label="Year">
          <Input type="number" value={year} onChange={e => setYear(+e.target.value)} style={{ width: 100 }} />
        </Field>

        <Field label="Period">
          <div className="flex gap-1">
            {(['full', 'quarter', 'range'] as FilterMode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 h-[var(--row-default)] rounded-sm text-sm font-medium border transition-colors',
                  mode === m
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100',
                )}
              >
                {m === 'full' ? 'Full Year' : m === 'quarter' ? 'Quarter' : 'Month Range'}
              </button>
            ))}
          </div>
        </Field>

        {mode === 'quarter' && (
          <Field label="Quarter">
            <div className="flex gap-1">
              {([1,2,3,4] as const).map(q => (
                <button
                  key={q}
                  onClick={() => setQuarter(q)}
                  className={cn(
                    'w-10 h-[var(--row-default)] rounded-sm text-sm font-medium border transition-colors',
                    quarter === q
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100',
                  )}
                >
                  Q{q}
                </button>
              ))}
            </div>
          </Field>
        )}

        {mode === 'range' && (
          <>
            <Field label="From">
              <Select value={String(fromMonth)} onChange={e => setFromMonth(+e.target.value)} options={monthOptions} style={{ width: 110 }} />
            </Field>
            <Field label="To">
              <Select value={String(toMonth)} onChange={e => setToMonth(+e.target.value)} options={monthOptions} style={{ width: 110 }} />
            </Field>
          </>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">Loading…</div>
      )}

      {data && (
        <>
          {/* KPI cards — row 1: contributions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Contributions Collected"
              value={fmtGHS(data.contributions.totalCollected)}
              subtext={`Expected: ${fmtGHS(data.contributions.totalExpected)}`}
              icon={Banknote}
              iconKind="success"
            />
            <KpiCard
              label="Collection Rate"
              value={`${data.contributions.collectionRate}%`}
              icon={BarChart3}
              iconKind={data.contributions.collectionRate >= 90 ? 'success' : data.contributions.collectionRate >= 70 ? 'warning' : 'danger'}
            />
            <KpiCard
              label="Net Fund Balance"
              value={fmtGHS(data.fundBalance.netBalance)}
              subtext={`Disbursed all-time: ${fmtGHS(data.fundBalance.totalDisbursedAllTime)}`}
              icon={TrendingUp}
              iconKind={data.fundBalance.netBalance >= 0 ? 'success' : 'danger'}
            />
            <KpiCard
              label="Active Members"
              value={String(data.membership.activeCount)}
              subtext={`+${data.membership.joinersInPeriod} joined · ${data.membership.exitsInPeriod} exited`}
              icon={Users}
              iconKind="primary"
            />
          </div>

          {/* KPI cards — row 2: loans */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Loans Disbursed"
              value={fmtGHS(data.loans.disbursedAmount)}
              subtext={`${data.loans.disbursedCount} loans`}
              icon={Banknote}
              iconKind="primary"
            />
            <KpiCard
              label="Defaulted Loans"
              value={fmtGHS(data.loans.defaultedAmount)}
              subtext={`${data.loans.defaultedCount} loans`}
              icon={AlertCircle}
              iconKind={data.loans.defaultedCount === 0 ? 'success' : 'danger'}
            />
            <KpiCard
              label="Recovery Rate"
              value={`${data.recovery.recoveryRate}%`}
              subtext={`Recovered: ${fmtGHS(data.recovery.totalRecovered)}`}
              icon={BarChart3}
              iconKind={data.recovery.recoveryRate >= 80 ? 'success' : data.recovery.recoveryRate >= 50 ? 'warning' : 'danger'}
            />
            <KpiCard
              label="Active Loans"
              value={fmtGHS(data.loans.activeAmount)}
              subtext={`${data.loans.activeCount} loans outstanding`}
              icon={TrendingUp}
              iconKind="warning"
            />
          </div>

          {/* Detail tables */}
          <div className="space-y-3">
            <Section
              title="Contributions Breakdown"
              downloadLinks={[
                { label: 'CSV', href: buildFundSummaryDownloadUrl('contributions', params, 'csv') },
              ]}
            >
              <SummaryTable columns={COLS_CONTRIB} data={data.contributionBreakdown} />
            </Section>

            <Section
              title="Loans Breakdown"
              downloadLinks={[
                { label: 'CSV', href: buildFundSummaryDownloadUrl('loans', params, 'csv') },
                { label: 'PDF', href: buildFundSummaryDownloadUrl('loans', params, 'pdf') },
              ]}
            >
              <SummaryTable columns={COLS_LOANS} data={data.loanBreakdown} />
            </Section>

            <Section
              title="Defaulted Loans Detail"
              downloadLinks={[
                { label: 'CSV', href: buildFundSummaryDownloadUrl('defaults', params, 'csv') },
                { label: 'PDF', href: buildFundSummaryDownloadUrl('defaults', params, 'pdf') },
              ]}
            >
              <SummaryTable columns={COLS_DEFAULTS} data={data.defaultDetails} />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/reports/fund-summary-panel.tsx
git commit -m "feat(reports): add FundSummaryPanel component"
```

---

## Task 7: Wire up panel in Reports page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

- [ ] **Step 1: Add the import**

At the top of `apps/web/src/app/(dashboard)/reports/reports-client.tsx`, add:

```ts
import { FundSummaryPanel } from './fund-summary-panel';
```

- [ ] **Step 2: Add to SECTIONS**

Find the `SECTIONS` array (around line 990). Add the new entry at position 0:

```ts
const SECTIONS = [
  { id: 'fund-summary',    label: 'Fund Summary' },
  { id: 'monthly-contrib', label: 'Contribution Statement' },
  { id: 'bulk-statements', label: 'Bulk Statements' },
  // ... rest unchanged
];
```

- [ ] **Step 3: Render the panel**

In the panel render block (after `{active === 'monthly-contrib' && ...}`), add before it:

```tsx
{active === 'fund-summary' && <FundSummaryPanel />}
```

- [ ] **Step 4: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/reports/reports-client.tsx
git commit -m "feat(reports): wire FundSummaryPanel into Reports sidebar as first entry"
```

---

## Task 8: End-to-end smoke test

- [ ] **Step 1: Start the API**

```bash
cd apps/api && npm run start:dev
```

- [ ] **Step 2: Start the web app**

```bash
cd apps/web && npm run dev
```

- [ ] **Step 3: Verify the panel loads**

Open `http://localhost:3000/reports`. Confirm:
- "Fund Summary" is the first entry in the sidebar
- Clicking it renders the filter bar and KPI card skeletons (then data)
- Changing year / period mode updates the data
- Changing to Quarter mode shows Q1–Q4 buttons
- Changing to Month Range mode shows from/to selects
- KPI cards render with correct labels and colours
- All 3 detail tables expand/collapse via chevron
- CSV download links work (file downloads)
- PDF download links work for Loans and Defaults

- [ ] **Step 4: Commit any fixes found during testing**

```bash
git add -p
git commit -m "fix(reports): address issues found in fund summary smoke test"
```
