# Legacy Import Guarantor Restitution Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the legacy loan importer sees a loan row claiming `Guarantor Restitution Owed > 0`, cross-check it against the defaulter's actual contribution balance at the time and flag (warn, not block) rows where the defaulter appears to have had funds available that the claimed figure doesn't account for.

**Architecture:** `ContributionsService.getBalance()` gains an optional `asOfDate` bound so it can answer "what was this staff member's contribution balance as of date X", reusing the exact credit-minus-debit-then-round2 algorithm already proven in `diagnose-guarantor-first-order.mongosh.js`. `LoansLegacyImportService` gets `ContributionsService` injected (module already imports `ContributionsModule`, so no module wiring needed) and, after successfully creating a legacy loan whose row claims `Guarantor Restitution Owed > 0`, computes the defaulter's balance as of the latest instalment `Paid Date` in that loan's instalment rows and pushes a flagged entry — without skipping loan creation — if that balance is positive.

**Tech Stack:** NestJS, Mongoose, Jest.

**Spec:** This plan is driven directly by the user's request (no separate spec doc); the request text is reproduced in full in this plan's origin conversation. Key excerpt: "Add a validation/warning step... that, for any loan row with Guarantor Restitution Owed > 0: (1) cross-references the instalment rows... query the contributions collection for that staffId, same balanceBefore() logic used in the remediation scripts... (2) If the defaulter had balance available that the claimed Guarantor Restitution Owed figure doesn't account for, flag the row... (3) This should warn, not hard-block."

## Global Constraints

- Reuse the exact balance algorithm from `apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js`: for a staffId, sum `paidAmount` across all `contributions` rows with `createdAt <= asOfDate`, crediting non-debit rows and subtracting debit rows, then round to 2 decimals with `Math.round(n * 100) / 100`. Do not re-derive this differently.
- Must warn (flag), never block loan creation — the loan for a flagged row is still created via `LoansService.createForLegacyImport`, unlike every other existing flag in `processImport`, which currently skips creation (`continue` before `createForLegacyImport` runs).
- Use the existing `flaggedEntries` mechanism (`{ loanRef, staffId, guarantorId, principalAmount, disbursedDate, reason }`) so the existing `dismissFlaggedEntry` / `clearFlaggedEntries` review workflow works unchanged.
- No new NestJS module wiring is needed: `LoansModule` already imports `ContributionsModule` (`apps/api/src/loans/loans.module.ts`), so `ContributionsService` can be injected directly into `LoansLegacyImportService`.

## Review Focus

- Loan row with `Guarantor Restitution Owed` of exactly `0` (the default for the vast majority of legacy rows) must never trigger a contributions lookup or a flag — the check only applies when `> 0`.
- Loan row with `Guarantor Restitution Owed > 0` but whose instalment rows have no `Paid Date` at all (nothing was ever paid) has no meaningful "as of" timestamp — must not crash and must not flag (nothing to cross-check against).
- A flagged warning must not prevent `created` from incrementing or the loan from existing afterward — this is the behavior that most differs from every other check in this file and is the easiest thing for an implementer to get backwards by copy-pasting the existing `flag(...); continue;` pattern.
- The defaulter balance must be computed "as of" the **latest** Paid Date among that loan's instalment rows, not summed per-instalment — matching the mongosh script's grouped, non-double-counted approach; using each instalment's own paid date independently and summing balances would double-count the same pot of money.
- `getBalance`'s existing no-argument call sites (`debitDefaulterContribution`, `debitGuarantorOffset`, anywhere else calling `getBalance(staffId)`) must keep returning the as-of-now balance unchanged — the new `asOfDate` parameter must be optional and additive, not a breaking change to the aggregation `$match` when omitted.

---

## File Structure

- Modify: `apps/api/src/contributions/contributions.service.ts` — extend `getBalance` to accept an optional `asOfDate: Date` bound.
- Modify: `apps/api/src/contributions/contributions.service.spec.ts` — add coverage for the new `asOfDate` parameter.
- Modify: `apps/api/src/loans/loans.legacy-import.service.ts` — inject `ContributionsService`, add the post-creation warning check in `processImport`.
- Modify: `apps/api/src/loans/loans.legacy-import.service.spec.ts` — add `mockContributionsService`, wire it into the test module, add the three required test cases.

No new files. Both target files are already small and single-purpose; no split needed.

---

### Task 1: Add an optional as-of-date bound to `ContributionsService.getBalance`

**Files:**
- Modify: `apps/api/src/contributions/contributions.service.ts:247-265`
- Test: `apps/api/src/contributions/contributions.service.spec.ts`

**Interfaces:**
- Consumes: nothing new (only touches `contributionModel.aggregate`, already injected).
- Produces: `getBalance(staffId: string, asOfDate?: Date): Promise<number>` — later tasks call this with a `Date` as the second argument to get a point-in-time balance; omitting it preserves today's as-of-now behavior.

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `apps/api/src/contributions/contributions.service.spec.ts`, near the existing `debitDefaulterContribution` block (after line 266):

```ts
  describe('getBalance with asOfDate', () => {
    it('bounds both the credit and debit aggregations by createdAt when asOfDate is given', async () => {
      mockAggregate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: 9000 }]) }) // credits
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: 2000 }]) }); // debits

      const asOf = new Date('2025-06-01T00:00:00.000Z');
      const result = await service.getBalance('staff-1', asOf);

      expect(result).toBe(7000);
      expect(mockAggregate).toHaveBeenNthCalledWith(1, [
        { $match: { staffId: 'staff-1', isDebit: { $ne: true }, createdAt: { $lte: asOf } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } },
      ]);
      expect(mockAggregate).toHaveBeenNthCalledWith(2, [
        { $match: { staffId: 'staff-1', isDebit: true, createdAt: { $lte: asOf } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } },
      ]);
    });

    it('omits the createdAt bound entirely when asOfDate is not given (unchanged as-of-now behavior)', async () => {
      mockAggregate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: 5000 }]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });

      const result = await service.getBalance('staff-1');

      expect(result).toBe(5000);
      expect(mockAggregate).toHaveBeenNthCalledWith(1, [
        { $match: { staffId: 'staff-1', isDebit: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } },
      ]);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contributions.service.spec.ts -t "getBalance with asOfDate"`
Expected: FAIL — first test fails because current `getBalance` ignores a second argument and never adds `createdAt` to the `$match`.

- [ ] **Step 3: Implement the minimal change**

Replace `apps/api/src/contributions/contributions.service.ts:247-265`:

```ts
  async getBalance(staffId: string, asOfDate?: Date): Promise<number> {
    const dateFilter = asOfDate ? { createdAt: { $lte: asOfDate } } : {};
    const [creditResult, debitResult] = await Promise.all([
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: { $ne: true }, ...dateFilter } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: true, ...dateFilter } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
    ]);
    const credits = (creditResult as { total: number }[])[0]?.total ?? 0;
    const debits = (debitResult as { total: number }[])[0]?.total ?? 0;
    return credits - debits;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contributions.service.spec.ts`
Expected: PASS — full file, including the two new tests and all pre-existing `getBalance`-dependent tests (`debitDefaulterContribution`, etc.) which call `getBalance` with one argument and must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contributions/contributions.service.ts apps/api/src/contributions/contributions.service.spec.ts
git commit -m "feat(contributions): support as-of-date balance lookups"
```

---

### Task 2: Warn on legacy loan rows whose claimed Guarantor Restitution Owed ignores available defaulter balance

**Files:**
- Modify: `apps/api/src/loans/loans.legacy-import.service.ts:1-18` (imports/constructor), `:185-206` (post-creation hook)
- Modify: `apps/api/src/loans/loans.legacy-import.service.spec.ts`

**Interfaces:**
- Consumes: `ContributionsService.getBalance(staffId: string, asOfDate?: Date): Promise<number>` from Task 1.
- Produces: no new public interface — this is purely internal behavior inside `processImport`. The `flaggedEntries` shape it pushes is the same `{ loanRef, staffId, guarantorId, principalAmount, disbursedDate, reason }` object every other check in this file already produces.

- [ ] **Step 1: Write the failing tests**

Open `apps/api/src/loans/loans.legacy-import.service.spec.ts`. Add a mock alongside the existing ones (near `mockProgressService`):

```ts
const mockContributionsService = { getBalance: jest.fn().mockResolvedValue(0) };
```

Add `{ provide: ContributionsService, useValue: mockContributionsService }` to the `providers` array in the `beforeEach`'s `Test.createTestingModule({...})` call, and add the import at the top of the file:

```ts
import { ContributionsService } from '../contributions/contributions.service';
```

In the same `beforeEach`, after the existing `jest.clearAllMocks()` / default-mock-reset lines, add:

```ts
mockContributionsService.getBalance.mockResolvedValue(0);
```

Add a new `describe` block (the file's existing tests can stay as-is; this is additive):

```ts
  describe('guarantor restitution owed cross-check', () => {
    const loanRowWithRestitution = {
      'Loan Ref': 'L1', 'Staff ID': 'S1', 'Guarantor Staff ID': 'S2',
      'Principal Amount': 6000, 'Tenure Months': 2, 'Disbursed Date': '15/12/2024',
      'Status': 'Active', 'Cutover Date': '01/01/2026',
      'Guarantor Restitution Owed': 800, 'Guarantor Restitution Paid': 200,
      'Cheque No': 'C1', 'PV No': 'PV1',
    };
    const instalmentRowsWithPaidDates = [
      { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': 3000, 'Paid Date': '04/01/2025', 'Status': 'Paid' },
      { 'Loan Ref': 'L1', 'Instalment Number': 2, 'Due Date': '05/02/2025', 'Due Amount': 3000, 'Paid Amount': 3000, 'Paid Date': '10/02/2025', 'Status': 'Paid' },
    ];

    it('does not query contributions or flag when Guarantor Restitution Owed is 0', async () => {
      const buffer = twoSheetBuffer([validLoanRow], validInstalmentRows);

      const result = await service.processImport(buffer, 'f.xlsx', 'actor-1', 'Actor');

      expect(mockContributionsService.getBalance).not.toHaveBeenCalled();
      expect(result.flagged).toBe(0);
      expect(result.created).toBe(1);
    });

    it('does not flag when the defaulter had no available balance as of the latest paid instalment (correct defaulter-first history)', async () => {
      mockContributionsService.getBalance.mockResolvedValue(0);
      const buffer = twoSheetBuffer([loanRowWithRestitution], instalmentRowsWithPaidDates);

      const result = await service.processImport(buffer, 'f.xlsx', 'actor-1', 'Actor');

      expect(mockContributionsService.getBalance).toHaveBeenCalledWith('resolved-S1', new Date('2025-02-10'));
      expect(result.flagged).toBe(0);
      expect(result.created).toBe(1);
    });

    it('flags, without skipping creation, when the defaulter had available balance the claimed figure ignores', async () => {
      mockContributionsService.getBalance.mockResolvedValue(500);
      const buffer = twoSheetBuffer([loanRowWithRestitution], instalmentRowsWithPaidDates);

      const result = await service.processImport(buffer, 'f.xlsx', 'actor-1', 'Actor');

      expect(result.created).toBe(1);
      expect(result.flagged).toBe(1);
      const flaggedEntries = mockFindByIdAndUpdate.mock.calls[0][1].$set.flaggedEntries;
      expect(flaggedEntries[0]).toEqual(
        expect.objectContaining({
          loanRef: 'L1',
          staffId: 'S1',
          guarantorId: 'S2',
          reason: expect.stringContaining('Guarantor Restitution Owed may not reflect defaulter-first order'),
        }),
      );
      expect(flaggedEntries[0].reason).toContain('500');
    });

    it('does not query contributions or flag when no instalment row has a Paid Date (nothing to cross-check against)', async () => {
      const unpaidInstalmentRows = [
        { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'Pending' },
        { 'Loan Ref': 'L1', 'Instalment Number': 2, 'Due Date': '05/02/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'Pending' },
      ];
      const buffer = twoSheetBuffer([loanRowWithRestitution], unpaidInstalmentRows);

      const result = await service.processImport(buffer, 'f.xlsx', 'actor-1', 'Actor');

      expect(mockContributionsService.getBalance).not.toHaveBeenCalled();
      expect(result.flagged).toBe(0);
      expect(result.created).toBe(1);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx jest loans.legacy-import.service.spec.ts -t "guarantor restitution owed cross-check"`
Expected: FAIL — `ContributionsService` isn't injected yet (module compile error or `mockContributionsService.getBalance` never called), and no such warning logic exists yet.

- [ ] **Step 3: Implement the minimal change**

In `apps/api/src/loans/loans.legacy-import.service.ts`, add the import (after line 16):

```ts
import { ContributionsService } from '../contributions/contributions.service';
```

Add it to the constructor (`:55-62`):

```ts
  constructor(
    @InjectModel(LoanLegacyImportBatch.name)
    private readonly batchModel: Model<LoanLegacyImportBatchDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
    private readonly contributionsService: ContributionsService,
  ) {}
```

Replace the success branch of the per-row try block (`:185-206`) — this is the block that resolves staff/guarantor, calls `createForLegacyImport`, and increments `created` — with a version that runs the warning check right after `created++` but does **not** flag-and-skip (loan already exists at that point):

```ts
        try {
          const staff = await this.staffService.findByStaffId(rawStaffId);
          if (!staff) { flag('Staff ID not found'); continue; }
          const guarantor = await this.staffService.findByStaffId(rawGuarantorId);
          if (!guarantor) { flag('Guarantor Staff ID not found'); continue; }

          await this.loansService.createForLegacyImport(
            staff._id.toString(),
            guarantor._id.toString(),
            {
              principalAmount, tenureMonths, disbursedDate: disbursedDateRaw,
              status: status as LoanStatus, cutoverDate: cutoverDateRaw,
              guarantorRestitutionOwed, guarantorRestitutionPaid, chequeNo, pvNo, notes,
            },
            instalments,
            actorId,
            actorName,
          );
          created++;

          if (guarantorRestitutionOwed > 0) {
            const paidDates = instalments
              .map((inst) => inst.paidDate)
              .filter((d): d is Date => d !== undefined);
            if (paidDates.length > 0) {
              const asOfDate = new Date(Math.max(...paidDates.map((d) => d.getTime())));
              const defaulterBalance = await this.contributionsService.getBalance(staff._id.toString(), asOfDate);
              if (defaulterBalance > 0) {
                flag(
                  `Guarantor Restitution Owed may not reflect defaulter-first order — defaulter had ${defaulterBalance.toFixed(2)} available at the time`,
                );
              }
            }
          }
        } catch (err: unknown) {
          flag(err instanceof Error ? err.message : 'Processing error');
        }
```

Note: `flag(...)` here does not `continue` — the loop falls through to its natural end (there is no code after this `try/catch` inside the `for` body, so it proceeds to the next iteration exactly the same as if nothing were flagged, except the entry is now recorded).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest loans.legacy-import.service.spec.ts`
Expected: PASS — all pre-existing tests in this file plus the three new ones.

- [ ] **Step 5: Run the full affected test suite**

Run: `cd apps/api && npx jest loans.legacy-import.service.spec.ts loans.service.spec.ts contributions.service.spec.ts`
Expected: PASS — confirms the constructor change didn't break any other spec that instantiates `LoansLegacyImportService`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.legacy-import.service.ts apps/api/src/loans/loans.legacy-import.service.spec.ts
git commit -m "feat(loans): warn on legacy import rows whose guarantor restitution owed ignores defaulter balance"
```

---

## Self-Review Notes

- **Spec coverage:** Cross-reference against instalment Paid Dates ✅ (Task 2, `asOfDate` from max paid date). Query contributions using the mongosh `balanceBefore()` logic ✅ (Task 1, reused verbatim as `getBalance`'s date-bounded aggregation). Flag via existing `flaggedEntries` mechanism ✅ (Task 2 uses the existing `flag()` closure). Warn not block ✅ (Task 2 explicitly does not `continue` or decrement `created`). Constructor injection gap identified and closed ✅ (Task 2, `ContributionsModule` already imported by `LoansModule` so no module-file change is needed).
- **Placeholder scan:** No TBD/TODO; all steps have literal code.
- **Type consistency:** `getBalance(staffId: string, asOfDate?: Date)` signature in Task 1 matches the call site added in Task 2 exactly. `LegacyInstalmentInput.paidDate?: Date` (already defined in `loans.service.ts:44-51`) is the source of the `paidDates` array in Task 2 — types line up without casting beyond the existing `Date` filter.
- **Review Focus:** all five items each map to an explicit test — item 1 → Task 2 test 1 (owed = 0), item 2 → Task 2 test 4 (no Paid Date anywhere: no crash, no flag), item 3 → Task 2 test 3 (`created` still 1 when flagged), item 4 → satisfied by using `Math.max` over all paid dates rather than per-instalment (Task 2 test 2 asserts the exact `asOfDate` passed is the later of the two paid dates), item 5 → Task 1 test 2.
