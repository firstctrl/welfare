# Overdue Detection Defaulter-First Offset Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily overdue-instalment cron (`overdue-detection.job.ts`) tap the defaulter's own contributions before the guarantor's, matching the order already used by the end-of-tenure default recovery job, and produce a read-only report of historical loans that were guarantor-offset ahead of an available defaulter balance under the old order.

**Architecture:** `processOverdueInstalment` in `overdue-detection.job.ts` currently calls `debitGuarantorOffset` first and `debitDefaulterContribution` only for the shortfall — the reverse of the confirmed business policy. Swap the two calls (defaulter first, guarantor for the shortfall only), rename the local variables so they read correctly, and keep the existing `payments`/`source`/audit-log shape unchanged so nothing downstream (restitution tracking, UI) needs to change. A companion read-only mongosh script scans `auditlogs` for every `LoanRepayment` GuarantorOffset debit made by `'Overdue Detection Job'` and flags the ones where the defaulter had a nonzero contribution balance at that moment — this produces the candidate list the product owner needs before deciding on data remediation, but performs no writes.

**Tech Stack:** NestJS (TypeScript), Mongoose, Jest, mongosh for the diagnostic script.

**Spec:** This plan's spec is the business-policy confirmation quoted in the task request (product owner, 2026-09-25): defaulter's own contributions must be tapped before the guarantor's in every automated offset path. No separate spec doc exists; this plan document carries the requirement.

## Global Constraints

- Do not modify `default-recovery.job.ts` — it already implements the correct (defaulter-first) order and its existing tests must keep passing unchanged.
- Do not write to production data in this plan. The diagnostic script is read-only (no `updateOne`/`insertOne`/`deleteOne` calls). Remediation of historically-mis-ordered loans is an explicit policy decision deferred to the product owner and is out of scope for this plan.
- Preserve the existing `LoanRepayment` fields and their meaning: `inst.guarantorDebited`, `inst.borrowerDebited`, `inst.source` (`GuarantorOffset` when any guarantor amount was debited, `DefaulterDeduction` otherwise), `inst.payments[]` entry shape, and the `guarantorRestitutionOwed` increment gated on `guarantorDebited > 0`. These are read by other code (restitution redirect, UI); do not rename fields.
- Preserve the `ContributionsService.debitDefaulterContribution` / `debitGuarantorOffset` method signatures — only the call order and the arguments passed (amounts) change.

## Review Focus

- Defaulter has a partial balance that exactly covers part of the outstanding amount and guarantor also has a partial balance smaller than the remaining shortfall — instalment must land in `Partial` status with `finalRemaining > 0`, not silently treated as `Paid`.
- Zero-instalment-outstanding edge case (`outstanding <= 0` before this code runs, e.g. penalty waived) is unaffected by the reorder — confirm no regression to the "no debit calls occur" path (this is upstream of the block being changed, in `isGracePeriodExpired`/`outstanding` calc, and stays untouched).
- `inst.source` must still read `GuarantorOffset` (not `DefaulterDeduction`) in the mixed case where the defaulter covers most of the amount but the guarantor covers a nonzero remainder — the existing "mixed" test pins this and must keep passing after the reorder, just with the mock call order updated.
- The diagnostic script must not crash or hang scanning `auditlogs`/`contributions` on loans with legacy `legacyCutoverDate` semantics — it should treat legacy loans the same as any other loan when checking the defaulter's contribution balance at the debit timestamp (contribution rows are dated independent of loan legacy status).
- Existing `default-recovery.job.spec.ts` tests must be run (not just assumed) after this change, since `default-recovery.job.ts` shares the same `ContributionsService` mock method names and a mis-scoped test double could mask a regression there.

---

## File Structure

- Modify: `apps/api/src/loans/jobs/overdue-detection.job.ts` — swap debit order inside `processOverdueInstalment`.
- Modify: `apps/api/src/loans/jobs/overdue-detection.job.spec.ts` — update existing tests' mock call order/expectations to match the new order.
- Create: `apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js` — read-only diagnostic sweep producing the candidate list for the product owner's remediation decision.

### Task 1: Swap defaulter/guarantor debit order in the overdue-detection cron

**Files:**
- Modify: `apps/api/src/loans/jobs/overdue-detection.job.ts:100-171`
- Modify (existing tests): `apps/api/src/loans/jobs/overdue-detection.job.spec.ts`

**Interfaces:**
- Consumes: `ContributionsService.debitDefaulterContribution(staffId, amount, actorId, actorName, loanId?, instalmentNumber?): Promise<{debited: number; remaining: number}>` and `ContributionsService.debitGuarantorOffset(guarantorId, amount, loanId, actorId, actorName, borrowerStaffId?, instalmentNumber?): Promise<{debited: number; remaining: number}>` — both already exist in `apps/api/src/contributions/contributions.service.ts:309-375`, signatures unchanged.
- Produces: no new exports — `processOverdueInstalment` remains private; behavior change only.

- [ ] **Step 1: Update the four existing tests whose mock call order/args assume guarantor-first, so they fail against current code for the right reason (documents the target behavior before the fix)**

Replace the guarantor-offset-first test at lines 98–128 of `overdue-detection.job.spec.ts`:

```typescript
  it('triggers defaulter debit first, guarantor untouched when defaulter balance fully covers the shortfall', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    const loan = makeLoan('guarantor-id');
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(contributionsService.debitDefaulterContribution).toHaveBeenCalledWith(
      loan.staffId,
      expect.any(Number),
      'system',
      'Overdue Detection Job',
      'loan-1',
      undefined,
    );
    expect(contributionsService.debitGuarantorOffset).not.toHaveBeenCalled();
    expect(inst.status).toBe(LoanRepaymentStatus.Paid);
    expect(inst.source).toBe(RepaymentSource.DefaulterDeduction);

    global.Date = realNow;
  });
```

Replace the "insufficient guarantor balance" test at lines 130–152 with the guarantor-shortfall equivalent:

```typescript
  it('marks instalment Partial when both defaulter and guarantor balances are insufficient', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 1000, remaining: 3000 });
    // Guarantor also has no balance to cover the remaining shortfall
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 0, remaining: 3000 });

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Partial);
    expect(inst.paidAmount).toBe(1000);

    global.Date = realNow;
  });
```

Replace the "labels source DefaulterDeduction ... only the borrower is debited" test at lines 214–238 — rename for clarity and adjust which mock is set to zero (now the *guarantor* is the one left untouched, matching source `DefaulterDeduction`):

```typescript
  it('labels source DefaulterDeduction and records the split when only the defaulter is debited', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(inst.source).toBe(RepaymentSource.DefaulterDeduction);
    expect(inst.guarantorDebited).toBe(0);
    expect(inst.borrowerDebited).toBe(4000);
    expect(inst.payments).toHaveLength(1);
    expect(inst.payments[0]).toMatchObject({ amount: 4000, source: RepaymentSource.DefaulterDeduction });
    expect(contributionsService.debitGuarantorOffset).not.toHaveBeenCalled();

    global.Date = realNow;
  });
```

Replace the "mixed" test at lines 240–264 — defaulter now covers part, guarantor covers the rest, but `source` still reads `GuarantorOffset` per the existing business rule ("guarantor touched at all → GuarantorOffset"):

```typescript
  it('keeps source GuarantorOffset and records both split amounts when the payment is mixed', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 3000, remaining: 1000 });
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 1000, remaining: 0 });

    await job.detectAndProcess();

    expect(inst.source).toBe(RepaymentSource.GuarantorOffset);
    expect(inst.guarantorDebited).toBe(1000);
    expect(inst.borrowerDebited).toBe(3000);
    expect(inst.payments).toHaveLength(1);
    expect(inst.payments[0]).toMatchObject({ amount: 4000, source: RepaymentSource.GuarantorOffset });

    global.Date = realNow;
  });
```

Also update the `contributionsService` mock defaults in `beforeEach` (lines 35–38) so `debitDefaulterContribution` is the one with a safe zero default (it now runs unconditionally, same as `debitGuarantorOffset` used to):

```typescript
    contributionsService = {
      debitDefaulterContribution: jest.fn(),
      debitGuarantorOffset: jest.fn().mockResolvedValue({ debited: 0, remaining: 0 }),
    };
```

Add three new tests covering the Review Focus scenarios not yet pinned — insert after the "does not push a payments entry when nothing was debited" test (currently ends at line 287, just before the closing `});` of the `describe` block):

```typescript
  it('leaves the guarantor untouched when the defaulter balance fully covers the outstanding amount', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(contributionsService.debitGuarantorOffset).not.toHaveBeenCalled();
    expect(inst.guarantorDebited).toBe(0);
    expect(inst.borrowerDebited).toBe(4000);

    global.Date = realNow;
  });

  it('debits the guarantor only for the shortfall when the defaulter has a partial balance', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    const loan = makeLoan('guarantor-id');
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 2500, remaining: 1500 });
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 1500, remaining: 0 });

    await job.detectAndProcess();

    expect(contributionsService.debitGuarantorOffset).toHaveBeenCalledWith(
      'guarantor-id',
      1500,
      'loan-1',
      'system',
      'Overdue Detection Job',
      loan.staffId,
      undefined,
    );
    expect(inst.status).toBe(LoanRepaymentStatus.Paid);
    expect(inst.guarantorDebited).toBe(1500);
    expect(inst.borrowerDebited).toBe(2500);

    global.Date = realNow;
  });

  it('covers the full outstanding amount from the guarantor when the defaulter has zero balance', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) { super('2026-05-19'); } else { super(...(args as [any])); }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 0, remaining: 4000 });
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Paid);
    expect(inst.guarantorDebited).toBe(4000);
    expect(inst.borrowerDebited).toBe(0);
    expect(inst.source).toBe(RepaymentSource.GuarantorOffset);

    global.Date = realNow;
  });
```

- [ ] **Step 2: Run the updated test file and confirm the new/changed tests fail against current (unswapped) code**

Run: `docker exec welfare-api npx jest apps/api/src/loans/jobs/overdue-detection.job.spec.ts`
Expected: FAIL — the "leaves the guarantor untouched" and "defaulter debit first" tests fail because current code calls `debitGuarantorOffset` before `debitDefaulterContribution` (mock returns default `{debited: 0, remaining: 0}` for `debitDefaulterContribution` since it's now called second with a different amount than the test set up, so amounts/call-order assertions fail).

- [ ] **Step 3: Swap the debit order in `processOverdueInstalment`**

Replace `apps/api/src/loans/jobs/overdue-detection.job.ts:100-171`:

```typescript
    const { debited: defaulterDebited, remaining: afterDefaulter } =
      await this.contributionsService.debitDefaulterContribution(
        loan.staffId,
        outstanding,
        'system',
        'Overdue Detection Job',
        inst.loanId,
        inst.instalmentNumber,
      );

    // Shortfall not covered by defaulter's own contributions: debit guarantor
    let guarantorDebited = 0;
    let finalRemaining = afterDefaulter;
    if (afterDefaulter > 0) {
      const { debited, remaining } = await this.contributionsService.debitGuarantorOffset(
        loan.guarantorId,
        afterDefaulter,
        inst.loanId,
        'system',
        'Overdue Detection Job',
        loan.staffId,
        inst.instalmentNumber,
      );
      guarantorDebited = debited;
      finalRemaining = remaining;
    }

    const totalDebited = round2(guarantorDebited + defaulterDebited);
    if (totalDebited > 0) {
      inst.paidAmount = round2(inst.paidAmount + totalDebited);
      inst.guarantorStaffId = loan.guarantorId;
      inst.source = guarantorDebited > 0 ? RepaymentSource.GuarantorOffset : RepaymentSource.DefaulterDeduction;
      inst.guarantorDebited = round2((inst.guarantorDebited ?? 0) + guarantorDebited);
      inst.borrowerDebited = round2((inst.borrowerDebited ?? 0) + defaulterDebited);
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

      // Borrower owes guarantor whatever guarantor lost. Restitution is paid
      // back to guarantor over time via handleRestitutionRedirect on future
      // borrower contributions, and any unpaid remainder on loan settlement.
      if (guarantorDebited > 0) {
        await this.loanModel.updateOne(
          { _id: loan._id },
          { $inc: { guarantorRestitutionOwed: guarantorDebited } },
        );
      }

      this.auditService.log(
        'system',
        'Overdue Detection Job',
        AuditAction.Update,
        AuditEntity.LoanRepayment,
        inst._id.toString(),
        undefined,
        {
          guarantorDebited,
          borrowerDebited: defaulterDebited,
          remaining: finalRemaining,
          guarantorId: loan.guarantorId,
        },
      );
    }
```

- [ ] **Step 4: Run the overdue-detection test file and confirm all tests pass**

Run: `docker exec welfare-api npx jest apps/api/src/loans/jobs/overdue-detection.job.spec.ts`
Expected: PASS — all tests including the three new ones.

- [ ] **Step 5: Run the default-recovery test file to confirm it is unaffected**

Run: `docker exec welfare-api npx jest apps/api/src/loans/jobs/default-recovery.job.spec.ts`
Expected: PASS — no changes made to `default-recovery.job.ts`, existing defaulter-first tests continue to pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/jobs/overdue-detection.job.ts apps/api/src/loans/jobs/overdue-detection.job.spec.ts
git commit -m "fix(loans): tap defaulter contributions before guarantor in overdue cron

Per-instalment overdue detection was debiting the guarantor first and
the defaulter's own contributions only for the shortfall — the reverse
of end-of-tenure default recovery and of confirmed business policy.
Swap the order so defaulter-first applies consistently across both
automated offset paths."
```

### Task 2: Read-only diagnostic sweep for historically guarantor-first-offset loans

**Files:**
- Create: `apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js`

**Interfaces:**
- Consumes: MongoDB collections `auditlogs`, `contributions`, `loan_repayments` (same collections and field shapes used by `remediate-backdated-loan-completions.mongosh.js`, e.g. `auditlogs.entity`, `auditlogs.actorName`, `auditlogs.entityId`, `auditlogs.createdAt`, `contributions.staffId`, `contributions.isDebit`, `contributions.paidAmount`, `contributions.createdAt`).
- Produces: stdout report only (one JSON line per candidate loan/instalment) — no collection writes, no return value consumed by other tasks.

- [ ] **Step 1: Write the script**

Create `apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js`:

```javascript
// Read-only diagnostic sweep: find every LoanRepayment GuarantorOffset debit
// made by the "Overdue Detection Job" cron (per auditlogs, entity=LoanRepayment,
// actorName='Overdue Detection Job') and check whether the defaulter's own
// contribution balance was nonzero at that debit's timestamp. If so, the
// guarantor was wrongly tapped ahead of a defaulter who had funds available
// under the pre-fix debit order (see overdue-detection.job.ts). This performs
// NO writes — it is a report to inform a policy decision on whether to
// remediate historical loans, not a remediation script itself.
//
// Usage:
//   docker cp apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js welfare-mongodb:/tmp/
//   docker exec -it welfare-mongodb mongosh \
//     "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" \
//     /tmp/diagnose-guarantor-first-order.mongosh.js
(function () {
  var auditLogs = db.getCollection('auditlogs');
  var contributions = db.getCollection('contributions');
  var repayments = db.getCollection('loan_repayments');
  var loans = db.getCollection('loans');

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // Every audit entry the cron wrote for a repayment it touched with a
  // nonzero guarantorDebited.
  var auditEntries = auditLogs
    .find({
      entity: 'LoanRepayment',
      actorName: 'Overdue Detection Job',
      'after.guarantorDebited': { $gt: 0 },
    })
    .toArray();

  print('Found ' + auditEntries.length + ' guarantor-offset audit entries from Overdue Detection Job');

  var candidates = [];

  auditEntries.forEach(function (entry) {
    var repaymentId = entry.entityId;
    var repayment = repayments.findOne({ _id: ObjectId(repaymentId) });
    if (!repayment) {
      print('SKIP: repayment ' + repaymentId + ' not found (may have been reversed)');
      return;
    }

    var loan = loans.findOne({ _id: ObjectId(repayment.loanId) });
    if (!loan) {
      print('SKIP: loan ' + repayment.loanId + ' not found for repayment ' + repaymentId);
      return;
    }

    var debitTimestamp = entry.createdAt;

    // Defaulter's contribution balance at the moment of this debit: sum of
    // all non-debit (credit) contribution rows minus all debit rows for the
    // defaulter, dated up to (and including) the debit timestamp.
    var defaulterContribs = contributions
      .find({ staffId: loan.staffId, createdAt: { $lte: debitTimestamp } })
      .toArray();

    var balanceAtDebitTime = round2(
      defaulterContribs.reduce(function (sum, c) {
        return sum + (c.isDebit ? -c.paidAmount : c.paidAmount);
      }, 0),
    );

    if (balanceAtDebitTime > 0) {
      candidates.push({
        loanId: repayment.loanId,
        repaymentId: repaymentId,
        instalmentNumber: repayment.instalmentNumber,
        guarantorDebited: entry.after.guarantorDebited,
        borrowerDebited: entry.after.borrowerDebited,
        defaulterBalanceAtDebitTime: balanceAtDebitTime,
        debitTimestamp: debitTimestamp,
        staffId: loan.staffId,
        guarantorId: loan.guarantorId,
      });
    }
  });

  print('Remediation candidates (guarantor debited while defaulter had a nonzero balance): ' + candidates.length);
  candidates.forEach(function (c) {
    print(JSON.stringify(c));
  });
})();
```

- [ ] **Step 2: Run the script against the dev database and confirm it produces output without errors**

Run:
```bash
docker cp apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js welfare-mongodb:/tmp/
docker exec -it welfare-mongodb mongosh "mongodb://admin:xxxxx@localhost:27017/welfare?authSource=admin" /tmp/diagnose-guarantor-first-order.mongosh.js
```
Expected: script prints the count of audit entries scanned, then one JSON line per candidate (possibly zero, if dev data has none) — no thrown errors, no `updateOne`/`insertOne` calls anywhere in the script (verify by inspection: `grep -n "updateOne\|insertOne\|deleteOne\|updateMany\|deleteMany" apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js` returns nothing).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/loans/migrations/diagnose-guarantor-first-order.mongosh.js
git commit -m "chore(loans): add read-only sweep for guarantor-first-offset candidates

Scans auditlogs for Overdue Detection Job guarantor debits and flags
ones where the defaulter had a contribution balance available at debit
time. Produces the candidate list for the pending product-owner
decision on whether to remediate historical loans; performs no writes."
```

## Out of scope (explicit policy decision required before proceeding)

Whether to reverse-and-redebit the historical loans the Task 2 sweep surfaces is a policy call for the product owner, not a technical one — do not act on the candidate list until that's answered. If remediation is approved, write a follow-up plan for the write-path script (`remediate-...-mongosh.js`) modeled on `remediate-backdated-loan-completions.mongosh.js`'s dry-run/`--eval "var CONFIRM=true"` pattern, scoped to exactly the loan IDs the sweep names — not a re-scan at remediation time, since balances may have moved on.
