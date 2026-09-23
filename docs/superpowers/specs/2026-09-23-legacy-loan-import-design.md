# Legacy Loan Import Mode — Design

## Problem

`overdue-detection.job.ts` and `default-recovery.job.ts` scan ALL `LoanRepayment`
rows with `dueDate < today` and status `Pending`/`Partial`, applying *today's*
config (`GracePeriodDays`, `PenaltyType`/`Value`, `EndOfTenureGracePeriodMonths`)
regardless of how old the row is or how it entered the system. Importing legacy
loans with real historic arrears still `Pending` causes these jobs to apply
current penalty/grace rules against historic dates on their next run, and may
double-process arrears already resolved manually in the old system before
migration.

Neither existing import path handles this:

- `loans.import.service.ts` — repayment-only import, calls
  `recordPaymentInternal` against an **existing** loan+schedule. Cannot create
  loans or set historic per-instalment status directly.
- `loans.records.import.service.ts` — creates loans via `createForImport`, but
  always builds a fresh `Pending` schedule from today's interest-rate config
  starting at `disbursedDate`. No way to set real historic status/paidAmount
  per instalment.

Neither sets any flag distinguishing an imported legacy loan from a normal one.

## Resolved open questions

1. **Does normal automation ever apply to legacy loans again?** Yes —
   cutover-date model. Legacy loans stay in the normal overdue-detection /
   default-recovery pipeline permanently; jobs just ignore repayment rows
   dated before that loan's cutover.
2. **Cutover date scope:** per-loan field, not a single global `SystemConfig`
   value — different import batches may have different real migration dates.
3. **Bulk import input format:** two-sheet XLSX (loan header sheet + instalment
   sheet joined on a loan reference column), matching the existing
   `LoansRecordsImportService` XLSX pattern.
4. **Guarantor restitution seeding:** taken as direct input columns
   (`guarantorRestitutionOwed`, `guarantorRestitutionPaid`) on the loan sheet,
   trusted as-is from the old system, same way per-instalment `paidAmount`/
   `status` is trusted as-is rather than recomputed.

Note: the known `recordPaymentInternal` restitution-redirect gap does **not**
apply here — that method already only redirects to the guarantor for
`RepaymentSource.DirectPayment` (see `loans.service.ts:520`, comment explains
imported/backfilled rows carry historical dates predating the redirect
obligation). The new bulk import path bypasses `recordPaymentInternal`
entirely and writes restitution figures directly, so this gap is out of scope.

## Schema changes

`apps/api/src/loans/schemas/loan.schema.ts`:

```ts
@Prop({ default: false }) legacy?: boolean;
@Prop() legacyCutoverDate?: Date;
```

`legacy` defaults false/undefined for all existing and normally-created loans
— no migration needed for current data. `legacyCutoverDate` is only ever set
alongside `legacy: true`, at import time.

## Job changes

Both jobs currently join instalment → loan already (or can cheaply do so) when
deciding whether to process a row. Add one guard:

```ts
if (loan.legacy && inst.dueDate < loan.legacyCutoverDate) {
  continue; // frozen legacy arrears — never touched by automation
}
```

- **`overdue-detection.job.ts`** (`processOverdueInstalment`): loan is already
  fetched (`this.loanModel.findById(inst.loanId)`) — add the guard right after
  that fetch, before the penalty/grace/debit logic. The `Overdue` status flip
  and `penaltyAmount` calc on the initial loop (lines 65-83, before the loan
  fetch) also need the guard moved earlier or duplicated, since it mutates
  `inst.status`/`penaltyAmount` before the loan is even loaded — restructure
  so the loan is fetched first and the guard applies before any mutation.
- **`default-recovery.job.ts`**:
  - `detectAndMarkDefaulted`: after loading `activeLoans`, for each loan check
    whether *all* its overdue instalments (from the aggregate's per-loan
    `maxDueDate`) are pre-cutover; if the loan is legacy and its `maxDueDate <
    legacyCutoverDate`, skip marking it Defaulted. If any instalment is
    post-cutover, treat normally.
  - `runGracePeriodRecovery` / `recoverDefaultedLoan`: the `unpaidInstalments`
    query needs the same per-instalment filter — exclude rows with
    `dueDate < loan.legacyCutoverDate` when `loan.legacy` is true, so recovery
    only sweeps post-cutover arrears.

Non-legacy loans (`legacy` falsy) skip the guard entirely — behavior for
existing loans is unchanged.

## New bulk import path

New service `apps/api/src/loans/loans.legacy-import.service.ts`
(`LoansLegacyImportService`), following the existing XLSX-import shape
(`LoansImportService`, `LoansRecordsImportService`): batch record, progress
service, flagged-entries array, audit log.

**Sheet 1 — Loans** (one row per loan):
`Loan Ref` (join key, not persisted), `Staff ID`, `Guarantor Staff ID`,
`Principal Amount`, `Tenure Months`, `Disbursed Date`, `Status`
(`Active`/`Completed`/`Defaulted`/`WrittenOff`/`BadDebt`), `Cutover Date`,
`Guarantor Restitution Owed`, `Guarantor Restitution Paid`, `Cheque No`,
`PV No`, `Notes`.

**Sheet 2 — Instalments** (one row per instalment):
`Loan Ref`, `Instalment Number`, `Due Date`, `Due Amount`, `Paid Amount`,
`Paid Date`, `Status` (`Pending`/`Paid`/`Partial`/`Overdue`/`Waived`).

Processing: read both sheets, group instalment rows by `Loan Ref`, validate
each loan row (staff/guarantor exist, amounts positive, dates parse, instalment
rows present) and each instalment row (status valid, dueAmount > 0, paidDate
required if status is Paid/Partial), flag failures per loan (not per row —
a bad instalment flags its whole loan), otherwise call:

```ts
loansService.createForLegacyImport(
  staffMongoId, guarantorMongoId,
  { principalAmount, tenureMonths, disbursedDate, status, cutoverDate,
    guarantorRestitutionOwed, guarantorRestitutionPaid, chequeNo, pvNo, notes },
  instalmentRows, // trusted as-is: dueDate/dueAmount/paidAmount/paidDate/status
  actorId, actorName,
)
```

New `loansService.createForLegacyImport(...)`: creates the `Loan` doc with
`legacy: true`, `legacyCutoverDate`, `status`, and the restitution fields set
directly (no interest/schedule recompute — `totalRepayable`/`monthlyInstalment`
derived by summing the given instalment `dueAmount`s). Inserts the given
instalment rows via `insertMany`, exactly as provided (no
`recordPaymentInternal` call — this is data seeding, not a payment event, so
no restitution-redirect, no penalty calc, no audit-as-payment). One audit log
per created loan (`AuditAction.Import`).

New batch schema `loan-legacy-import-batch.schema.ts`, same shape as
`LoanRecordsImportBatch` (flaggedEntries keyed by loan ref instead of row
number).

## Testing

- Legacy loan imported with historic `Pending` arrears → overdue-detection and
  default-recovery jobs must not touch those rows (no penalty applied, no
  status flip, no guarantor/defaulter debit) on their next run.
- Legacy loan imported fully `Paid` → jobs find nothing to process; no-op.
- Legacy loan imported with `guarantorRestitutionOwed > 0` → field lands
  correctly on the Loan doc; a subsequent normal (post-cutover) instalment
  going overdue continues restitution accounting normally, additively (not
  clobbering the imported figure — mirrors existing `$inc` behavior already in
  both jobs).
- Legacy loan with one instalment dueDate before cutover and one after →
  pre-cutover row frozen, post-cutover row processed normally by the job that
  reaches it.
- Non-legacy loan (`legacy` falsy) → job behavior byte-for-byte unchanged
  (regression coverage on existing job test suites).
- Bulk import: malformed instalment row flags the whole loan (not partial
  creation), staff/guarantor lookup failures flagged, valid multi-loan batch
  creates all loans+schedules matching input exactly.
