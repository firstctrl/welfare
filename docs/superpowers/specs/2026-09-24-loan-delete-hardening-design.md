# Loan Delete Hardening — Design

## Problem

`LoansService.deleteLoan` (`apps/api/src/loans/loans.service.ts:702-714`) hard-deletes a
`Loan` document and all its `LoanRepayment` rows with only one guard: an `Active` loan
is blocked if any repayment has `paidAmount > 0`. Every other case — `Completed`,
`Defaulted`, `WrittenOff`, `BadDebt`, or an `Active` loan with zero payments — deletes
unconditionally, with these consequences:

1. **Guarantor restitution silently erased.** If `guarantorRestitutionOwed >
   guarantorRestitutionPaid`, the guarantor's already-debited money is never coming
   back, and deleting the loan destroys the only record connecting that debt to
   anything.
2. **Bad debt written off for free.** A loan with `badDebtAmount > 0` (already through
   default-recovery) can be deleted, erasing that recovery history.
3. **Orphaned `Contribution` rows.** Rows with `source: GuarantorOffset /
   DefaulterRestitution / DefaulterDeduction / BadDebtRecovery` carry a loose
   `loanId?: string` reference (`contribution.schema.ts:19`) — never populated/joined,
   only displayed as a trailing "ref" label in reports (`reports.service.ts`), so a
   dangling `loanId` degrades a label rather than crashing a query. Still garbage.
4. **No audit snapshot.** `auditService.log(..., undefined, { deleted: true })` records
   one boolean. Nothing to reconstruct a mistaken delete from.
5. **Hard delete only.** No recovery path, ever, by any role.
6. **`bulkDeleteLoans` loops `deleteLoan` with no try/catch** — the first guard failure
   throws out of the loop, leaving loans before it deleted, loans after it untouched,
   and the caller sees one opaque error for the whole batch.
7. **Anyone with `Loans: 'full'` can delete** — `WelfareOfficer`, `WelfareManager`, and
   `Admin` all qualify (`permissions.constants.ts`); only `WelfareDirector` (readonly)
   is excluded.

## Resolved policy decisions

1. **Scope of what's deletable:** `LoanStatus` has no `Pending`/`Rejected` state —
   every loan is created `Active` immediately (`createForImport`/`create` both set
   `status: LoanStatus.Active`). So "only allow deleting never-disbursed loans" has no
   real status to hook. Decision: **delete is blocked outright for any status other
   than `Active`.** `Completed`/`Defaulted`/`WrittenOff`/`BadDebt` all represent a loan
   that has already gone through a real lifecycle transition (`exitSettle`, the
   default-recovery jobs, or `writeOff` — `loans.service.ts:779-810`, which already
   waives remaining instalments and stamps `badDebtAmount`). Correcting a mistake on
   one of those goes through those existing flows, not delete.
2. **Role scope:** delete is restricted to `WelfareManager` and `Admin`. `WelfareOfficer`
   keeps full create/edit/record-payment rights on Loans, loses delete specifically.
   Implemented via the existing `@Roles(...)` decorator + `RolesGuard`
   (`apps/api/src/auth/guards/roles.guard.ts`) stacked alongside the existing
   `@RequirePermission(AppModule.Loans, 'full')` — this exact combination is already
   used for `staff.controller.ts`'s `correctStatus` route.

## Design

### 1. Tightened guard (`deleteLoan`)

```
if (loan.status !== LoanStatus.Active)
  throw BadRequestException('Only Active loans can be deleted — use Write-Off or Exit Settlement to retire this loan');

// existing: any repayment with paidAmount > 0 → blocked

if (loan.guarantorRestitutionOwed > loan.guarantorRestitutionPaid)
  throw BadRequestException('Cannot delete a loan with outstanding guarantor restitution');

if (loan.badDebtAmount > 0)
  throw BadRequestException('Cannot delete a loan with recorded bad debt');

if (await this.contributionModel.exists({ loanId }).exec())
  throw BadRequestException('Cannot delete a loan with linked contribution records');
```

The last check is defensive: given the three checks above it, a `Contribution` row
referencing this `loanId` should be unreachable (every `GuarantorOffset` /
`DefaulterRestitution` / `DefaulterDeduction` / `BadDebtRecovery` row is only created
alongside a `paidAmount` increase on some repayment, which the payment guard already
catches). It stays as cheap insurance against a future code path, not as the primary
mechanism — gap #3 (orphaned contributions) is resolved as a side effect of gaps #1/#2
being closed, not by separate cleanup code.

`deleteLoan` needs `ContributionModel` injected — it doesn't have it today. Inject it
the same way other cross-module reads are already done in this service (see
`ContributionsService` usage patterns elsewhere in `loans.service.ts`).

### 2. Audit snapshot

Before the delete, build a snapshot and pass it as `auditService.log`'s `before`
argument (currently `undefined`):

```
const repayments = await this.repaymentModel.find({ loanId }).exec();
const snapshot = { loan: loan.toObject(), repayments: repayments.map(r => r.toObject()) };
// ... perform delete ...
this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, snapshot, { deleted: true });
```

Since a deletable loan is now guaranteed financially untouched (no payments, no
restitution, no bad debt), the snapshot is mostly loan terms + an all-`Pending`
schedule — still the only record left after the row is gone, and cheap to capture.

### 3. `bulkDeleteLoans` — per-id result instead of all-or-nothing

```ts
async bulkDeleteLoans(
  loanIds: string[], actorId: string, actorName: string,
): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }> {
  const deleted: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of loanIds) {
    try {
      await this.deleteLoan(id, actorId, actorName);
      deleted.push(id);
    } catch (err: unknown) {
      failed.push({ id, reason: err instanceof Error ? err.message : 'Delete failed' });
    }
  }
  return { deleted, failed };
}
```

No transaction needed: each `deleteLoan` call is already a complete, independently
guarded unit of work (a loan that fails its own guard was never going to be deleted
regardless of batch context), so per-id isolation is the correct unit of atomicity
here, not a DB transaction across N unrelated loans.

### 4. Permission

Controller (`loans.controller.ts`), both routes:

```ts
@Delete(':id')
@RequirePermission(AppModule.Loans, 'full')
@Roles(UserRole.WelfareManager, UserRole.Admin)
deleteLoan(...)

@Delete('bulk')
@RequirePermission(AppModule.Loans, 'full')
@Roles(UserRole.WelfareManager, UserRole.Admin)
bulkDelete(...)
```

### 5. Frontend

- `loan-detail-client.tsx`: gate the Delete button behind
  `role === UserRole.WelfareManager || role === UserRole.Admin`, read via
  `useAuthStore((s) => s.user?.role)` — the exact pattern `staff-detail-client.tsx`
  already uses for `canCorrectStatus`. Update the confirm modal's copy since delete is
  now only reachable for a financially-untouched `Active` loan (no more "and all
  repayment records" framing implying real history could be lost).
- `loans-list-client.tsx`: gate the bulk-delete button the same way. Update
  `bulkDeleteMutation`'s `onSuccess` and `lib/loans.ts`'s `bulkDeleteLoans` return type
  for the new `{ deleted: string[], failed: {...}[] }` shape; toast reports both counts
  (e.g. "3 deleted, 1 failed" with failure reasons visible, not just a single number).

## Out of scope

- No soft-delete (`deletedAt` field). Given the guard changes, everything actually
  reachable for deletion is financially inert — there's nothing worth "undoing" that a
  restore would meaningfully recover beyond what the audit snapshot already preserves.
  Introducing a `deletedAt` field would mean auditing every existing query across the
  codebase to exclude soft-deleted loans, for no real benefit given the tightened scope.
- No change to `AppModule.Loans` permission levels in `permissions.constants.ts` beyond
  the delete-specific `@Roles` gate — Officer keeps `'full'` for everything else.
- No change to `writeOff`, `exitSettle`, or the default-recovery jobs themselves.

## Testing

- Active loan, zero payments, zero restitution, zero bad debt → deletes successfully,
  audit log has a non-empty `before` snapshot.
- Active loan with any `paidAmount > 0` repayment → blocked (existing behavior, kept).
- Active loan with `guarantorRestitutionOwed > guarantorRestitutionPaid` → blocked.
- Active loan with `badDebtAmount > 0` → blocked.
- Active loan with a linked `Contribution` row (constructed directly in the test,
  bypassing the normal flow, to exercise the defensive check on its own) → blocked.
- Completed / Defaulted / WrittenOff / BadDebt loan, regardless of financial state →
  blocked with the "use Write-Off/Exit Settlement" message.
- `bulkDeleteLoans` with a mix of deletable and blocked loans → returns both lists
  correctly; deletable ones are actually deleted even though others failed.
- Delete route (single and bulk) rejects a `WelfareOfficer` actor with 403; accepts
  `WelfareManager`/`Admin`.
- Frontend: Delete button/action not rendered for an Officer-role user; rendered and
  functional for Manager/Admin.
