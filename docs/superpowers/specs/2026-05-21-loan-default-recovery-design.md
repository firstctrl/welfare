# Loan Default Recovery Design

**Date:** 2026-05-21  
**Status:** Approved  

## Overview

When a loan tenure ends with an outstanding balance, a configurable grace period is granted. If arrears remain unpaid after expiry, the system automatically:

1. Deducts the outstanding from the defaulter's accumulated contributions
2. Recovers any shortfall from the guarantor's contributions
3. Redirects the defaulter's future monthly contributions to the guarantor until fully reimbursed

---

## Data Model Changes

### `ConfigKey` enum — new value

```
EndOfTenureGracePeriodMonths = 'END_OF_TENURE_GRACE_PERIOD_MONTHS'
```

Integer (months). Separate from existing `GracePeriodDays` (per-instalment overdue). Default: `1`.

---

### `Loan` schema — new fields

| Field | Type | Default | Purpose |
|---|---|---|---|
| `recoveryRanAt` | `Date?` | — | Timestamp recovery was executed; prevents re-run |
| `defaultedAt` | `Date?` | — | When loan was marked `Defaulted` |
| `endOfTenureGraceExpiry` | `Date?` | — | First day of month after grace period ends |
| `defaulterContributionDebited` | `number` | `0` | Amount recovered from defaulter's contributions |
| `guarantorRestitutionOwed` | `number` | `0` | Amount deducted from guarantor, to be reimbursed |
| `guarantorRestitutionPaid` | `number` | `0` | Amount already reimbursed via redirected contributions |

`LoanStatus.Defaulted` already exists in the shared enum. This feature is the first to set it.

---

### `ContributionSource` enum — new values

| Value | Used for |
|---|---|
| `DefaulterDeduction` | One-time debit from defaulter's contributions at recovery time |
| `DefaulterRestitution` | Ongoing monthly redirect — debit on defaulter, credit on guarantor |

---

## Architecture

### New: `DefaultRecoveryService` (inside `loans` module)

Owns all end-of-tenure default lifecycle logic. Two cron jobs.

**Injected dependencies:**
- `LoanModel`
- `LoanRepaymentModel`
- `ContributionsService`
- `SystemConfigService`
- `AuditService`

---

### Cron 1 — End-of-Tenure Default Detection (`10 0 * * *`)

**Trigger:** Daily at 00:10.

**Query:** Active loans where the last instalment `dueDate < today` AND at least one instalment has `status` not in `[Paid, Waived]`.

**Per matched loan:**
1. Set `status = Defaulted`, `defaultedAt = today`
2. Compute `endOfTenureGraceExpiry` = first day of (defaultedAt month + graceMonths + 1)
3. Mark all remaining `Pending`/`Partial` instalments → `Overdue`
4. Audit log transition

**Guard:** Only processes `status === Active` loans (no double-processing).

---

### Cron 2 — Grace Period Recovery (`15 0 * * *`)

**Trigger:** Daily at 00:15, runs after Cron 1.

**Query:** `Defaulted` loans where `endOfTenureGraceExpiry < today` AND `recoveryRanAt` is null.

**Per matched loan:**
1. Compute `outstanding` = sum of `(dueAmount + penaltyAmount - paidAmount)` across unpaid instalments
2. Call `contributionsService.debitDefaulterContribution(defaulterId, outstanding)` → `{ debited, remaining }`
3. Set `defaulterContributionDebited = debited`
4. Apply debited amount to unpaid instalments (source: `ExitDeduction` — reuses existing source, consistent with exit settlement pattern)
5. If `remaining > 0`: call `contributionsService.debitGuarantorOffset(guarantorId, remaining)` → `{ debited: gDebited, remaining: stillUnpaid }`
6. Set `guarantorRestitutionOwed = gDebited`, `badDebtAmount = stillUnpaid`
7. Apply guarantor-debited amount to remaining unpaid instalments (source: `GuarantorOffset`)
8. Set `recoveryRanAt = now`
9. Audit log

---

### `ContributionsService` — new method

```
debitDefaulterContribution(staffId, amount, loanId, actorId, actorName)
  → { debited: number, remaining: number }
```

Mirrors existing `debitGuarantorOffset`. Computes defaulter's contribution balance, debits up to available balance, creates `isDebit: true` entry with `source: DefaulterDeduction`. Returns how much was debited and the remaining unrecovered amount.

---

### `ContributionsService.processPayment` — redirect hook

After recording a contribution, check if `staffId` has any loan where:
- `status === Defaulted`
- `guarantorRestitutionOwed > guarantorRestitutionPaid`

If yes:
1. Compute `redirectAmount = min(contribution.paidAmount, guarantorRestitutionOwed - guarantorRestitutionPaid)`
2. Create debit entry on defaulter (`isDebit: true`, `source: DefaulterRestitution`, `paidAmount: redirectAmount`)
3. Create credit entry on guarantor (`isDebit: false`, `source: DefaulterRestitution`, `paidAmount: redirectAmount`)
4. Increment `loan.guarantorRestitutionPaid += redirectAmount`
5. Audit log both entries

Redirect is capped at remaining restitution. Any excess over the cap credits the defaulter's account normally (no debit created for the excess).

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Defaulter balance = 0 at recovery | `defaulterContributionDebited = 0`, full amount falls to guarantor. `recoveryRanAt` still set so cron doesn't retry |
| Guarantor balance also insufficient | Shortfall → `badDebtAmount`. `guarantorRestitutionOwed` = only what was actually debited |
| Defaulter makes direct repayment after defaulting | `recordPayment` still works. `checkAndCompleteIfDone` guards: skip auto-complete if `status === Defaulted && guarantorRestitutionPaid < guarantorRestitutionOwed` |
| Redirect amount exceeds remaining restitution | Cap redirect at `guarantorRestitutionOwed - guarantorRestitutionPaid`. Excess goes to defaulter's account normally |
| Staff has multiple loans, only one defaulted | Redirect query filters specifically on the defaulted loan with active restitution |
| Cron 1 runs on already-Defaulted loan | Guard: `status === Active` only |

---

## API Surface

No new endpoints. All new loan fields (`defaultedAt`, `endOfTenureGraceExpiry`, `guarantorRestitutionOwed`, `guarantorRestitutionPaid`, `defaulterContributionDebited`) are returned by existing `GET /loans/:id`.

---

## UI Changes

### Loan detail page

New **"Default Recovery"** info card, visible when `loan.status === 'Defaulted'`:

- Grace expiry date
- Defaulter contribution deducted
- Guarantor contribution deducted
- Guarantor reimbursed so far
- Remaining to reimburse
- Progress bar (restitution completion %)

### Loans list

`Defaulted` badge — distinct colour from `BadDebt` (suggest amber vs red).

### Contribution statements

No changes. Debit entries with `source: DefaulterRestitution` appear as outgoing on defaulter's statement. Credit entries with same source appear as incoming on guarantor's statement.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/shared/src/enums/config-key.enum.ts` | Add `EndOfTenureGracePeriodMonths` |
| `packages/shared/src/enums/contribution-source.enum.ts` | Add `DefaulterDeduction`, `DefaulterRestitution` |
| `packages/shared/src/interfaces/loan.interface.ts` | Add new fields |
| `packages/shared/src/dto/loan.dto.ts` | Add new fields |
| `apps/api/src/loans/schemas/loan.schema.ts` | Add new fields |
| `apps/api/src/loans/jobs/default-recovery.job.ts` | **Create** — two cron jobs |
| `apps/api/src/contributions/contributions.service.ts` | Add `debitDefaulterContribution`, redirect hook in `processPayment` |
| `apps/api/src/loans/loans.service.ts` | Guard in `checkAndCompleteIfDone` |
| `apps/api/src/loans/loans.module.ts` | Register `DefaultRecoveryJob` |
| `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx` | Add Default Recovery info card |
| `apps/web/src/lib/form-schemas.ts` | No change expected |
