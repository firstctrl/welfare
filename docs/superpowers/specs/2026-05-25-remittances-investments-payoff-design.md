# Design Spec: Remittances, Investments, Loan Pay-Off, Payment Reminder, Discount Reporting

**Date:** 2026-05-25  
**Stack:** NestJS (API) · Next.js 14 (Web) · MongoDB/Mongoose · BullMQ · @nestjs/schedule

---

## 1. Shared Foundations

### 1.1 AppModule enum (`packages/shared/src/enums/app-module.enum.ts`)

Add:
```ts
Remittances = 'remittances'
Investments = 'investments'
```

### 1.2 ConfigKey enum (`packages/shared/src/enums/config-key.enum.ts`)

Add:
```ts
RemittanceChargeRate   = 'REMITTANCE_CHARGE_RATE'    // default "3" (percent)
LoanPayOffDiscountRate = 'LOAN_PAYOFF_DISCOUNT_RATE' // default "5" (percent)
```

Both seeded via the existing SystemConfig seed/settings UI.

### 1.3 EmailLogType enum

Add:
```ts
LoanPaymentReminder = 'loan_payment_reminder'
```

### 1.4 Shared interfaces (`packages/shared/src/interfaces/report.interface.ts`)

Add:

```ts
// Remittances
export interface IRemittanceReportRow {
  period: string;        // e.g. "Oct 2025"
  receiptDate: string;   // dd/mm/yyyy
  grossAmount: number;
  charges: number;
  netPayable: number;
}
export interface IRemittanceReport {
  rows: IRemittanceReportRow[];
  totalGross: number;
  totalCharges: number;
  totalNet: number;
}

// Investments
export interface IInvestmentRow {
  id: string;
  purchaseDate: string;
  description: string;
  cost: number;
  maturityDate: string;
  faceValue: number;
  interest: number;
  rate: number;
  status: 'Active' | 'Matured';
  instruction: 'One-Time' | 'Roll-Over';
}

// Pay-off preview
export interface IPayOffPreview {
  principal: number;
  totalInterest: number;
  alreadyPaid: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discountApplied: boolean;
  discountRate: number;
  discountAmount: number;
  netPayable: number;
  tier: 1 | 2;
  withinDiscountWindow: boolean;
}

// Discount records
export interface IDiscountRecord {
  id: string;
  staffId: string;
  staffName: string;
  loanId: string;
  discountType: 'Origination' | 'PayOff';
  discountRate: number;
  discountAmount: number;
  dateGranted: string;
  cancelled: boolean;
}

// Fund summary additions
export interface IFundSummaryDiscountRow {
  staffName: string;
  loanReference: string;
  discountType: 'Origination' | 'PayOff';
  rate: number;
  amount: number;
  dateGranted: string;
}
```

Update `IFundSummaryReport`:
```ts
totalDiscountsGiven: number;                       // all-time KPI
discountBreakdown: IFundSummaryDiscountRow[];      // period breakdown
```

### 1.5 Sidebar (`apps/web/src/components/nav/sidebar.tsx`)

Add nav items between Loans and Reports:
```ts
{ href: '/remittances', label: 'Remittances', icon: Receipt,    matchPrefix: true, module: AppModule.Remittances }
{ href: '/investments', label: 'Investments', icon: TrendingUp, matchPrefix: true, module: AppModule.Investments }
```

---

## 2. Remittances Module

### 2.1 Schema (`apps/api/src/remittances/schemas/remittance.schema.ts`)

Collection: `remittances`

| Field          | Type    | Notes                                      |
|----------------|---------|--------------------------------------------|
| month          | number  | 1–12                                       |
| year           | number  | ≥ 2000                                     |
| grossAmount    | number  | Snapshotted from contributions at save time |
| chargeRate     | number  | % from `ConfigKey.RemittanceChargeRate` at entry |
| charges        | number  | `grossAmount × chargeRate / 100`           |
| netPayable     | number  | `grossAmount − charges`                    |
| receiptDate    | Date    |                                            |
| recordedBy     | string  |                                            |
| importBatchId  | string? |                                            |

Unique index: `{ month: 1, year: 1 }`.

### 2.2 Import Batch Schema (`apps/api/src/remittances/schemas/remittance-import-batch.schema.ts`)

Same structure as `ImportBatch` — fields: `fileName`, `status`, `total`, `matched`, `flagged`, `rows`, `recordedBy`.

### 2.3 Module files

```
apps/api/src/remittances/
  remittances.module.ts
  remittances.service.ts
  remittances.import.service.ts
  remittances.controller.ts
  schemas/remittance.schema.ts
  schemas/remittance-import-batch.schema.ts
  dto/create-remittance.dto.ts
  dto/remittance-query.dto.ts
```

### 2.4 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/remittances/gross` | `?month=&year=` → `{ grossAmount, charges, netPayable }` |
| GET | `/remittances` | Paginated list |
| POST | `/remittances` | Create manual entry |
| POST | `/remittances/import` | Bulk XLSX upload |
| GET | `/remittances/report` | `?fromMonth=&fromYear=&toMonth=&toYear=` |
| GET | `/remittances/report/export` | `?format=csv\|pdf&...` |

`/remittances/gross` queries `contributions` collection: `sum(paidAmount)` where `month=X`, `year=Y`, `isDebit ≠ true`.

**Duplicate on import:** Flag the row; do not silently skip. The import batch `rows` array records a `flagReason: 'Duplicate period'`.

### 2.5 XLSX Import Columns

| Column | Required |
|--------|----------|
| Month | Yes (1–12) |
| Year | Yes |
| Receipt Date | Yes (dd/mm/yyyy) |

`grossAmount`, `charges`, `netPayable` are computed server-side from live contribution data at import time.

### 2.6 Report

- Filter-first: no data shown until user clicks **Run Report**
- Validation: `toMonth/Year` must not precede `fromMonth/Year` — enforced in UI before request
- Columns: Period · Receipt Date · Gross Amount · Charges (3%) · Net Payable
- Export: PDF (with watermark) and CSV — same `generatePdf` / `parse(json2csv)` pattern

### 2.7 Frontend pages

```
apps/web/src/app/(dashboard)/remittances/
  page.tsx                  — list page
  remittances-list-client.tsx
  manual/page.tsx
  manual/manual-entry-client.tsx
  import/page.tsx
  import/import-client.tsx
```

Report panel added to `reports-client.tsx` SECTIONS array: `{ id: 'remittances', label: 'Remittances' }`.

---

## 3. Investments Module

### 3.1 Schema (`apps/api/src/investments/schemas/investment.schema.ts`)

Collection: `investments`

| Field           | Type    | Notes                                       |
|-----------------|---------|---------------------------------------------|
| purchaseDate    | Date    |                                             |
| description     | string  |                                             |
| cost            | number  |                                             |
| maturityDate    | Date    |                                             |
| faceValue       | number  |                                             |
| interest        | number  | Snapshotted: `faceValue − cost`            |
| rate            | number  | Snapshotted: `(interest / cost) × 100`     |
| instruction     | enum    | `'One-Time' \| 'Roll-Over'`                |
| recordedBy      | string  |                                             |
| importBatchId   | string? |                                             |
| editHistory     | array   | `{ editedBy, editedAt, reason, snapshot }[]` |
| deletedAt       | Date?   | Soft-delete timestamp                       |
| deletedBy       | string? |                                             |
| deletionReason  | string? |                                             |

`status` is **not stored**. Computed at query time: `maturityDate <= new Date()` → `'Matured'`, else `'Active'`.

No uniqueness constraint.

### 3.2 Module files

```
apps/api/src/investments/
  investments.module.ts
  investments.service.ts
  investments.import.service.ts
  investments.controller.ts
  schemas/investment.schema.ts
  schemas/investment-import-batch.schema.ts
  dto/create-investment.dto.ts
  dto/update-investment.dto.ts
  dto/investment-query.dto.ts
```

### 3.3 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/investments` | Paginated list (excludes soft-deleted) |
| POST | `/investments` | Create |
| PATCH | `/investments/:id` | Edit — body includes `reason: string` |
| DELETE | `/investments/:id` | Soft-delete — body includes `reason: string` |
| POST | `/investments/import` | Bulk XLSX upload |

### 3.4 XLSX Import Columns

| Column | Required |
|--------|----------|
| Purchase Date | Yes |
| Description | Yes |
| Cost | Yes |
| Maturity Date | Yes |
| Face Value | Yes |
| Instruction | Yes (`One-Time` or `Roll-Over`) |

`interest` and `rate` computed server-side.

### 3.5 Frontend pages

```
apps/web/src/app/(dashboard)/investments/
  page.tsx
  investments-list-client.tsx   — list + inline create modal + edit/delete modals
  import/page.tsx
  import/import-client.tsx
```

Edit and Delete actions open a modal prompting for `reason`. Delete confirmation modal shows a warning ("This action is irreversible in the UI; the record is archived for audit.").

---

## 4. Loan Pay-Off + Discounts

### 4.1 Discount Schema (`apps/api/src/loans/schemas/discount.schema.ts`)

Collection: `discounts`

| Field            | Type    | Notes                            |
|------------------|---------|----------------------------------|
| staffId          | string  |                                  |
| loanId           | string  |                                  |
| discountType     | enum    | `'Origination' \| 'PayOff'`     |
| discountRate     | number  | Percentage                       |
| discountAmount   | number  | Currency value                   |
| dateGranted      | Date    |                                  |
| cancelled        | boolean | Default false                    |
| cancelledAt      | Date?   |                                  |
| cancelledReason  | string? |                                  |

Indexes: `{ loanId: 1 }`, `{ staffId: 1 }`, `{ cancelled: 1, discountType: 1 }`.

### 4.2 Loan Schema additions (`apps/api/src/loans/schemas/loan.schema.ts`)

Add fields:
```ts
@Prop() forfeitedAt?: Date;        // set when Tier 1 discount forfeited
@Prop() payOffDate?: Date;         // date pay-off payment received
@Prop({ min: 0, default: 0 }) payOffAmountReceived?: number;
```

### 4.3 Pay-Off Preview Endpoint

`GET /loans/:id/payoff-preview`

Service method `LoansService.getPayOffPreview(loanId)`:
1. Load loan + all repayments
2. Compute `alreadyPaid` = sum of paid instalments
3. Compute `remainingInstalments` = unpaid/partial instalments
4. `remainingPrincipal` = sum of principal portions remaining
5. `remainingInterest` = sum of interest portions remaining
6. Determine tier: `loan.tenureMonths <= 6` → Tier 1, else Tier 2
7. Tier 2 only: check `monthsBetween(loan.disbursedDate, today) < 6`
8. If discount applies: `discountAmount = remainingInterest × (payOffDiscountRate / 100)`
9. `netPayable = remainingPrincipal + remainingInterest − discountAmount`
10. Return `IPayOffPreview`

### 4.4 Pay-Off Action Endpoint

`POST /loans/:id/payoff`

Body: `{ amountReceived: number, paymentDate: string }`

Service method `LoansService.processPayOff(loanId, dto, actorId)`:
1. Re-run preview calculation (source of truth is always server)
2. Mark all `Pending`/`Partial`/`Overdue` repayments as `Paid` with `paidAmount = dueAmount`, `paidDate = dto.paymentDate`, `source = RepaymentSource.PayOff`
3. Set `loan.status = LoanStatus.Completed`, `loan.settledAt = dto.paymentDate`, `loan.payOffDate = dto.paymentDate`, `loan.payOffAmountReceived = dto.amountReceived`
4. If Tier 2 discount applied: create `Discount` record (`type: 'PayOff'`)
5. Audit log entry
6. Return updated loan

### 4.5 Origination Discount at Loan Creation

In `LoansService.createLoan`, after loan is saved, if `tenureMonths <= 6`:
```
discountRate = 5   // policy differential: 15% − 10%
discountAmount = principal × 0.05
```
Write `Discount` record: `{ staffId, loanId, discountType: 'Origination', discountRate: 5, discountAmount, dateGranted: disbursedDate }`.

### 4.6 Discount Forfeiture (inside OverdueDetectionJob)

At the top of `OverdueDetectionJob.detectAndProcess()`, before processing instalments:

```ts
const forfeitureCandidates = await loanModel.find({
  tenureMonths: { $lte: 6 },
  status: LoanStatus.Active,
  forfeitedAt: { $exists: false },
  disbursedDate: { $lte: sixMonthsAgo }
});
```

For each candidate:
1. Recalculate `totalRepayable` at 15%: `principal × 1.15`
2. Find all unpaid instalments; proportionally increase `dueAmount` to reflect 15% rate
3. Set `loan.interestRate = 15`, `loan.forfeitedAt = today`
4. Cancel origination `Discount` record: `{ cancelled: true, cancelledAt: today, cancelledReason: 'Discount forfeiture: loan crossed 6-month threshold due to default' }`
5. Audit log: `AuditAction.Update`, `AuditEntity.Loan`, note forfeiture
6. Send email to staff: subject "Interest Rate Adjustment on Your Loan", body includes revised outstanding balance

New `EmailLogType` entry: `LoanForfeitureNotice`.

### 4.7 One-Time Migration

Script `apps/api/src/loans/migrations/backfill-origination-discounts.ts`:
- Query all loans with `tenureMonths <= 6` and `interestRate === 10`
- For each, check if a `Discount` record already exists for that `loanId` with `discountType = 'Origination'`
- If not, insert one: `discountRate: 5`, `discountAmount: principal × 0.05`, `dateGranted: disbursedDate`
- Idempotent — safe to run multiple times

### 4.8 Frontend: Pay-Off UI

On the Loan Detail page (`apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`):

- Add "Settle Loan" button (visible only for `Active` loans, `full` permission)
- Button opens a modal:
  1. Fetches and displays `IPayOffPreview` breakdown (principal remaining, interest remaining, discount if applicable, **Net Payable**)
  2. Input: `Amount Received` (pre-filled with `netPayable`, editable)
  3. Input: `Payment Date` (date picker, defaults to today)
  4. Confirm button → `POST /loans/:id/payoff` → success toast → loan detail refreshes

---

## 5. Loan Payment Reminder Email

### 5.1 Job (`apps/api/src/loans/jobs/payment-reminder.job.ts`)

```ts
@Cron('10 0 * * *')  // 00:10 daily, after overdue detection (00:05)
async sendPaymentReminders(): Promise<void>
```

Logic:
1. Compute `targetDate = today + 7 days`
2. Query `LoanRepayment` where `dueDate = targetDate` (date range: start of day to end of day) AND `status IN [Pending, Partial]`
3. For each repayment: load `Loan`, load `Staff`
4. Skip if `staff.email` is absent
5. Skip if `loan.status !== Active`
6. Render `loan-payment-reminder.template.ts` with: `staffName`, `loanRef` (last 6 chars uppercased), `amountDue`, `dueDate`, contact numbers
7. Send via `EmailService` with `EmailLogType.LoanPaymentReminder`, `EmailTriggerSource.Cron`

**Contact numbers** hardcoded in template: `0244779991 / 0242906159`.

### 5.2 Template (`apps/api/src/email/templates/loan-payment-reminder.template.ts`)

Same Handlebars/HTML rendering pattern as `loan-schedule.template.ts`. Separate from the overdue notice template.

---

## 6. Report Additions

### 6.1 Remittances Report Panel

Added to `reports-client.tsx` SECTIONS:
```ts
{ id: 'remittances', label: 'Remittances' }
```

`RemittancesReportPanel` component:
- Filter-first (matches Contribution Statement / Loan Statement behaviour)
- Filters: From Month, From Year, To Month, To Year
- UI validation: if `toYear < fromYear` OR (`toYear === fromYear` AND `toMonth < fromMonth`) → show inline error, disable Run
- Run Report button → fetch → display `ReportTable`
- Download PDF + CSV buttons appear after data loads

### 6.2 Fund Summary Additions

**All-Time KPI block** — add new line item:
- Label: `Total Discounts Given`
- Value: sum of `discountAmount` where `cancelled = false` across all `discounts` records

**Period Summary — Discount Breakdown table** (new section alongside Contribution/Loan breakdowns):

Columns: Staff Name · Loan Reference · Discount Type · Rate (%) · Amount · Date Granted

Backend: `ReportsService.getFundSummary` queries `discounts` where `dateGranted` within the selected period and `cancelled = false`, joins `staff` for name.

### 6.3 Investments page (standalone module page, not in Reports)

`/investments` — list view with:
- Columns: Purchase Date · Description · Cost · Face Value · Interest · Rate (%) · Maturity Date · Status (badge) · Instruction
- Active status → `bg-info-50 text-info-700` badge
- Matured status → `bg-neutral-100 text-neutral-500` badge
- Row actions: Edit (pencil icon) · Delete (trash icon) — both open reason-prompt modal
- Toolbar: "Add Investment" button, "Bulk Import" button

---

## 7. Gaps Filled (beyond the original spec)

| Gap | Decision |
|-----|----------|
| Remittance charge rate configurability | Stored in `ConfigKey.RemittanceChargeRate`; snapshotted on each record |
| Gross amount definition | Sum of `paidAmount` (including Partial), non-debit contributions for the period |
| Duplicate remittance on import | Flagged row with `flagReason: 'Duplicate period'`; not silent skip |
| Investment status storage | Computed at query time; not stored |
| Investment immutability | Edit/delete allowed with mandatory reason; soft-delete preserves audit trail |
| Origination discount recording | Written at `createLoan` time for Tier 1; backfill migration for existing loans |
| Origination discount rate | Hardcoded 5% differential (15% − 10%); not configurable — it is a policy fact |
| Forfeiture adjusts which instalments | Only remaining unpaid/partial instalments; paid instalments unchanged |
| `forfeitedAt` field on Loan | Prevents re-processing by the daily job |
| Pay-off `RepaymentSource` | Add `PayOff = 'PayOff'` to `RepaymentSource` enum |
| Pay-off amount received | Stored as `loan.payOffAmountReceived`; the user can enter a different figure than `netPayable` |
| Payment reminder deduplication | No deduplication beyond natural query (job runs once daily; instalment appears once) |
| Investments not in Reports sidebar | Investments is a standalone module page (`/investments`), not a report panel |
| `LoanForfeitureNotice` email log type | Added to `EmailLogType` enum |

---

## 8. File Inventory (new files)

### API
```
apps/api/src/remittances/remittances.module.ts
apps/api/src/remittances/remittances.service.ts
apps/api/src/remittances/remittances.import.service.ts
apps/api/src/remittances/remittances.controller.ts
apps/api/src/remittances/schemas/remittance.schema.ts
apps/api/src/remittances/schemas/remittance-import-batch.schema.ts
apps/api/src/remittances/dto/create-remittance.dto.ts
apps/api/src/remittances/dto/remittance-query.dto.ts

apps/api/src/investments/investments.module.ts
apps/api/src/investments/investments.service.ts
apps/api/src/investments/investments.import.service.ts
apps/api/src/investments/investments.controller.ts
apps/api/src/investments/schemas/investment.schema.ts
apps/api/src/investments/schemas/investment-import-batch.schema.ts
apps/api/src/investments/dto/create-investment.dto.ts
apps/api/src/investments/dto/update-investment.dto.ts
apps/api/src/investments/dto/investment-query.dto.ts

apps/api/src/loans/schemas/discount.schema.ts
apps/api/src/loans/jobs/payment-reminder.job.ts
apps/api/src/loans/migrations/backfill-origination-discounts.ts

apps/api/src/email/templates/loan-payment-reminder.template.ts
```

### Web
```
apps/web/src/app/(dashboard)/remittances/page.tsx
apps/web/src/app/(dashboard)/remittances/remittances-list-client.tsx
apps/web/src/app/(dashboard)/remittances/manual/page.tsx
apps/web/src/app/(dashboard)/remittances/manual/manual-entry-client.tsx
apps/web/src/app/(dashboard)/remittances/import/page.tsx
apps/web/src/app/(dashboard)/remittances/import/import-client.tsx

apps/web/src/app/(dashboard)/investments/page.tsx
apps/web/src/app/(dashboard)/investments/investments-list-client.tsx
apps/web/src/app/(dashboard)/investments/import/page.tsx
apps/web/src/app/(dashboard)/investments/import/import-client.tsx

apps/web/src/lib/remittances.ts
apps/web/src/lib/investments.ts
```

### Modified files (key)
```
packages/shared/src/enums/app-module.enum.ts
packages/shared/src/enums/config-key.enum.ts
packages/shared/src/enums/email-log-type.enum.ts
packages/shared/src/enums/repayment-source.enum.ts
packages/shared/src/interfaces/report.interface.ts
apps/api/src/app.module.ts
apps/api/src/loans/schemas/loan.schema.ts
apps/api/src/loans/loans.service.ts
apps/api/src/loans/loans.module.ts
apps/api/src/loans/loans.controller.ts
apps/api/src/loans/jobs/overdue-detection.job.ts
apps/api/src/reports/reports.service.ts
apps/api/src/reports/reports.controller.ts
apps/web/src/components/nav/sidebar.tsx
apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx
apps/web/src/app/(dashboard)/reports/reports-client.tsx
apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx
```
