# Loan Delete Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop loan delete from silently erasing guarantor restitution obligations, bad debt records, and settled/defaulted/written-off loan history, restrict it to Manager/Admin, snapshot what's deleted into the audit log, and make bulk delete report per-loan results instead of aborting the whole batch on the first failure.

**Architecture:** Tighten `LoansService.deleteLoan`'s guard to reject any non-`Active` status outright and reject `Active` loans with any financial trace (paid instalments, outstanding guarantor restitution, bad debt, or a linked `Contribution` row). Add the `Contribution` check as a one-line method on `ContributionsService` (already injected into `LoansService`) rather than injecting a new model. Rework `bulkDeleteLoans` to catch per-id and return `{ deleted, failed }`. Gate both delete routes with the existing `@Roles` decorator + globally-registered `RolesGuard` (already used identically by `staff.controller.ts`). Mirror both changes into the two frontend delete entry points.

**Tech Stack:** NestJS, Mongoose, Jest, Next.js/React, `@tanstack/react-query`, Zustand (`useAuthStore`).

**Spec:** `docs/superpowers/specs/2026-09-24-loan-delete-hardening-design.md`

## Global Constraints

- Delete is blocked outright for any `Loan.status !== LoanStatus.Active` — no exceptions, regardless of financial state. Retiring a non-Active loan goes through `writeOff`/`exitSettle`, not delete.
- No `deletedAt`/soft-delete field is introduced. Out of scope per the spec.
- No change to `AppModule.Loans` permission levels in `permissions.constants.ts` — the role restriction is delete-specific via `@Roles`, not a module-level change.
- `bulkDeleteLoans` must never let one loan's guard failure prevent other loans in the same batch from being deleted.

## Review Focus

- **A `WelfareOfficer` hitting the delete routes directly (not through the UI).** The UI gate is cosmetic; the enforcement is the backend `@Roles` guard. Task 4's tests hit the guard directly, not through a mocked frontend.
- **An `Active` loan whose `guarantorRestitutionOwed` was incremented by the overdue-detection job while the loan is still `Active`** (this happens routinely — see `overdue-detection.job.ts`'s `$inc: { guarantorRestitutionOwed: ... }` on an `Active` loan, no status change involved) — this is exactly the case the new guard exists to catch, and Task 2's tests cover it explicitly rather than only covering the more obvious "wrong status" case.
- **`bulkDeleteLoans` given a mix where the failing loan is not last in the array** — a loop-with-try/catch bug that only skips one entry rather than truly isolating each iteration would still look correct if the failure happened to be the last id tested. Task 3's test uses a failing loan in the middle of the batch.
- **The audit snapshot when the loan has repayment rows that are all `Pending` with zero `paidAmount`** (the only state a deletable loan's schedule can be in) — confirm the snapshot still captures something meaningful (loan terms + schedule shape) rather than an empty/degenerate object, since this is the only record left after delete.
- **Frontend `canDelete` on the loan detail page silently disagreeing with the backend guard** (e.g. checking status and payments but forgetting restitution/bad debt) — a button that renders enabled and then 400s on click is a worse experience than one that's correctly hidden. Task 5 mirrors all four backend conditions client-side, not just the two that existed before.

---

### Task 1: `ContributionsService.hasContributionsForLoan`

**Files:**
- Modify: `apps/api/src/contributions/contributions.service.ts`
- Test: `apps/api/src/contributions/contributions.service.spec.ts`

**Interfaces:**
- Produces: `ContributionsService.hasContributionsForLoan(loanId: string): Promise<boolean>` (consumed by Task 2).

- [ ] **Step 1: Write the failing test**

Find `contributions.service.spec.ts`'s existing `describe('ContributionsService', ...)` block and its mock setup for `contributionModel` (it already has `find`/other methods mocked — add `exists` alongside them if not already present). Add:

```ts
describe('hasContributionsForLoan', () => {
  it('returns true when a Contribution row references the loanId', async () => {
    contributionModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'c1' }) });

    const result = await service.hasContributionsForLoan('loan-1');

    expect(contributionModel.exists).toHaveBeenCalledWith({ loanId: 'loan-1' });
    expect(result).toBe(true);
  });

  it('returns false when no Contribution row references the loanId', async () => {
    contributionModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    const result = await service.hasContributionsForLoan('loan-1');

    expect(result).toBe(false);
  });
});
```

If `contributionModel` in the mock setup has no `exists` key yet, add `exists: jest.fn()` to it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest contributions.service.spec.ts -t hasContributionsForLoan`
Expected: FAIL with `service.hasContributionsForLoan is not a function`

- [ ] **Step 3: Implement the method**

In `apps/api/src/contributions/contributions.service.ts`, add near the other small query helpers (e.g. after `getBalance`):

```ts
  async hasContributionsForLoan(loanId: string): Promise<boolean> {
    return !!(await this.contributionModel.exists({ loanId }).exec());
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest contributions.service.spec.ts -t hasContributionsForLoan`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full contributions suite to check for regressions**

Run: `cd apps/api && npx jest contributions.service.spec.ts`
Expected: PASS (all tests, including pre-existing ones)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/contributions/contributions.service.ts apps/api/src/contributions/contributions.service.spec.ts
git commit -m "feat(contributions): add hasContributionsForLoan lookup"
```

---

### Task 2: Tighten `deleteLoan`'s guard and add an audit snapshot

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts`
- Test: `apps/api/src/loans/loans.service.spec.ts`

**Interfaces:**
- Consumes: `ContributionsService.hasContributionsForLoan(loanId: string): Promise<boolean>` from Task 1 — `LoansService` already injects `ContributionsService` as `this.contributionsService`.
- Produces: `deleteLoan`'s new guard order and audit `before` snapshot (consumed conceptually by Task 3, which calls `deleteLoan` per id).

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/loans/loans.service.spec.ts`, add a new top-level `describe('deleteLoan', ...)` block. Place it right before the existing `describe('bulkDeleteLoans', ...)` block (currently at line 755):

```ts
describe('deleteLoan', () => {
  const activeLoan = (overrides: Record<string, unknown> = {}) => ({
    _id: { toString: () => 'loan-1' },
    status: LoanStatus.Active,
    guarantorRestitutionOwed: 0,
    guarantorRestitutionPaid: 0,
    badDebtAmount: 0,
    principalAmount: 5000,
    totalRepayable: 5500,
    tenureMonths: 3,
    disbursedDate: new Date('2026-01-01'),
    staffId: 'staff-1',
    guarantorId: 'guarantor-1',
    ...overrides,
  });

  beforeEach(() => {
    repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    contributionsService.hasContributionsForLoan = jest.fn().mockResolvedValue(false);
    repaymentModel.deleteMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    loanModel.findByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
  });

  it('deletes an Active loan with zero financial trace and snapshots it into the audit log', async () => {
    const loan = activeLoan();
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await service.deleteLoan('loan-1', 'actor-1', 'Actor');

    expect(loanModel.findByIdAndDelete).toHaveBeenCalledWith('loan-1');
    const [, , , , , before] = auditService.log.mock.calls[0];
    expect(before).toEqual(expect.objectContaining({ loan: expect.objectContaining({ principalAmount: 5000 }) }));
  });

  it('rejects a Completed loan regardless of financial state', async () => {
    const loan = activeLoan({ status: LoanStatus.Completed });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('rejects a Defaulted loan', async () => {
    const loan = activeLoan({ status: LoanStatus.Defaulted });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('rejects a WrittenOff loan', async () => {
    const loan = activeLoan({ status: LoanStatus.WrittenOff });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('rejects a BadDebt loan', async () => {
    const loan = activeLoan({ status: LoanStatus.BadDebt });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('rejects an Active loan with a paid instalment', async () => {
    const loan = activeLoan();
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
    repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(true) });

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('rejects an Active loan with outstanding guarantor restitution, even though it has no paid instalments', async () => {
    const loan = activeLoan({ guarantorRestitutionOwed: 500, guarantorRestitutionPaid: 100 });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('rejects an Active loan with recorded bad debt', async () => {
    const loan = activeLoan({ badDebtAmount: 200 });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('rejects an Active loan with a linked Contribution row as a last-resort guard', async () => {
    const loan = activeLoan();
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
    contributionsService.hasContributionsForLoan = jest.fn().mockResolvedValue(true);

    await expect(service.deleteLoan('loan-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
    expect(loanModel.findByIdAndDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest loans.service.spec.ts -t deleteLoan`
Expected: FAIL — every "rejects..." test fails because the current guard only checks `Active + hasPaid`, so a `Completed`/`Defaulted`/`WrittenOff`/`BadDebt` loan or an `Active` loan with restitution/bad-debt/contributions currently deletes successfully instead of throwing. The "deletes... snapshots" test fails because `auditService.log`'s 6th argument is currently `undefined`, not an object containing `loan`.

- [ ] **Step 3: Implement the new guard and snapshot**

In `apps/api/src/loans/loans.service.ts`, replace `deleteLoan` (currently lines 702-714):

```ts
  async deleteLoan(loanId: string, actorId: string, actorName: string): Promise<void> {
    const loan = await this.findOne(loanId);

    if (loan.status !== LoanStatus.Active) {
      throw new BadRequestException(
        'Only Active loans can be deleted — use Write-Off or Exit Settlement to retire this loan',
      );
    }

    const hasPaid = await this.repaymentModel
      .exists({ loanId, paidAmount: { $gt: 0 } })
      .exec();
    if (hasPaid) throw new BadRequestException('Cannot delete an active loan with recorded payments');

    if ((loan.guarantorRestitutionOwed ?? 0) > (loan.guarantorRestitutionPaid ?? 0)) {
      throw new BadRequestException('Cannot delete a loan with outstanding guarantor restitution');
    }
    if ((loan.badDebtAmount ?? 0) > 0) {
      throw new BadRequestException('Cannot delete a loan with recorded bad debt');
    }
    if (await this.contributionsService.hasContributionsForLoan(loanId)) {
      throw new BadRequestException('Cannot delete a loan with linked contribution records');
    }

    const repayments = await this.repaymentModel.find({ loanId }).exec();
    const snapshot = {
      loan: {
        principalAmount: loan.principalAmount,
        totalRepayable: loan.totalRepayable,
        tenureMonths: loan.tenureMonths,
        disbursedDate: loan.disbursedDate,
        status: loan.status,
        staffId: loan.staffId,
        guarantorId: loan.guarantorId,
      },
      repayments: repayments.map((r) => ({
        instalmentNumber: r.instalmentNumber,
        dueDate: r.dueDate,
        dueAmount: r.dueAmount,
        status: r.status,
      })),
    };

    await this.repaymentModel.deleteMany({ loanId }).exec();
    await this.loanModel.findByIdAndDelete(loanId).exec();
    this.meiliClient.index('loans').deleteDocument(loanId).catch(() => { /* non-fatal */ });
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, snapshot, { deleted: true });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest loans.service.spec.ts -t deleteLoan`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the full loans.service suite — expect two pre-existing failures, not yet fixed**

Run: `cd apps/api && npx jest loans.service.spec.ts`
Expected: The two tests inside the existing `describe('bulkDeleteLoans', ...)` block now FAIL (`'deletes each loan by id and reports the count'` fails because it uses `Completed`-status loans, which the new guard now rejects; `'stops and throws when an active loan has recorded payments'` may still pass since it already expected a rejection, but its assertion style will be replaced in Task 3 regardless). This is expected — Task 3 rewrites that describe block entirely. Do not fix it here; confirm via the tail of the run that `deleteLoan` tests themselves are green and note the `bulkDeleteLoans` failures for Task 3.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): tighten deleteLoan guard, block non-Active loans, snapshot into audit log"
```

---

### Task 3: `bulkDeleteLoans` — per-id results instead of all-or-nothing

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts`
- Test: `apps/api/src/loans/loans.service.spec.ts`

**Interfaces:**
- Consumes: `deleteLoan(loanId, actorId, actorName): Promise<void>` from Task 2 (throws `BadRequestException` on any guard failure).
- Produces: `bulkDeleteLoans(loanIds: string[], actorId: string, actorName: string): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }>` (consumed by Task 4's controller route and Task 5's frontend).

- [ ] **Step 1: Replace the existing `describe('bulkDeleteLoans', ...)` tests**

In `apps/api/src/loans/loans.service.spec.ts`, replace the entire existing block (currently lines 755-779):

```ts
describe('bulkDeleteLoans', () => {
  const activeLoan = (id: string) => ({
    _id: { toString: () => id },
    status: LoanStatus.Active,
    guarantorRestitutionOwed: 0,
    guarantorRestitutionPaid: 0,
    badDebtAmount: 0,
    principalAmount: 1000,
    totalRepayable: 1100,
    tenureMonths: 1,
    disbursedDate: new Date('2026-01-01'),
    staffId: 'staff-1',
    guarantorId: 'guarantor-1',
  });

  beforeEach(() => {
    contributionsService.hasContributionsForLoan = jest.fn().mockResolvedValue(false);
    repaymentModel.deleteMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    loanModel.findByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
  });

  it('deletes each deletable loan and reports their ids', async () => {
    const loan1 = activeLoan('l1');
    const loan2 = activeLoan('l2');
    loanModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan1) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan2) });
    repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    const result = await service.bulkDeleteLoans(['l1', 'l2'], 'actor-id', 'Actor');

    expect(result).toEqual({ deleted: ['l1', 'l2'], failed: [] });
    expect(loanModel.findByIdAndDelete).toHaveBeenCalledTimes(2);
  });

  it('reports a failure for one loan without blocking the ones before or after it in the batch', async () => {
    const loan1 = activeLoan('l1');
    const loan2 = { ...activeLoan('l2'), status: LoanStatus.Completed };
    const loan3 = activeLoan('l3');
    loanModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan1) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan2) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(loan3) });
    repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    const result = await service.bulkDeleteLoans(['l1', 'l2', 'l3'], 'actor-id', 'Actor');

    expect(result.deleted).toEqual(['l1', 'l3']);
    expect(result.failed).toEqual([
      { id: 'l2', reason: expect.stringContaining('Active loans can be deleted') },
    ]);
    expect(loanModel.findByIdAndDelete).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest loans.service.spec.ts -t bulkDeleteLoans`
Expected: FAIL — `result` is `{ deleted: 2 }` / the method throws instead of returning a `failed` array, since `bulkDeleteLoans` still just loops `await this.deleteLoan(...)` with no try/catch.

- [ ] **Step 3: Implement**

In `apps/api/src/loans/loans.service.ts`, replace `bulkDeleteLoans` (currently lines 716-721):

```ts
  async bulkDeleteLoans(
    loanIds: string[],
    actorId: string,
    actorName: string,
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest loans.service.spec.ts -t bulkDeleteLoans`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full loans.service suite to confirm everything is green now**

Run: `cd apps/api && npx jest loans.service.spec.ts`
Expected: PASS (all tests — this is where Task 2's noted pre-existing failures resolve)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): make bulkDeleteLoans report per-loan results instead of all-or-nothing"
```

---

### Task 4: Restrict delete routes to Manager/Admin

**Files:**
- Modify: `apps/api/src/loans/loans.controller.ts`
- Modify: `apps/web/src/lib/loans.ts`

**Interfaces:**
- Consumes: `bulkDeleteLoans(...): Promise<{ deleted: string[]; failed: {...}[] }>` from Task 3.
- Produces: `bulkDeleteLoans(ids: string[]): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }>` (frontend `lib/loans.ts`, consumed by Task 5).

There is no existing controller test suite for `loans.controller.ts` (confirmed — none of its other routes have one either); this task is verified by the type-check step and by Task 2/3's service-level guard tests, which are what actually enforce the business rule. The `@Roles` guard itself is exercised by `RolesGuard`'s own existing test coverage (unchanged by this task) plus the identical pattern already proven in `staff.controller.ts`.

- [ ] **Step 1: Add the imports**

In `apps/api/src/loans/loans.controller.ts`, add:

```ts
import { Roles } from '../auth/decorators/roles.decorator';
```

Change the existing shared-package import line:

```ts
import { AppModule } from '@welfare/shared';
```

to:

```ts
import { AppModule, UserRole } from '@welfare/shared';
```

- [ ] **Step 2: Add `@Roles` to both delete routes**

In `apps/api/src/loans/loans.controller.ts`:

```ts
  @Delete('bulk')
  @RequirePermission(AppModule.Loans, 'full')
  @Roles(UserRole.WelfareManager, UserRole.Admin)
  @HttpCode(HttpStatus.OK)
  bulkDelete(
```

and

```ts
  @Delete(':id')
  @RequirePermission(AppModule.Loans, 'full')
  @Roles(UserRole.WelfareManager, UserRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLoan(
```

(`RolesGuard` is already registered globally via `APP_GUARD` in `app.module.ts` — no `@UseGuards` or module wiring needed, matching how `staff.controller.ts`'s `correctStatus` route already does this.)

- [ ] **Step 3: Update the frontend return type**

In `apps/web/src/lib/loans.ts`, replace:

```ts
export async function bulkDeleteLoans(ids: string[]): Promise<{ deleted: number }> {
  const { data } = await apiClient.delete('/loans/bulk', { data: { ids } });
  return data;
}
```

with:

```ts
export async function bulkDeleteLoans(
  ids: string[],
): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }> {
  const { data } = await apiClient.delete('/loans/bulk', { data: { ids } });
  return data;
}
```

- [ ] **Step 4: Type-check the whole api and web workspaces**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors in `loans-list-client.tsx` referencing `result.deleted` as a number (`.length` usage on a string array is fine, but the current `onSuccess` handler in that file does `${result.deleted} loan...` treating it as a count) — this is expected and is what Task 5 fixes. Confirm the error is exactly there and nowhere else before moving to Task 5.

- [ ] **Step 5: Run the full api test suite for a regression check**

Run: `cd apps/api && npx jest`
Expected: PASS (every suite — `@Roles` has no runtime test here, but nothing else should have broken)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.controller.ts apps/web/src/lib/loans.ts
git commit -m "feat(loans): restrict loan delete routes to WelfareManager/Admin"
```

---

### Task 5: Frontend — mirror the guard and the new bulk-delete result shape

**Files:**
- Modify: `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx`

**Interfaces:**
- Consumes: `bulkDeleteLoans(ids: string[]): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }>` from Task 4.

No frontend test convention exists in this repo (confirmed in the prior legacy-import-UI work — zero `.test.tsx` files anywhere in `apps/web`). This task is verified by `npx tsc --noEmit`, `npx next build` (catches broken imports/JSX and prerenders both routes), and a manual read of the diff against the four backend guard conditions.

- [ ] **Step 1: Tighten `canDelete` on the loan detail page**

In `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`, this file already imports `LoanStatus` and has `permission = usePermission(AppModule.Loans)` at line 72. Add the auth-store import:

```ts
import { useAuthStore } from '@/store/auth.store';
```

Add near where `permission` is declared (after line 72):

```ts
  const role = useAuthStore((s) => s.user?.role);
  const canDeleteRole = role === UserRole.WelfareManager || role === UserRole.Admin;
```

This needs `UserRole` added to the existing shared-package import line (currently `import { LoanStatus, LoanRepaymentStatus, PaymentEntryType, StaffStatus, AppModule } from '@welfare/shared';`):

```ts
import { LoanStatus, LoanRepaymentStatus, PaymentEntryType, StaffStatus, AppModule, UserRole } from '@welfare/shared';
```

Replace the existing `canDelete` definition (currently `const canDelete = !(loan.status === LoanStatus.Active && hasPaidPayments);`, line 172) with:

```ts
  const hasOutstandingRestitution = (loan.guarantorRestitutionOwed ?? 0) > (loan.guarantorRestitutionPaid ?? 0);
  const hasBadDebt = (loan.badDebtAmount ?? 0) > 0;
  const canDelete =
    canDeleteRole &&
    loan.status === LoanStatus.Active &&
    !hasPaidPayments &&
    !hasOutstandingRestitution &&
    !hasBadDebt;
```

Update the confirm modal's copy (currently "Permanently delete this loan and all repayment records? This cannot be undone.", around line 520-522) — since a deletable loan is now guaranteed to have no repayment history:

```tsx
          <p className="text-sm text-neutral-700 mt-2">
            Permanently delete this loan? It has no recorded payments, so nothing else is affected. This cannot be undone.
          </p>
```

- [ ] **Step 2: Gate the bulk-delete UI and handle the new result shape on the loans list page**

In `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx`, add the auth-store import and `UserRole`:

```ts
import { useAuthStore } from '@/store/auth.store';
```

```ts
import { LoanStatus, AppModule, UserRole } from '@welfare/shared';
```

Add near `permission` (after line 36):

```ts
  const role = useAuthStore((s) => s.user?.role);
  const canDelete = role === UserRole.WelfareManager || role === UserRole.Admin;
```

Change `enableRowSelection` (currently `permission === 'full'` at line 164) to:

```ts
    enableRowSelection: permission === 'full' && canDelete,
```

Change the "Delete Selected" button's render condition (currently `{selectedIds.length > 0 && (`, line 177) to:

```tsx
      {selectedIds.length > 0 && canDelete && (
```

Update `bulkDeleteMutation`'s `onSuccess` (currently lines 84-89):

```ts
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['loans'] });
      setRowSelection({});
      setConfirmBulkDelete(false);
      if (result.failed.length === 0) {
        toast.success(`${result.deleted.length} loan${result.deleted.length === 1 ? '' : 's'} deleted`);
      } else {
        toast.warning(
          `${result.deleted.length} deleted, ${result.failed.length} failed: ${result.failed.map((f) => f.reason).join('; ')}`,
        );
      }
    },
```

(Check `sonner`'s `toast` export for a `warning` method — if it isn't available, use `toast.error` for the mixed-result case instead; keep `toast.success` for the all-succeeded case.)

Update the confirm modal's body copy (currently "Active loans with recorded payments cannot be deleted. This cannot be undone.", around line 336):

```tsx
            Delete <strong>{selectedIds.length}</strong> selected loan{selectedIds.length === 1 ? '' : 's'}?
            Only Active loans with no payments, no bad debt, and no outstanding guarantor restitution can be deleted — others in the selection will be skipped and reported. This cannot be undone.
```

- [ ] **Step 3: Type-check both workspaces**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (this is where Task 4 Step 4's expected error resolves)

- [ ] **Step 4: Production build the web app**

Run: `cd apps/web && npx next build`
Expected: build succeeds, lint clean, `/loans` and `/loans/[id]` still listed in the route output at their previous or similar bundle sizes

- [ ] **Step 5: Run the full api test suite one more time for a final regression check**

Run: `cd apps/api && npx jest`
Expected: PASS (every suite)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx" "apps/web/src/app/(dashboard)/loans/loans-list-client.tsx"
git commit -m "feat(loans): mirror delete guard and per-loan bulk-delete results in the UI"
```
