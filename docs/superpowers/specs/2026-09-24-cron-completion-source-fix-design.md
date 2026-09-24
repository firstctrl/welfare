# Cron Completion Gap & Repayment Source Mislabeling — Design

## Problem

Two confirmed bugs, both surfaced by 5 prod loans created with backdated historic
schedules (`disbursedDate` Jul–Aug 2025) but *without* `legacy: true` /
`legacyCutoverDate` set, so the daily `overdue-detection.job.ts` cron treated a full
year of backdated instalments as live current arrears and processed all of them in one
sweep on 2026-09-23.

**Bug #1 — mislabeled repayment source.**
`overdue-detection.job.ts:123` always sets `inst.source = RepaymentSource.GuarantorOffset`
regardless of whether the debit actually came from the guarantor, the defaulter's own
contributions (`debitDefaulterContribution` fallback), or a split of both. Confirmed on
prod: 6 of 26 `GuarantorOffset`-labeled repayment rows have no matching `GuarantorOffset`
contribution debit at all (100% `DefaulterDeduction`):

| Loan | Instalments |
|---|---|
| `6ab2b4acb8b481275230b9de` | #8–12 |
| `6ab2af16b8b481275230b68c` | #12 |

`loan.guarantorRestitutionOwed` itself is computed correctly (only real guarantor
amounts) — this is a display/audit-trail bug on `LoanRepayment.source`, not a money bug.
The job also never appends a `payments` entry for these debits (unlike the normal
`recordPaymentInternal` path at `loans.service.ts:638`), so there is no per-event audit
row — only an overwritten top-level field.

**Bug #2 — loans never marked `Completed` after cron-driven payoff.**
Neither `overdue-detection.job.ts` nor `default-recovery.job.ts` ever call
`checkAndCompleteIfDone()` (`loans.service.ts:676`, currently `private`) — that only runs
on the normal `recordPayment` path. All 5 affected loans are 100% repaid (every
instalment `Paid`) but still show `status: Active`, with Record Payment / Write Off still
live in the UI. This also means `settleGuarantorRestitution` (only called from
`checkAndCompleteIfDone`) never ran for these loans even though they're fully settled.

**Root cause / process gap:** these 5 loans were created via the ordinary loan-creation
path with a backdated `disbursedDate` instead of `loans.legacy-import.service.ts` (which
correctly sets `legacy: true` + `legacyCutoverDate` and is exempted from both jobs). Not
addressed by this spec — flagged for a separate process/UI follow-up.

## Resolved decisions

1. **Guarantor restitution on the 5 affected loans: auto-settle now.** Remediation script
   calls `settleGuarantorRestitution` directly for each of the 5 loans rather than waiting
   for `handleRestitutionRedirect` to catch it from the (now former, since loans are
   `Completed`) defaulters' future contributions.
2. **Split-source representation: amount fields, not a new "mixed" enum value.** Add
   `guarantorDebited?: number` / `borrowerDebited?: number` to the repayment row (and its
   `payments` entries) so the UI can show an accurate breakdown. `source` stays a single
   best-effort label (see below), not an enum trying to represent every combination.
3. **6 historical mislabeled rows: backfilled in the same remediation script.**

## Design

### 1. Bug #2 fix — shared completion check

`loans.service.ts:676` — rename `checkAndCompleteIfDone` from `private` to a public
method (no signature change: `(loanId: string, actorId: string, actorName: string):
Promise<void>`). It already does the right thing: flips `Active` → `Completed`, calls
`settleGuarantorRestitution`, syncs Meilisearch — this is exactly what both jobs are
missing, so reuse it verbatim rather than duplicating.

Inject `LoansService` into `OverdueDetectionJob` and `DefaultRecoveryJob`. Both are
providers of `LoansModule` already (`loans.module.ts:42`), and neither job class is a
dependency `LoansService` itself needs, so this introduces no circular dependency.

`overdue-detection.job.ts` — in `detectAndProcess()`'s per-instalment loop (around line
65-71), after `processOverdueInstalment` succeeds:
```ts
for (const inst of dueInstalments) {
  try {
    await this.processOverdueInstalment(inst, config as ConfigMap, today);
    await this.loansService.checkAndCompleteIfDone(inst.loanId, 'system', 'Overdue Detection Job');
  } catch (err) {
    this.logger.error(`Failed to process instalment ${inst._id.toString()}`, err);
  }
}
```

`default-recovery.job.ts` — in `runGracePeriodRecovery()`'s per-loan loop (around line
123-129), after `recoverDefaultedLoan` succeeds:
```ts
for (const loan of defaultedLoans) {
  try {
    await this.recoverDefaultedLoan(loan, today);
    await this.loansService.checkAndCompleteIfDone(loan._id.toString(), 'system', 'DefaultRecoveryJob');
  } catch (err) {
    this.logger.error(`Failed recovery for loan ${loan._id.toString()}`, err);
  }
}
```
`checkAndCompleteIfDone` re-queries remaining unpaid instalments itself and no-ops if the
loan isn't fully paid, so calling it unconditionally after every processed loan/instalment
is safe and cheap — matches how the normal payment path already calls it unconditionally
after every `recordPaymentInternal`.

`detectAndMarkDefaulted()` (the other cron in `default-recovery.job.ts`, which marks
loans `Defaulted`) needs no change — a loan just marked `Defaulted` cannot simultaneously
be fully paid.

### 2. Bug #1 fix — accurate source + split amounts

`packages/shared/src/enums/repayment-source.enum.ts` — add one value:
```ts
export enum RepaymentSource {
  DirectPayment = 'DirectPayment',
  Import = 'Import',
  GuarantorOffset = 'GuarantorOffset',
  DefaulterDeduction = 'DefaulterDeduction',
  ExitDeduction = 'ExitDeduction',
  PayOff = 'PayOff',
}
```
(Mirrors the existing `ContributionSource.DefaulterDeduction` naming used elsewhere in
`contributions.service.ts`.)

`apps/api/src/loans/schemas/loan-repayment.schema.ts` — add to both `LoanRepayment` and
`PaymentEntry`:
```ts
@Prop({ min: 0 }) guarantorDebited?: number;
@Prop({ min: 0 }) borrowerDebited?: number;
```

`overdue-detection.job.ts:123-130` — replace the unconditional assignment:
```ts
const totalDebited = round2(guarantorDebited + borrowerDebited);
if (totalDebited > 0) {
  inst.paidAmount = round2(inst.paidAmount + totalDebited);
  inst.guarantorStaffId = loan.guarantorId;
  inst.source = guarantorDebited > 0 ? RepaymentSource.GuarantorOffset : RepaymentSource.DefaulterDeduction;
  inst.guarantorDebited = round2((inst.guarantorDebited ?? 0) + guarantorDebited);
  inst.borrowerDebited = round2((inst.borrowerDebited ?? 0) + borrowerDebited);
  inst.paidDate = new Date();
  inst.status = finalRemaining === 0 ? LoanRepaymentStatus.Paid : LoanRepaymentStatus.Partial;
  inst.payments.push({
    amount: totalDebited,
    paidDate: inst.paidDate,
    recordedAt: new Date(),
    recordedById: 'system',
    recordedByName: 'Overdue Detection Job',
    source: inst.source,
    type: PaymentEntryType.Payment,
  });
  await inst.save();
  ...
}
```
`guarantorDebited > 0` (even when `borrowerDebited` is also > 0) keeps the
`GuarantorOffset` label — a guarantor was tapped either way, and that's the case the
existing label already covers correctly; only the pure-borrower case (`guarantorDebited
=== 0`) was actually mislabeled. The new amount fields make the split visible regardless
of which label wins.

`default-recovery.job.ts` is out of scope for this bug: its guarantor and defaulter debits
land on separate instalments in separate loop passes (lines 172-189 and 198-217), never
mixed within one instalment, so it has no equivalent mislabeling to fix.

### 3. Prod remediation script

New file: `apps/api/scripts/remediate-backdated-loan-completions.ts` (one-off, run via
`ts-node` or the repo's existing script-runner convention — check `apps/api/scripts/` for
the pattern other one-off scripts use, e.g. connection setup). Hardcodes the exact loan
IDs and instalment numbers from the bug report — this is not a general-purpose tool.

Behavior:
1. Connect to the DB using the same env/config as the API.
2. For each of the 5 loan IDs: re-verify (does not assume) all instalments are `Paid`,
   `status` is still `Active`, `guarantorRestitutionPaid < guarantorRestitutionOwed`. Log
   and skip any loan that fails this check (state may have changed since the report was
   written) rather than forcing it.
3. Default: **dry run.** Print, per loan: current status → `Completed`, restitution amount
   to be settled, which of the 6 repayment rows will be backfilled and with what
   `source`/`guarantorDebited`/`borrowerDebited` values (computed by cross-referencing the
   loan's own `Contribution` debit rows for that instalment, the same way the bug report's
   investigation did — not hardcoded amounts, so a discrepancy is visible before writing).
4. Only with an explicit `--confirm` CLI flag: perform the writes —
   `checkAndCompleteIfDone`-equivalent status flip (reuse the now-public service method
   directly, don't reimplement it) for the 5 loans, and a targeted `updateOne` per
   mislabeled repayment row for the source/split backfill.
5. Every write goes through `AuditService.log` with the same before/after shape the
   normal code paths use, so the remediation is traceable in the audit log like any other
   change.

Run only after the code fix (parts 1–2) is deployed and reviewed, and only after explicit
sign-off on the dry-run output — not bundled into automated CI/deploy.

## Out of scope

- The backdated-loan-entry process gap itself (whoever imported these 5 loans should have
  used `loans.legacy-import.service.ts`). Worth a follow-up doc/UI nudge, not this fix.
- `default-recovery.job.ts` source-labeling (no equivalent bug — see above).
- Any change to `handleRestitutionRedirect` / `redirectLoanPaymentToGuarantor` — confirmed
  already correct.
- Retroactively recomputing `guarantorRestitutionOwed`/`Paid` beyond the 5 named loans —
  the report found no other prod loans affected by either bug beyond what's listed above;
  if that turns out wrong, that's a new investigation, not this remediation script's job.

## Testing

- `overdue-detection.job.ts`: instalment fully covered by guarantor offset alone →
  `source = GuarantorOffset`, `guarantorDebited = amount`, `borrowerDebited = 0`.
- Instalment fully covered by defaulter contribution alone (guarantor balance 0) →
  `source = DefaulterDeduction`, `guarantorDebited = 0`, `borrowerDebited = amount`.
- Instalment covered by a mix of both → `source = GuarantorOffset`, both amount fields
  reflect their actual portions, `payments` array gets one entry with the split.
- `processOverdueInstalment` fully paying off a loan's last instalment → `checkAndCompleteIfDone`
  is invoked and the loan transitions to `Completed`, `settleGuarantorRestitution` is
  called (assert via a spy/mock, not a real DB round trip in the unit test).
- `default-recovery.job.ts`'s `runGracePeriodRecovery` fully paying off a loan →
  `checkAndCompleteIfDone` invoked, same assertions.
- `checkAndCompleteIfDone` is a no-op (does not flip status) when instalments remain
  unpaid, confirmed by calling it from a job unconditionally without breaking existing
  in-progress-loan behavior.
- Remediation script: dry-run mode makes zero writes (assert via a mocked model with
  every write method spied and asserted uncalled); `--confirm` mode performs the expected
  writes only for loans that still pass the re-verification check; a loan that fails
  re-verification is skipped and logged, not force-processed.
