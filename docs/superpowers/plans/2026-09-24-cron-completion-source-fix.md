# Cron Completion Gap & Repayment Source Mislabeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two prod-confirmed bugs — cron jobs never flip fully-repaid loans to
`Completed`, and `overdue-detection.job.ts` mislabels split guarantor/borrower repayment
sources — then remediate the 5 affected prod loans and 6 mislabeled repayment rows with a
scoped, dry-run-first script.

**Architecture:** Promote `LoansService.checkAndCompleteIfDone` to public and call it from
both cron jobs after each loan they process (reuses existing completion/restitution/sync
logic verbatim). Add `guarantorDebited`/`borrowerDebited` amount fields to the repayment
schema plus a new `RepaymentSource.DefaulterDeduction` enum value so the overdue job can
label and record each debit's actual source. A standalone mongoose migration script
(matching the existing `apps/api/src/loans/migrations/` convention) performs the one-off
prod remediation.

**Tech Stack:** NestJS, Mongoose, Jest, ts-node (for the migration script).

**Spec:** `docs/superpowers/specs/2026-09-24-cron-completion-source-fix-design.md`

## Global Constraints

- `checkAndCompleteIfDone(loanId: string, actorId: string, actorName: string):
  Promise<void>` keeps its exact existing signature — only its visibility changes.
- New `RepaymentSource.DefaulterDeduction` enum value, mirroring existing
  `ContributionSource.DefaulterDeduction` naming.
- `guarantorDebited`/`borrowerDebited` are `@Prop({ min: 0 })` optional numbers on both
  `LoanRepayment` and `PaymentEntry`.
- `guarantorDebited > 0` (even when `borrowerDebited` is also > 0) → label stays
  `GuarantorOffset`. Only `guarantorDebited === 0 && borrowerDebited > 0` uses the new
  `DefaulterDeduction` label.
- Migration script default is dry run (no writes) unless `--confirm` is passed — this
  intentionally diverges from `backfill-payment-history.ts`'s `--dry-run`-to-opt-in-safe
  convention, because this script's writes affect real financial state (loan status +
  guarantor restitution) on specific named prod records, not a blanket backfill.
- Migration script hardcodes the exact 5 loan IDs and 6 (loanId, instalmentNumber) pairs
  from the bug report — not a general-purpose tool, never scans for "similar" cases.

## Review Focus

- A loan fully paid by a *manual* `recordPayment` call already calls
  `checkAndCompleteIfDone` via `recordPaymentInternal` — Task 1's job-level calls must not
  double-fire `settleGuarantorRestitution` for a loan that reaches full payoff through a
  mix of manual payments and job-driven debits in the same day. Covered by
  `checkAndCompleteIfDone`'s existing `findOneAndUpdate({ status: Active }, ...)` guard,
  which only succeeds once — Task 1's tests confirm calling it twice in a row is a no-op
  the second time.
- Overdue job instalment where `guarantorDebited` and `borrowerDebited` are both 0 (grace
  period expired but no contribution balance anywhere) — must not push a spurious
  `payments` entry or flip status, since `totalDebited === 0` already guards the whole
  block. Task 2's tests confirm the zero-debit path leaves `payments` untouched.
- Legacy loan instalments (pre-cutover, `legacy: true`) never reach
  `processOverdueInstalment`'s debit logic (early return at job line 82-84) — Task 1's
  `checkAndCompleteIfDone` call must still not fire for those, confirmed by the existing
  "does not touch a legacy loan instalment" test continuing to pass unmodified.
- Migration script's re-verification step (Task 3) must independently recompute "is this
  loan actually fully paid" rather than trusting the bug report's snapshot — a loan could
  have had a manual write-off or payment applied between report time and remediation time.
  Task 3's tests cover a loan that no longer qualifies being skipped, not force-processed.
- `default-recovery.job.ts`'s `detectAndMarkDefaulted` (the *other* cron in that file) must
  not gain a `checkAndCompleteIfDone` call — a loan just marked `Defaulted` cannot
  simultaneously be fully paid, and calling it there would be dead code. Task 1 only
  touches `runGracePeriodRecovery`.

---

### Task 1: Wire `checkAndCompleteIfDone` into both cron jobs

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts:676` (visibility only)
- Modify: `apps/api/src/loans/jobs/overdue-detection.job.ts`
- Modify: `apps/api/src/loans/jobs/default-recovery.job.ts`
- Test: `apps/api/src/loans/jobs/overdue-detection.job.spec.ts`
- Test: `apps/api/src/loans/jobs/default-recovery.job.spec.ts`

**Interfaces:**
- Consumes: `LoansService.checkAndCompleteIfDone(loanId: string, actorId: string,
  actorName: string): Promise<void>` (existing method, made public — no signature change).
- Produces: nothing new consumed by later tasks — Task 2 and 3 are independent of this
  task's changes.

- [ ] **Step 1: Write the failing test — overdue job calls checkAndCompleteIfDone**

Add to `overdue-detection.job.spec.ts`, inside the existing `describe('OverdueDetectionJob'`
block. First add a `loansService` mock to the existing `beforeEach`'s providers array and
mock declarations:

```ts
// in the outer describe, alongside the other `let` declarations:
let loansService: any;

// in beforeEach, alongside the other mock object literals:
loansService = { checkAndCompleteIfDone: jest.fn().mockResolvedValue(undefined) };

// in the providers array passed to Test.createTestingModule, add:
{ provide: LoansService, useValue: loansService },
```
Add the import at the top: `import { LoansService } from '../loans.service';`.

Then add the new test:

```ts
it('calls checkAndCompleteIfDone for the instalment\'s loan after processing it', async () => {
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
  contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 4000, remaining: 0 });

  await job.detectAndProcess();

  expect(loansService.checkAndCompleteIfDone).toHaveBeenCalledWith('loan-1', 'system', 'Overdue Detection Job');

  global.Date = realNow;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest overdue-detection.job.spec.ts -t "calls checkAndCompleteIfDone"`
Expected: FAIL — `Nest can't resolve dependencies of OverdueDetectionJob` (LoansService not
yet injected) or `loansService.checkAndCompleteIfDone` never called, depending on how far
the test module compiles. Either failure confirms the wiring doesn't exist yet.

- [ ] **Step 3: Make `checkAndCompleteIfDone` public and inject `LoansService` into the job**

`apps/api/src/loans/loans.service.ts:676` — change:
```ts
  private async checkAndCompleteIfDone(
```
to:
```ts
  async checkAndCompleteIfDone(
```

`apps/api/src/loans/jobs/overdue-detection.job.ts` — add the import and constructor param:
```ts
import { LoansService } from '../loans.service';
```
```ts
  constructor(
    @InjectModel(LoanRepayment.name)
    private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
    private readonly emailService: EmailService,
    private readonly loansService: LoansService,
  ) {}
```

Update the loop in `detectAndProcess()` (currently lines 65-71):
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest overdue-detection.job.spec.ts`
Expected: all tests in the file PASS, including the new one.

- [ ] **Step 5: Write the failing test — default-recovery job calls checkAndCompleteIfDone**

Add to `default-recovery.job.spec.ts`, inside `describe('runGracePeriodRecovery (Cron 2)'`.
First add `loansService` the same way as Step 1 (new `let` in the outer describe, mock in
`beforeEach`, provider in the module, import `LoansService` at top of file).

```ts
it('calls checkAndCompleteIfDone for the loan after recovery runs', async () => {
  const loan = makeDefaultedLoan();
  const inst = makeInstalment(5000);

  loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
  repaymentModel.find
    .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) })
    .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) });
  loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 5000, remaining: 0 });

  await job.runGracePeriodRecovery();

  expect(loansService.checkAndCompleteIfDone).toHaveBeenCalledWith('loan-1', 'system', 'DefaultRecoveryJob');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/api && npx jest default-recovery.job.spec.ts -t "calls checkAndCompleteIfDone"`
Expected: FAIL — same reason as Step 2 (dependency not resolvable, or spy never called).

- [ ] **Step 7: Inject `LoansService` into `DefaultRecoveryJob` and call it after recovery**

`apps/api/src/loans/jobs/default-recovery.job.ts` — add the import and constructor param:
```ts
import { LoansService } from '../loans.service';
```
```ts
  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
    private readonly loansService: LoansService,
  ) {}
```

Update the loop in `runGracePeriodRecovery()` (currently lines 123-129):
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

Do **not** add a call inside `detectAndMarkDefaulted()` — see Review Focus.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd apps/api && npx jest default-recovery.job.spec.ts`
Expected: all tests in the file PASS, including the new one.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/loans/loans.service.ts apps/api/src/loans/jobs/overdue-detection.job.ts apps/api/src/loans/jobs/default-recovery.job.ts apps/api/src/loans/jobs/overdue-detection.job.spec.ts apps/api/src/loans/jobs/default-recovery.job.spec.ts
git commit -m "fix(loans): flip cron-driven loans to Completed and settle restitution on full payoff"
```

---

### Task 2: Accurate repayment source + split amounts on the overdue job

**Files:**
- Modify: `packages/shared/src/enums/repayment-source.enum.ts`
- Modify: `apps/api/src/loans/schemas/loan-repayment.schema.ts`
- Modify: `apps/api/src/loans/jobs/overdue-detection.job.ts`
- Test: `apps/api/src/loans/jobs/overdue-detection.job.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `RepaymentSource.DefaulterDeduction` (new enum member), `guarantorDebited?:
  number` / `borrowerDebited?: number` on `LoanRepayment` and `PaymentEntry` — Task 3's
  migration script reads/writes these same field names.

- [ ] **Step 1: Add the new enum value**

`packages/shared/src/enums/repayment-source.enum.ts`:
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

Rebuild the shared package so the API/worktree picks up the new export:
```bash
cd packages/shared && npm run build
```

- [ ] **Step 2: Add the schema fields**

`apps/api/src/loans/schemas/loan-repayment.schema.ts` — add to `PaymentEntry` (after line
14's `source` prop):
```ts
  @Prop({ min: 0 }) guarantorDebited?: number;
  @Prop({ min: 0 }) borrowerDebited?: number;
```
And to `LoanRepayment` (after line 36's `source` prop):
```ts
  @Prop({ min: 0 }) guarantorDebited?: number;
  @Prop({ min: 0 }) borrowerDebited?: number;
```

- [ ] **Step 3: Write the failing test — pure guarantor-covered instalment**

Add to `overdue-detection.job.spec.ts`. First, update `makeInstalment` (the factory at the
top of the file) to include `guarantorDebited`, `borrowerDebited`, and a `payments` array
with a `push` your assertions can inspect:
```ts
const makeInstalment = (loanId = 'loan-1', overrideDate = pastDate) => ({
  _id: { toString: () => 'inst-1' },
  loanId,
  dueDate: overrideDate,
  dueAmount: 3500,
  paidAmount: 0,
  penaltyAmount: 0,
  status: LoanRepaymentStatus.Pending,
  source: undefined as any,
  guarantorDebited: undefined as any,
  borrowerDebited: undefined as any,
  guarantorStaffId: undefined as any,
  paidDate: undefined as any,
  payments: [] as any[],
  save: jest.fn().mockResolvedValue(undefined),
});
```

Then add the test:
```ts
it('labels source DefaulterDeduction and records the split when only the borrower is debited', async () => {
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
  contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 0, remaining: 4000 });
  contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 4000, remaining: 0 });

  await job.detectAndProcess();

  expect(inst.source).toBe(RepaymentSource.DefaulterDeduction);
  expect(inst.guarantorDebited).toBe(0);
  expect(inst.borrowerDebited).toBe(4000);
  expect(inst.payments).toHaveLength(1);
  expect(inst.payments[0]).toMatchObject({ amount: 4000, source: RepaymentSource.DefaulterDeduction });

  global.Date = realNow;
});

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
  contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 1000, remaining: 3000 });
  contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 3000, remaining: 0 });

  await job.detectAndProcess();

  expect(inst.source).toBe(RepaymentSource.GuarantorOffset);
  expect(inst.guarantorDebited).toBe(1000);
  expect(inst.borrowerDebited).toBe(3000);
  expect(inst.payments).toHaveLength(1);
  expect(inst.payments[0]).toMatchObject({ amount: 4000, source: RepaymentSource.GuarantorOffset });

  global.Date = realNow;
});

it('does not push a payments entry when nothing was debited', async () => {
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
  contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 0, remaining: 4000 });
  contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 0, remaining: 4000 });

  await job.detectAndProcess();

  expect(inst.payments).toHaveLength(0);
  expect(inst.source).toBeUndefined();

  global.Date = realNow;
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd apps/api && npx jest overdue-detection.job.spec.ts -t "DefaulterDeduction\|mixed\|nothing was debited"`
Expected: the three new tests FAIL — `inst.source` is `GuarantorOffset` for all of them
(current hardcoded behavior) or `inst.guarantorDebited`/`borrowerDebited`/`payments` are
never set (fields/push don't exist yet). The "does not push" test may already pass
incidentally (since nothing is pushed anywhere today) — if so, note it and move on; the
other two must show a real failure.

- [ ] **Step 5: Implement the split-aware source logic**

`apps/api/src/loans/jobs/overdue-detection.job.ts` — add `PaymentEntryType` to the
`@welfare/shared` import list at the top, then replace lines 123-130:
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
```
(the rest of the block — the `guarantorRestitutionOwed` increment and `auditService.log`
call — stays exactly as-is, just re-indented if needed; do not change it.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && npx jest overdue-detection.job.spec.ts`
Expected: all tests in the file PASS. Also re-run the existing "triggers guarantor offset"
test (line 91 originally) — it asserts `inst.source === RepaymentSource.GuarantorOffset`
for a pure-guarantor case, which the new logic still produces (`guarantorDebited > 0` and
`borrowerDebited === 0` since `debitDefaulterContribution` is mocked to return `{ debited:
0, remaining: 0 }` by default in that test) — confirm it's still green, not just the new
tests.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/enums/repayment-source.enum.ts apps/api/src/loans/schemas/loan-repayment.schema.ts apps/api/src/loans/jobs/overdue-detection.job.ts apps/api/src/loans/jobs/overdue-detection.job.spec.ts
git commit -m "fix(loans): label overdue-job repayment source from actual debit split, not hardcoded GuarantorOffset"
```

---

### Task 3: Prod remediation script

**Files:**
- Create: `apps/api/src/loans/migrations/remediate-backdated-loan-completions.ts`
- Test: `apps/api/src/loans/migrations/remediate-backdated-loan-completions.spec.ts`

**Interfaces:**
- Consumes: `RepaymentSource.DefaulterDeduction`, `guarantorDebited`/`borrowerDebited`
  field names from Task 2. `LoansService.checkAndCompleteIfDone` is **not** reused here —
  this script runs standalone via plain mongoose (matching
  `backfill-payment-history.ts`'s pattern), with no NestJS DI container, so it
  reimplements just the status-flip + restitution-settle writes directly against the
  collections. This mirrors how `backfill-payment-history.ts` already works outside Nest.
- Produces: nothing consumed by other tasks — this is the last task.

**Context on the 5 loans and 6 rows** (from the bug report, hardcoded into the script):
```
Loans (all: verify every instalment Paid, status Active, restitutionOwed > restitutionPaid):
  6ab2af16b8b481275230b68c  guarantorRestitutionOwed=1600
  6ab2af95b8b481275230b6de  guarantorRestitutionOwed=3540
  6ab2b26cb8b481275230b832  guarantorRestitutionOwed=1023
  6ab2b314b8b481275230b8cc  guarantorRestitutionOwed=940
  6ab2b4acb8b481275230b9de  guarantorRestitutionOwed=4380

Mislabeled repayment rows (loanId, instalmentNumber) — currently source=GuarantorOffset,
actually 100% DefaulterDeduction per matching Contribution debit rows:
  6ab2b4acb8b481275230b9de  #8, #9, #10, #11, #12
  6ab2af16b8b481275230b68c  #12
```

- [ ] **Step 1: Write the failing test — dry run makes no writes**

Create `apps/api/src/loans/migrations/remediate-backdated-loan-completions.spec.ts`. This
script uses plain mongoose models constructed inline (no Nest DI), so the test imports the
script's exported pure functions rather than spinning up a Nest testing module — structure
the script so its core logic is exported and testable, with only the top-level `run()` /
CLI-arg-parsing wrapper doing the `mongoose.connect`/`process.exit` side effects (same
separation `backfill-payment-history.ts` doesn't have, but this script needs it to be
testable — see spec's "Migration script's re-verification step" Review Focus item, which
requires unit coverage of the skip logic).

```ts
import { remediateLoan, backfillRepaymentSource } from './remediate-backdated-loan-completions';
import { RepaymentSource } from '@welfare/shared';

describe('remediate-backdated-loan-completions', () => {
  describe('remediateLoan', () => {
    const makeQualifyingLoan = () => ({
      _id: { toString: () => 'loan-1' },
      status: 'Active',
      guarantorId: 'g-1',
      guarantorRestitutionOwed: 1600,
      guarantorRestitutionPaid: 0,
    });

    it('does not write anything in dry-run mode even when the loan qualifies', async () => {
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeQualifyingLoan()) }),
        updateOne: jest.fn(),
      };
      const repaymentModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ status: 'Paid' }]) }),
      };
      const contributionModel = { create: jest.fn() };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel } as any, false);

      expect(result.action).toBe('would-settle');
      expect(loanModel.updateOne).not.toHaveBeenCalled();
      expect(contributionModel.create).not.toHaveBeenCalled();
    });

    it('skips and does not write when the loan no longer qualifies (already settled)', async () => {
      const loan = { ...makeQualifyingLoan(), guarantorRestitutionPaid: 1600 };
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) }),
        updateOne: jest.fn(),
      };
      const repaymentModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ status: 'Paid' }]) }) };
      const contributionModel = { create: jest.fn() };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(loanModel.updateOne).not.toHaveBeenCalled();
    });

    it('skips and does not write when an instalment is still unpaid', async () => {
      const loan = makeQualifyingLoan();
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) }),
        updateOne: jest.fn(),
      };
      const repaymentModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ status: 'Paid' }, { status: 'Pending' }]) }) };
      const contributionModel = { create: jest.fn() };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(loanModel.updateOne).not.toHaveBeenCalled();
    });

    it('settles restitution, flips status to Completed, and writes an audit row when confirmed and loan qualifies', async () => {
      const loan = makeQualifyingLoan();
      const loanModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) }),
        updateOne: jest.fn().mockResolvedValue({}),
      };
      const repaymentModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ status: 'Paid' }]) }) };
      const contributionModel = { create: jest.fn().mockResolvedValue({}) };
      const auditModel = { create: jest.fn().mockResolvedValue({}) };

      const result = await remediateLoan('loan-1', { loanModel, repaymentModel, contributionModel, auditModel } as any, true);

      expect(result.action).toBe('settled');
      expect(loanModel.updateOne).toHaveBeenCalledWith(
        { _id: 'loan-1' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'Completed' }), $inc: { guarantorRestitutionPaid: 1600 } }),
      );
      expect(contributionModel.create).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'g-1', paidAmount: 1600, isDebit: false }));
      expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Loan', entityId: 'loan-1' }));
    });
  });

  describe('backfillRepaymentSource', () => {
    it('does not write in dry-run mode', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'r1', loanId: 'loan-1', instalmentNumber: 12 }) }),
        updateOne: jest.fn(),
      };
      const contributionModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ source: 'DefaulterDeduction', paidAmount: 400 }]) }),
      };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel } as any, false);

      expect(result.action).toBe('would-backfill');
      expect(repaymentModel.updateOne).not.toHaveBeenCalled();
    });

    it('backfills source and split amounts from matching Contribution debit rows and writes an audit row when confirmed', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'r1', loanId: 'loan-1', instalmentNumber: 12 }) }),
        updateOne: jest.fn().mockResolvedValue({}),
      };
      const contributionModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ source: 'DefaulterDeduction', paidAmount: 400 }]) }),
      };
      const auditModel = { create: jest.fn().mockResolvedValue({}) };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel, auditModel } as any, true);

      expect(result.action).toBe('backfilled');
      expect(repaymentModel.updateOne).toHaveBeenCalledWith(
        { _id: 'r1' },
        { $set: { source: RepaymentSource.DefaulterDeduction, guarantorDebited: 0, borrowerDebited: 400 } },
      );
      expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ entity: 'LoanRepayment', entityId: 'r1' }));
    });

    it('skips when no matching repayment row is found', async () => {
      const repaymentModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
        updateOne: jest.fn(),
      };
      const contributionModel = { find: jest.fn() };

      const result = await backfillRepaymentSource('loan-1', 12, { repaymentModel, contributionModel } as any, true);

      expect(result.action).toBe('skipped');
      expect(repaymentModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest remediate-backdated-loan-completions.spec.ts`
Expected: FAIL — `Cannot find module './remediate-backdated-loan-completions'` (file
doesn't exist yet).

- [ ] **Step 3: Implement the script**

Create `apps/api/src/loans/migrations/remediate-backdated-loan-completions.ts`:
```ts
/**
 * One-off remediation for 5 prod loans created with a backdated disbursedDate
 * instead of going through loans.legacy-import.service.ts. The daily overdue
 * cron treated a year of backdated instalments as live arrears and paid them
 * all off in one sweep, but the (now-fixed) cron-completion gap meant these
 * loans never flipped to Completed or settled guarantor restitution, and the
 * (now-fixed) source-mislabeling bug left 6 repayment rows tagged
 * GuarantorOffset when they were actually 100% DefaulterDeduction.
 *
 * This script is scoped to exactly the loan IDs / instalment numbers below —
 * it does not scan for "similar" cases. Re-verifies each record's current
 * state before writing (state may have changed since the bug report).
 *
 * Usage: npx ts-node -r tsconfig-paths/register apps/api/src/loans/migrations/remediate-backdated-loan-completions.ts
 * Default is a DRY RUN (no writes). Pass --confirm to actually write.
 */
import mongoose from 'mongoose';
import { RepaymentSource } from '@welfare/shared';

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare';
const CONFIRM = process.argv.includes('--confirm');

const LOAN_IDS = [
  '6ab2af16b8b481275230b68c',
  '6ab2af95b8b481275230b6de',
  '6ab2b26cb8b481275230b832',
  '6ab2b314b8b481275230b8cc',
  '6ab2b4acb8b481275230b9de',
];

const MISLABELED_ROWS: Array<{ loanId: string; instalmentNumber: number }> = [
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 8 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 9 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 10 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 11 },
  { loanId: '6ab2b4acb8b481275230b9de', instalmentNumber: 12 },
  { loanId: '6ab2af16b8b481275230b68c', instalmentNumber: 12 },
];

const LoanSchema = new mongoose.Schema({
  status: String,
  guarantorId: String,
  guarantorRestitutionOwed: Number,
  guarantorRestitutionPaid: Number,
}, { collection: 'loans' });

const LoanRepaymentSchema = new mongoose.Schema({
  loanId: String,
  instalmentNumber: Number,
  status: String,
}, { collection: 'loan_repayments' });

const ContributionSchema = new mongoose.Schema({
  loanId: String,
  instalmentNumber: Number,
  source: String,
  paidAmount: Number,
  isDebit: Boolean,
}, { collection: 'contributions' });

const AuditLogSchema = new mongoose.Schema({
  actorId: String,
  actorName: String,
  action: String,
  entity: String,
  entityId: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'auditlogs' });

type Models = {
  loanModel: any;
  repaymentModel: any;
  contributionModel: any;
  auditModel: any;
};

export async function remediateLoan(
  loanId: string,
  models: Models,
  confirm: boolean,
): Promise<{ loanId: string; action: 'settled' | 'would-settle' | 'skipped'; reason?: string }> {
  const loan = await models.loanModel.findById(loanId).exec();
  if (!loan) return { loanId, action: 'skipped', reason: 'loan not found' };
  if (loan.status !== 'Active') return { loanId, action: 'skipped', reason: `status is ${loan.status}, not Active` };

  const owed = (loan.guarantorRestitutionOwed ?? 0) - (loan.guarantorRestitutionPaid ?? 0);
  if (owed <= 0) return { loanId, action: 'skipped', reason: 'no outstanding restitution' };

  const unpaid = await models.repaymentModel.find({ loanId, status: { $ne: 'Paid' } }).exec();
  if (unpaid.length > 0) return { loanId, action: 'skipped', reason: `${unpaid.length} instalment(s) not Paid` };

  if (!confirm) return { loanId, action: 'would-settle' };

  const now = new Date();
  await models.contributionModel.create({
    staffId: loan.guarantorId,
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    expectedAmount: 0,
    paidAmount: owed,
    surplusCarriedForward: 0,
    isDebit: false,
    status: 'Paid',
    source: 'DefaulterRestitution',
    loanId,
    recordedBy: 'remediation-script',
  });

  await models.loanModel.updateOne(
    { _id: loanId },
    { $set: { status: 'Completed' }, $inc: { guarantorRestitutionPaid: owed } },
  );

  await models.auditModel.create({
    actorId: 'remediation-script',
    actorName: 'remediate-backdated-loan-completions',
    action: 'Update',
    entity: 'Loan',
    entityId: loanId,
    before: { status: 'Active', guarantorRestitutionPaid: loan.guarantorRestitutionPaid ?? 0 },
    after: { status: 'Completed', guarantorRestitutionPaid: (loan.guarantorRestitutionPaid ?? 0) + owed },
  });

  return { loanId, action: 'settled' };
}

export async function backfillRepaymentSource(
  loanId: string,
  instalmentNumber: number,
  models: Pick<Models, 'repaymentModel' | 'contributionModel'> & Partial<Pick<Models, 'auditModel'>>,
  confirm: boolean,
): Promise<{ loanId: string; instalmentNumber: number; action: 'backfilled' | 'would-backfill' | 'skipped'; reason?: string }> {
  const row = await models.repaymentModel.findOne({ loanId, instalmentNumber }).exec();
  if (!row) return { loanId, instalmentNumber, action: 'skipped', reason: 'repayment row not found' };

  const debits = await models.contributionModel
    .find({ loanId, instalmentNumber, isDebit: true })
    .exec();

  const guarantorDebited = debits
    .filter((d: any) => d.source === 'GuarantorOffset')
    .reduce((sum: number, d: any) => sum + d.paidAmount, 0);
  const borrowerDebited = debits
    .filter((d: any) => d.source === 'DefaulterDeduction')
    .reduce((sum: number, d: any) => sum + d.paidAmount, 0);

  const source = guarantorDebited > 0 ? RepaymentSource.GuarantorOffset : RepaymentSource.DefaulterDeduction;

  if (!confirm) return { loanId, instalmentNumber, action: 'would-backfill' };

  await models.repaymentModel.updateOne(
    { _id: row._id },
    { $set: { source, guarantorDebited, borrowerDebited } },
  );

  if (models.auditModel) {
    await models.auditModel.create({
      actorId: 'remediation-script',
      actorName: 'remediate-backdated-loan-completions',
      action: 'Update',
      entity: 'LoanRepayment',
      entityId: row._id.toString?.() ?? row._id,
      before: { source: row.source },
      after: { source, guarantorDebited, borrowerDebited },
    });
  }

  return { loanId, instalmentNumber, action: 'backfilled' };
}

async function run(): Promise<void> {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB${CONFIRM ? '' : ' (DRY RUN — pass --confirm to write)'}`);

  const models: Models = {
    loanModel: mongoose.model('Loan', LoanSchema),
    repaymentModel: mongoose.model('LoanRepayment', LoanRepaymentSchema),
    contributionModel: mongoose.model('Contribution', ContributionSchema),
    auditModel: mongoose.model('AuditLog', AuditLogSchema),
  };

  for (const loanId of LOAN_IDS) {
    const result = await remediateLoan(loanId, models, CONFIRM);
    console.log(JSON.stringify(result));
  }

  for (const { loanId, instalmentNumber } of MISLABELED_ROWS) {
    const result = await backfillRepaymentSource(loanId, instalmentNumber, models, CONFIRM);
    console.log(JSON.stringify(result));
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest remediate-backdated-loan-completions.spec.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/migrations/remediate-backdated-loan-completions.ts apps/api/src/loans/migrations/remediate-backdated-loan-completions.spec.ts
git commit -m "feat(loans): add scoped dry-run-first remediation script for backdated-loan cron gap"
```

**Do not run this script against prod as part of this plan.** Running it (`--confirm`) is
a separate, explicit step after Tasks 1-2 are deployed and reviewed — flag this to your
human partner rather than executing it.

---
