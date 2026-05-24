# Fund Summary Report — Design Spec

**Date:** 2026-05-24
**Status:** Approved

## Overview

Add a "Fund Summary" panel as the first entry in the Reports page sidebar. Provides KPI cards and filterable detail tables covering contributions, loans, defaults, recovery, fund balance, and membership — all scoped to a user-selected period. Supports CSV and PDF export. Audience: finance/admin staff and management.

## Scope

New sidebar section in the existing Reports page (`/reports`). No new route or page. Follows existing panel pattern (filter bar → KPI cards → detail tables).

Reports not in scope: per-staff breakdowns (those exist already as Contribution Statement and Loan Statement).

## Period Filtering

Filter bar offers three modes toggled by the user:

- **Full Year** — `year` only; `fromMonth=1`, `toMonth=12` sent to API
- **Quarter** — `year` + Q1/Q2/Q3/Q4 buttons; maps to month ranges server-side (Q1=1–3, Q2=4–6, Q3=7–9, Q4=10–12)
- **Month Range** — `year` + `fromMonth` + `toMonth` selects (same UI pattern as existing ArrearsPanel)

Default on mount: Full Year, current year.

## API

### Endpoint

```
GET /api/reports/fund-summary
```

### Query Params

| Param | Type | Required | Notes |
|---|---|---|---|
| `year` | number | yes | |
| `fromMonth` | number | no | 1–12, default 1 |
| `toMonth` | number | no | 1–12, default 12 |
| `quarter` | 1\|2\|3\|4 | no | overrides fromMonth/toMonth if provided |

### DTO

New `FundSummaryQueryDto` in `apps/api/src/reports/dto/report-query.dto.ts`:

```ts
export class FundSummaryQueryDto {
  @IsInt() @Min(2000) year: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) fromMonth?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) toMonth?: number;
  @IsOptional() @IsInt() @Min(1) @Max(4) quarter?: number;
}
```

Quarter resolution happens in the service: Q1→(1,3), Q2→(4,6), Q3→(7,9), Q4→(10,12).

### Response Shape

New `IFundSummaryReport` interface added to `packages/shared/src/types/index.ts`:

```ts
export interface IFundSummaryReport {
  period: { year: number; fromMonth: number; toMonth: number };
  contributions: {
    totalExpected: number;
    totalCollected: number;
    collectionRate: number;        // percent, 0–100
    missedCount: number;
    partialCount: number;
  };
  loans: {
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
  };
  recovery: {
    totalRecovered: number;        // exitDeductionAmount + guarantorOffsetAmount on defaulted loans
    totalUnrecovered: number;      // badDebtAmount on defaulted loans
    recoveryRate: number;          // percent
  };
  fundBalance: {
    totalContributionsAllTime: number;
    totalDisbursedAllTime: number;
    netBalance: number;
  };
  membership: {
    activeCount: number;
    joinersInPeriod: number;
    exitsInPeriod: number;
  };
}
```

### Service Method

`ReportsService.getFundSummary(year, fromMonth, toMonth)` — five parallel aggregations via `Promise.all`:

1. **Contributions** — match `{ year, month: {$gte: fromMonth, $lte: toMonth}, isDebit: {$ne: true} }` → sum `expectedAmount`, `paidAmount`, count by status (Missed, Partial).
2. **Loans by status** — match loans where `disbursedDate` falls within period → group by `status`, sum `principalAmount`, count docs.
3. **Recovery** — match loans with `status` in [Defaulted, WrittenOff, BadDebt] disbursed in period → sum `exitDeductionAmount`, `guarantorOffsetAmount` (recovered), sum `badDebtAmount` (unrecovered).
4. **Fund balance** — two all-time queries (no period filter): total `paidAmount` from contributions (non-debit), total `principalAmount` from loans. `netBalance = contributions − disbursed`.
5. **Membership** — active staff count (`status=Active`); joiners = staff with `createdAt` in period; exits = staff with `status=Inactive` and `updatedAt` in period. Known limitation: `updatedAt` is used as a proxy for exit date since no dedicated `exitDate` field exists on the Staff schema — any status change to Inactive in the period is counted as an exit.

Controller adds four new routes:

```ts
@Get('fund-summary')
getFundSummary(@Query() dto: FundSummaryQueryDto): Promise<IFundSummaryReport>

@Get('fund-summary/contributions')
getFundSummaryContributions(@Query() dto: FundSummaryQueryDto & { format: 'csv' }): StreamableFile

@Get('fund-summary/loans')
getFundSummaryLoans(@Query() dto: FundSummaryQueryDto & { format: 'csv' | 'pdf' }): StreamableFile

@Get('fund-summary/defaults')
getFundSummaryDefaults(@Query() dto: FundSummaryQueryDto & { format: 'csv' | 'pdf' }): StreamableFile
```

The three export routes return flat arrays rendered as CSV (via `json2csv`) or PDF (via puppeteer), following the identical pattern used by existing export routes in `ReportsController`.

## Frontend

### New Files

- `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx` — panel component
- Client function `getFundSummary(params)` added to `apps/web/src/lib/reports.ts`

### Modified Files

- `apps/web/src/app/(dashboard)/reports/reports-client.tsx` — add `{ id: 'fund-summary', label: 'Fund Summary' }` at position 0 of `SECTIONS`; render `<FundSummaryPanel />` for that id
- `packages/shared/src/types/index.ts` — add `IFundSummaryReport`
- `apps/api/src/reports/dto/report-query.dto.ts` — add `FundSummaryQueryDto`
- `apps/api/src/reports/reports.service.ts` — add `getFundSummary()` method
- `apps/api/src/reports/reports.controller.ts` — add route

### Panel Layout

```
┌─ Filter bar ──────────────────────────────────────────────────┐
│  Year: [2026]   Mode: [Full Year] [Quarter] [Month Range]     │
│  (Quarter mode): [Q1] [Q2] [Q3] [Q4]                         │
│  (Month Range mode): From [Jan▾] To [Dec▾]                    │
└───────────────────────────────────────────────────────────────┘

┌─ KPI Cards (2 rows × 4 cols) ─────────────────────────────────┐
│  Contributions Collected │ Collection Rate %                   │
│  Net Fund Balance        │ Active Members                      │
│  ─────────────────────────────────────────────────────────── │
│  Loans Disbursed         │ Defaulted Loans                     │
│  Recovery Rate %         │ New Joiners / Exits                 │
└───────────────────────────────────────────────────────────────┘

┌─ Detail Tables (collapsible) ─────────────────────────────────┐
│  ▼ Contributions Breakdown    [CSV]                           │
│     Month | Expected | Collected | Missed | Partial           │
│                                                               │
│  ▼ Loans Breakdown            [CSV] [PDF]                     │
│     Status | Count | Total Amount                             │
│                                                               │
│  ▼ Defaulted Loans Detail     [CSV] [PDF]                     │
│     Staff | Principal | Recovered | Bad Debt | Settled At     │
└───────────────────────────────────────────────────────────────┘
```

KPI card icon colors: green for healthy metrics (high collection rate, positive balance), warning/danger for defaulted loans and low recovery rate.

Collapsible sections default to expanded. Toggle via chevron button on section header.

### Download

- Contributions Breakdown: `GET /api/reports/fund-summary/contributions?year=…&fromMonth=…&toMonth=…&format=csv`
- Loans Breakdown: same path with `format=csv|pdf`
- Defaulted Loans Detail: `GET /api/reports/fund-summary/defaults?…&format=csv|pdf`

These three sub-endpoints return the same data as the summary but as flat arrays suitable for tabular export. They follow the existing pattern in `ReportsController` (CSV via `json2csv`, PDF via puppeteer).

## Out of Scope

- Charts / trend lines (future iteration)
- Per-staff drill-down from summary (existing panels cover this)
- Real-time fund balance ledger
