# Loan UX Improvements — Design Spec

**Date:** 2026-05-21  
**Status:** Approved

---

## Overview

Four improvements to the loans feature:

1. Equal-width layout on the new loan form
2. Fix column alignment on the repayment schedule table
3. Principal/interest breakdown in schedule tables
4. Max active loans per staff member (config-driven eligibility)

---

## 1. Equal-Width Layout (New Loan Form)

**File:** `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx`

**Change:** Replace the outer `flex` container with a CSS grid.

- Before: `flex gap-5 items-start` with form as `flex-1 min-w-0` and preview as `w-80 flex-shrink-0`
- After: `grid grid-cols-2 gap-6 items-start` — both panels are plain `<div>` children, equal width

The schedule preview panel gains significantly more width, giving breathing room to the table.

---

## 2. Column Alignment Fix (Repayment Schedule Table)

**File:** `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

**Change:** The header row currently maps all columns with `text-left`. Numeric columns (`Due`, `Paid`, `Penalty`) must use `text-right` to align with their `text-right` cell values.

Extract the header list to a typed structure: `{ label: string; align: 'left' | 'right' }[]`. Apply alignment class per header entry instead of a uniform class.

---

## 3. Principal/Interest Breakdown

### 3a. Schema

**File:** `apps/api/src/loans/schemas/loan-repayment.schema.ts`

Add two optional Mongoose props:
```ts
@Prop({ min: 0 }) principalAmount?: number;
@Prop({ min: 0 }) interestAmount?: number;
```

Existing records will have these as `undefined` — display as `—`.

### 3b. Shared Interface

**File:** `packages/shared/src/interfaces/loan-repayment.interface.ts`

Add:
```ts
principalAmount?: number;
interestAmount?: number;
```

### 3c. Loan Creation (Backend)

**File:** `apps/api/src/loans/loans.service.ts` — `create()` method, schedule-building block (~line 207)

Compute split per instalment when building the schedule array:

```ts
const totalInterest = round2(totalRepayable - dto.principalAmount);
const baseInterestPerInst = round2(totalInterest / dto.tenureMonths);
const basePrincipalPerInst = round2(dto.principalAmount / dto.tenureMonths);
```

For each instalment `i`:
- Last instalment absorbs floating-point remainder
- `interestAmount = isLast ? round2(totalInterest - baseInterestPerInst * (tenureMonths - 1)) : baseInterestPerInst`
- `principalAmount = round2(dueAmount - interestAmount)`

Store both fields alongside `dueAmount` (which remains unchanged — it is still the total instalment amount).

### 3d. Schedule Preview Table (New Loan Form)

**File:** `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx`

Replace single `Instalment` column with two columns: `Principal` and `Interest`.

Compute split from existing values in `schedulePreview`:
```ts
const totalInterest = round2(watchPrincipal * derivedRate / 100);
const interestPerInst = round2(totalInterest / watchTenure);
// Last instalment: remainder
```

Add `principalPerInst` and `interestPerInst` to each row in the `schedulePreview` memo.

Table headers: `['#', 'Due Date', 'Principal', 'Interest']`

### 3e. Detail Page Schedule Table

**File:** `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

Replace `Due` + `Paid` with four columns:

| Column | Value |
|--------|-------|
| Principal | `row.principalAmount ?? '—'` |
| Interest | `row.interestAmount ?? '—'` |
| Paid (Int.) | `row.interestAmount != null ? fmtGHS(Math.min(row.paidAmount, row.interestAmount)) : '—'` |
| Paid (Prin.) | `row.interestAmount != null ? fmtGHS(Math.max(0, row.paidAmount - row.interestAmount)) : '—'` |

`Penalty`, `Status`, `Source` columns remain unchanged.

Final column order: `#`, `Due Date`, `Principal`, `Interest`, `Paid (Int.)`, `Paid (Prin.)`, `Penalty`, `Status`, `Source`

Table is already in `overflow-x-auto` — nine columns are fine.

---

## 4. Max Active Loans Per Staff

### 4a. ConfigKey Enum

**File:** `packages/shared/src/enums/config-key.enum.ts`

Add:
```ts
MaxLoansPerStaff = 'MAX_LOANS_PER_STAFF',
```

### 4b. Staff Eligibility Check

**File:** `apps/api/src/staff/staff.service.ts` — `isLoanEligible()`

Inject `@InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>` into `StaffService`. This is a Mongoose model injection — no circular dependency risk.

After the employment-months check, add:
```ts
const maxActiveLoans = parseInt(config['MAX_LOANS_PER_STAFF']?.value ?? '1', 10);
const activeCount = await this.loanModel
  .countDocuments({ staffId: id, status: LoanStatus.Active })
  .exec();
if (activeCount >= maxActiveLoans) {
  return { eligible: false, reason: 'Staff already has an active loan' };
}
```

Import `Loan`, `LoanDocument`, `LoanStatus` as needed. Register `LoanModule` exports or use `forwardRef` if needed — but since we're injecting the model directly, import the schema in `StaffModule` instead.

**Alternative:** Add `Loan` schema to `StaffModule` imports directly to avoid module coupling. This is cleaner than importing all of `LoansModule`.

### 4c. Settings UI

**File:** `apps/web/src/app/(dashboard)/settings/settings-client.tsx`

- Add `'MAX_LOANS_PER_STAFF'` to `LOAN_KEYS`
- Add to `LoanFields` type and `initLoan()` function
- Add number input in `LoansSection` with label "Max Active Loans per Staff Member", `min={1}`, `step={1}`, helper text "Default: 1. Staff with this many active loans are ineligible for new loans."

### 4d. New Loan Form Eligibility Badge

**File:** `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx`

No frontend change required. The badge at line 178 already shows `eligibility.reason` when `eligible === false`. Once the API returns the correct reason, the UI reflects it automatically.

---

## Data / Migration

- Existing `LoanRepayment` documents: `principalAmount` and `interestAmount` will be `undefined`. No migration — old rows display `—` in split columns.
- No existing loans have `MAX_LOANS_PER_STAFF` config value — API defaults to `1`, which matches current hard-coded behaviour in `loans.service.ts` (`create()` already blocks a second active loan).

---

## Files Touched

| File | Change |
|------|--------|
| `packages/shared/src/enums/config-key.enum.ts` | Add `MaxLoansPerStaff` |
| `packages/shared/src/interfaces/loan-repayment.interface.ts` | Add `principalAmount?`, `interestAmount?` |
| `apps/api/src/loans/schemas/loan-repayment.schema.ts` | Add schema props |
| `apps/api/src/loans/loans.service.ts` | Populate split on loan creation |
| `apps/api/src/staff/staff.service.ts` | Active-loan count in eligibility check |
| `apps/api/src/staff/staff.module.ts` | Register `Loan` schema |
| `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx` | Grid layout + split columns in preview |
| `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx` | Aligned headers + split columns in schedule |
| `apps/web/src/app/(dashboard)/settings/settings-client.tsx` | Add `MAX_LOANS_PER_STAFF` field |
