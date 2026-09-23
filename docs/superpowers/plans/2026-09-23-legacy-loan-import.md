# Legacy Loan Import Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let legacy loans (with real historic arrears/paid history) be bulk-imported without the daily overdue-detection and default-recovery crons misapplying today's penalty/grace-period config to historic dates or double-processing arrears already resolved in the old system.

**Architecture:** Add a `legacy`/`legacyCutoverDate` pair to the `Loan` schema. Both cron jobs skip any repayment row dated before its loan's cutover, but otherwise treat legacy loans exactly like normal ones once past cutover — no permanent exclusion, no global config. A new `LoansLegacyImportService` reads a two-sheet XLSX (loan headers + instalment rows) and writes the loan + its full historic schedule directly (trusted as-is, no schedule recompute, no `recordPaymentInternal` call), following the same batch/progress/flagged-entry pattern as the two existing importers.

**Tech Stack:** NestJS, Mongoose, `xlsx`, Jest.

**Spec:** `docs/superpowers/specs/2026-09-23-legacy-loan-import-design.md`

## Global Constraints

- `legacy` defaults to `false`/undefined — zero behavior change for any existing or normally-created loan.
- `legacyCutoverDate` is only ever set alongside `legacy: true`, at import time, and lives on the `Loan` document (not a global `SystemConfig` key).
- The bulk importer never calls `recordPaymentInternal` — imported instalment rows are data seeding, not payment events (no restitution-redirect, no penalty calc, no payment audit entry).
- Follow the existing XLSX-import pattern exactly: `LoanImportBatch`-style batch doc, `ImportProgressService.start/increment/complete`, per-entry flagging that lets the rest of the batch continue, one `AuditService.log` per created record.

## Review Focus

- **Instalment rows that reference a Loan Ref with no matching loan row (typo, orphaned rows).** These rows are silently ignored today because grouping is keyed off the loan sheet, not the instalment sheet — confirm this doesn't need a warning, otherwise mismatched refs vanish with no signal. (Covered by Task 4's grouping logic; no test currently asserts on orphaned instalment rows, so the "silently ignored" behavior is deliberate here, not a gap — call this out explicitly rather than let it hide.)
- **A `Status` cell that is empty string or has stray whitespace/casing** (`"paid "`, `"pending"` lowercase) — the enum membership check must reject it with a flag, not silently coerce or crash. Task 4 Step 3 tests this.
- **`Paid Amount` greater than `Due Amount` on an imported instalment row** (data-entry error from the old system) — nothing in the design currently rejects this; it will insert as-is. Documented as accepted (trust the migrated numbers) rather than validated — Task 4's instalment loop intentionally does not check this, matching the "trusted as-is" design decision.
- **A legacy loan whose `legacyCutoverDate` is in the future relative to all of its instalment due dates** (whole loan frozen forever) — this is valid and expected (e.g., a loan fully resolved in the old system, cutover set past its final instalment) and both job guards must produce a true no-op for it, not an error. Task 2 and Task 3 tests cover the "everything pre-cutover" case explicitly.
- **Overdue-detection job's `runForfeitureCheck`** (a separate sweep over `Active` loans with `tenureMonths <= 6` and `disbursedDate <= 6 months ago`) is untouched by this plan — a legacy loan with a short tenure and an old `disbursedDate` could still be forfeiture-swept even though its arrears are frozen. Out of scope per the approved design (forfeiture wasn't part of the reviewed guard), but flagged here since it's the one place in `overdue-detection.job.ts` this plan deliberately does not touch.

---

### Task 1: Loan schema fields + `createForLegacyImport`

**Files:**
- Modify: `apps/api/src/loans/schemas/loan.schema.ts`
- Modify: `apps/api/src/loans/loans.service.ts`
- Test: `apps/api/src/loans/loans.service.spec.ts`

**Interfaces:**
- Produces: `Loan.legacy?: boolean`, `Loan.legacyCutoverDate?: Date` (consumed by Task 2, 3, 4). `LoansService.createForLegacyImport(staffMongoId: string, guarantorMongoId: string, dto: { principalAmount: number; tenureMonths: number; disbursedDate: string; status: LoanStatus; cutoverDate: string; guarantorRestitutionOwed: number; guarantorRestitutionPaid: number; chequeNo?: string; pvNo?: string; notes?: string }, instalments: LegacyInstalmentInput[], actorId: string, actorName: string): Promise<LoanDocument>` and the exported `LegacyInstalmentInput` interface `{ instalmentNumber: number; dueDate: Date; dueAmount: number; paidAmount: number; paidDate?: Date; status: LoanRepaymentStatus }` (consumed by Task 4).

- [ ] **Step 1: Add `legacy`/`legacyCutoverDate` props to the Loan schema**

In `apps/api/src/loans/schemas/loan.schema.ts`, add after the `payOffAmountReceived` prop (line 37):

```ts
  @Prop({ default: false }) legacy?: boolean;
  @Prop() legacyCutoverDate?: Date;
```

- [ ] **Step 2: Write the failing test for `createForLegacyImport`**

In `apps/api/src/loans/loans.service.spec.ts`, add a new top-level `describe` block (after the existing `describe('create', ...)` block, before the next one):

```ts
describe('createForLegacyImport', () => {
  const instalments = [
    {
      instalmentNumber: 1,
      dueDate: new Date('2025-01-05'),
      dueAmount: 3000,
      paidAmount: 3000,
      paidDate: new Date('2025-01-04'),
      status: LoanRepaymentStatus.Paid,
    },
    {
      instalmentNumber: 2,
      dueDate: new Date('2025-02-05'),
      dueAmount: 3000,
      paidAmount: 0,
      status: LoanRepaymentStatus.Pending,
    },
  ];
  const dto = {
    principalAmount: 5000,
    tenureMonths: 2,
    disbursedDate: '2024-12-15',
    status: LoanStatus.Active,
    cutoverDate: '2026-01-01',
    guarantorRestitutionOwed: 800,
    guarantorRestitutionPaid: 200,
    chequeNo: 'CHQ-L1',
    pvNo: 'PV-L1',
  };

  it('creates a legacy loan with the legacy flag, cutover date, and restitution figures set directly from input', async () => {
    loanModel.create.mockResolvedValue({ _id: { toString: () => 'loan-legacy-1' } });
    repaymentModel.insertMany.mockResolvedValue([]);

    await service.createForLegacyImport('staff-1', 'guarantor-1', dto, instalments, 'actor-1', 'Actor');

    expect(loanModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: 'staff-1',
        guarantorId: 'guarantor-1',
        legacy: true,
        legacyCutoverDate: new Date('2026-01-01'),
        guarantorRestitutionOwed: 800,
        guarantorRestitutionPaid: 200,
        status: LoanStatus.Active,
        totalRepayable: 6000,
        monthlyInstalment: 3000,
      }),
    );
  });

  it('inserts instalments exactly as given, trusting status/paidAmount/dueDate rather than recomputing a schedule', async () => {
    loanModel.create.mockResolvedValue({ _id: { toString: () => 'loan-legacy-1' } });
    repaymentModel.insertMany.mockResolvedValue([]);

    await service.createForLegacyImport('staff-1', 'guarantor-1', dto, instalments, 'actor-1', 'Actor');

    const inserted = repaymentModel.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        loanId: 'loan-legacy-1',
        instalmentNumber: 1,
        dueAmount: 3000,
        paidAmount: 3000,
        status: LoanRepaymentStatus.Paid,
        source: RepaymentSource.Import,
      }),
    );
    expect(inserted[1]).toEqual(
      expect.objectContaining({
        instalmentNumber: 2,
        paidAmount: 0,
        status: LoanRepaymentStatus.Pending,
        source: undefined,
      }),
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && npx jest loans.service.spec.ts -t createForLegacyImport`
Expected: FAIL with `service.createForLegacyImport is not a function`

- [ ] **Step 4: Implement `createForLegacyImport`**

In `apps/api/src/loans/loans.service.ts`, add near `createForImport` (after its closing brace, before the `// ───────────────── QUERIES ─────────────────` comment):

```ts
export interface LegacyInstalmentInput {
  instalmentNumber: number;
  dueDate: Date;
  dueAmount: number;
  paidAmount: number;
  paidDate?: Date;
  status: LoanRepaymentStatus;
}
```

Add this export at the top of the file, alongside the other type/interface declarations (near `type ConfigMap = ...` around line 41), not inside the class.

Then, inside the `LoansService` class, add the method:

```ts
  async createForLegacyImport(
    staffMongoId: string,
    guarantorMongoId: string,
    dto: {
      principalAmount: number;
      tenureMonths: number;
      disbursedDate: string;
      status: LoanStatus;
      cutoverDate: string;
      guarantorRestitutionOwed: number;
      guarantorRestitutionPaid: number;
      chequeNo?: string;
      pvNo?: string;
      notes?: string;
    },
    instalments: LegacyInstalmentInput[],
    actorId: string,
    actorName: string,
  ): Promise<LoanDocument> {
    const disbursedDate = new Date(dto.disbursedDate);
    const totalRepayable = round2(instalments.reduce((sum, i) => sum + i.dueAmount, 0));
    const monthlyInstalment = round2(totalRepayable / dto.tenureMonths);
    const interestRate = round2(((totalRepayable - dto.principalAmount) / dto.principalAmount) * 100);

    const loan = await this.loanModel.create({
      staffId: staffMongoId,
      guarantorId: guarantorMongoId,
      principalAmount: dto.principalAmount,
      interestRate,
      totalRepayable,
      monthlyInstalment,
      tenureMonths: dto.tenureMonths,
      disbursedDate,
      chequeNo: dto.chequeNo,
      pvNo: dto.pvNo,
      notes: dto.notes,
      status: dto.status,
      legacy: true,
      legacyCutoverDate: new Date(dto.cutoverDate),
      guarantorRestitutionOwed: dto.guarantorRestitutionOwed,
      guarantorRestitutionPaid: dto.guarantorRestitutionPaid,
      recordedBy: actorName,
    });

    const loanId = loan._id.toString();
    const schedule = instalments.map((i) => ({
      loanId,
      staffId: staffMongoId,
      instalmentNumber: i.instalmentNumber,
      dueDate: i.dueDate,
      dueAmount: i.dueAmount,
      paidAmount: i.paidAmount,
      penaltyAmount: 0,
      status: i.status,
      paidDate: i.paidDate,
      source: i.paidAmount > 0 ? RepaymentSource.Import : undefined,
    }));
    await this.repaymentModel.insertMany(schedule);

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Loan,
      loanId,
      undefined,
      {
        principalAmount: dto.principalAmount,
        tenureMonths: dto.tenureMonths,
        legacy: true,
        instalments: instalments.length,
      },
    );

    return loan;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && npx jest loans.service.spec.ts -t createForLegacyImport`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full loans.service test suite to check for regressions**

Run: `cd apps/api && npx jest loans.service.spec.ts`
Expected: PASS (all tests, including pre-existing ones)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/loans/schemas/loan.schema.ts apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): add legacy loan flag and createForLegacyImport"
```

---

### Task 2: Overdue-detection job cutover guard

**Files:**
- Modify: `apps/api/src/loans/jobs/overdue-detection.job.ts`
- Test: `apps/api/src/loans/jobs/overdue-detection.job.spec.ts`

**Interfaces:**
- Consumes: `Loan.legacy`, `Loan.legacyCutoverDate` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/loans/jobs/overdue-detection.job.spec.ts`, add after the last existing `it(...)` block, inside the same `describe('OverdueDetectionJob', ...)`:

```ts
  it('does not touch a legacy loan instalment dated before the cutover date', async () => {
    const inst = makeInstalment('loan-1', new Date('2025-06-01'));
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...makeLoan(), legacy: true, legacyCutoverDate: new Date('2026-01-01') }),
    });
    configService.getAll.mockResolvedValue(mockConfig());

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Pending);
    expect(inst.save).not.toHaveBeenCalled();
  });

  it('processes a legacy loan instalment dated after the cutover date normally', async () => {
    const inst = makeInstalment('loan-1', new Date('2026-02-01'));
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...makeLoan(), legacy: true, legacyCutoverDate: new Date('2026-01-01') }),
    });
    configService.getAll.mockResolvedValue(mockConfig());

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Overdue);
    expect(inst.save).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `cd apps/api && npx jest overdue-detection.job.spec.ts`
Expected: FAIL on "does not touch a legacy loan instalment dated before the cutover date" — `inst.status` is `Overdue` and `inst.save` was called, because there's no guard yet.

- [ ] **Step 3: Restructure `processOverdueInstalment` to fetch the loan first and add the cutover guard**

In `apps/api/src/loans/jobs/overdue-detection.job.ts`, replace the `processOverdueInstalment` method (lines 74-153) with:

```ts
  private async processOverdueInstalment(
    inst: LoanRepaymentDocument,
    config: ConfigMap,
    today: Date,
  ): Promise<void> {
    const loan = await this.loanModel.findById(inst.loanId).exec();
    if (!loan) return;

    if (loan.legacy && loan.legacyCutoverDate && inst.dueDate < loan.legacyCutoverDate) {
      return;
    }

    inst.status = LoanRepaymentStatus.Overdue;
    if (inst.penaltyAmount === 0) {
      inst.penaltyAmount = this.calculatePenalty(inst.dueAmount, config);
    }
    await inst.save();

    if (!this.isGracePeriodExpired(inst.dueDate, today, config)) return;

    const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);

    const { debited: guarantorDebited, remaining: afterGuarantor } =
      await this.contributionsService.debitGuarantorOffset(
        loan.guarantorId,
        outstanding,
        inst.loanId,
        'system',
        'Overdue Detection Job',
        loan.staffId,
        inst.instalmentNumber,
      );

    // Shortfall not covered by guarantor balance: debit borrower's contributions
    let borrowerDebited = 0;
    let finalRemaining = afterGuarantor;
    if (afterGuarantor > 0) {
      const { debited, remaining } = await this.contributionsService.debitDefaulterContribution(
        loan.staffId,
        afterGuarantor,
        'system',
        'Overdue Detection Job',
        inst.loanId,
        inst.instalmentNumber,
      );
      borrowerDebited = debited;
      finalRemaining = remaining;
    }

    const totalDebited = round2(guarantorDebited + borrowerDebited);
    if (totalDebited > 0) {
      inst.paidAmount = round2(inst.paidAmount + totalDebited);
      inst.guarantorStaffId = loan.guarantorId;
      inst.source = RepaymentSource.GuarantorOffset;
      inst.paidDate = new Date();
      inst.status = finalRemaining === 0 ? LoanRepaymentStatus.Paid : LoanRepaymentStatus.Partial;
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
          borrowerDebited,
          remaining: finalRemaining,
          guarantorId: loan.guarantorId,
        },
      );
    }
  }
```

This is the existing method body unchanged except: the `loanModel.findById` call moved from its old position (previously after the grace-period check) to the very top, its `if (!loan) return;` guard moved with it, and the new `legacy`/`legacyCutoverDate` check inserted immediately after — before any mutation of `inst`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest overdue-detection.job.spec.ts`
Expected: PASS (all tests, including the two new ones and the three pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/jobs/overdue-detection.job.ts apps/api/src/loans/jobs/overdue-detection.job.spec.ts
git commit -m "feat(loans): skip pre-cutover legacy arrears in overdue-detection job"
```

---

### Task 3: Default-recovery job cutover guard

**Files:**
- Modify: `apps/api/src/loans/jobs/default-recovery.job.ts`
- Test: `apps/api/src/loans/jobs/default-recovery.job.spec.ts`

**Interfaces:**
- Consumes: `Loan.legacy`, `Loan.legacyCutoverDate` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/loans/jobs/default-recovery.job.spec.ts`:

First, add `exists: jest.fn()` to the `repaymentModel` object built in `beforeEach` (around line 32-36):

```ts
    repaymentModel = {
      aggregate: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
      exists: jest.fn(),
    };
```

Then add two tests inside `describe('detectAndMarkDefaulted (Cron 1)', ...)`, after the existing "sets endOfTenureGraceExpiry..." test:

```ts
    it('does not mark a legacy loan Defaulted when all remaining arrears are pre-cutover', async () => {
      const loan = { ...makeLoan(), legacy: true, legacyCutoverDate: new Date('2026-01-01') };
      repaymentModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: 'loan-1', maxDueDate: pastDate, count: 1 }]) });
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
      repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await job.detectAndMarkDefaulted();

      expect(loanModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('still marks a legacy loan Defaulted when post-cutover arrears also exist', async () => {
      const loan = { ...makeLoan(), legacy: true, legacyCutoverDate: new Date('2026-01-01') };
      repaymentModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: 'loan-1', maxDueDate: pastDate, count: 1 }]) });
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
      repaymentModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'inst-2' }) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      repaymentModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await job.detectAndMarkDefaulted();

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ status: LoanStatus.Defaulted }) }),
      );
    });
```

And one test inside `describe('runGracePeriodRecovery (Cron 2)', ...)`, after the existing "deducts from defaulter first, then guarantor for shortfall" test:

```ts
    it("excludes pre-cutover instalments from a legacy loan's outstanding calculation", async () => {
      const loan = { ...makeDefaultedLoan(), legacy: true, legacyCutoverDate: new Date('2026-01-01') };
      const postCutoverInst = makeInstalment(5000);

      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
      repaymentModel.find
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([postCutoverInst]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([postCutoverInst]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 5000, remaining: 0 });

      await job.runGracePeriodRecovery();

      const [firstQueryFilter] = repaymentModel.find.mock.calls[0];
      expect(firstQueryFilter.dueDate).toEqual({ $gte: loan.legacyCutoverDate });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest default-recovery.job.spec.ts`
Expected: FAIL — the first new test fails because `loanModel.findByIdAndUpdate` gets called anyway (no guard yet); the third fails because the `find` filter has no `dueDate` key.

- [ ] **Step 3: Add the cutover guard to `detectAndMarkDefaulted`**

In `apps/api/src/loans/jobs/default-recovery.job.ts`, inside the `for (const loan of activeLoans)` loop (starts at line 61), add the guard as the first statement of the `try` block:

```ts
    for (const loan of activeLoans) {
      try {
        if (loan.legacy && loan.legacyCutoverDate) {
          const hasPostCutoverArrears = await this.repaymentModel
            .exists({
              loanId: loan._id.toString(),
              status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
              dueDate: { $gte: loan.legacyCutoverDate, $lt: today },
            })
            .exec();
          if (!hasPostCutoverArrears) continue;
        }

        const graceExpiry = new Date(today.getFullYear(), today.getMonth() + graceMonths + 1, 1);
        // ...rest of the existing try block unchanged
```

(Keep every line after `const graceExpiry = ...` exactly as it already is — only the new `if (loan.legacy && ...)` block is inserted before it.)

- [ ] **Step 4: Add the cutover filter to `recoverDefaultedLoan`'s instalment queries**

In `apps/api/src/loans/jobs/default-recovery.job.ts`, in `recoverDefaultedLoan` (starts at line 114), replace the `unpaidInstalments` query:

```ts
  private async recoverDefaultedLoan(loan: LoanDocument, today: Date): Promise<void> {
    const loanId = loan._id.toString();
    const legacyDateFilter =
      loan.legacy && loan.legacyCutoverDate ? { dueDate: { $gte: loan.legacyCutoverDate } } : {};

    const unpaidInstalments = await this.repaymentModel.find({
      loanId,
      status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
      ...legacyDateFilter,
    }).exec();
```

And later in the same method, the `stillUnpaidInsts` query (inside the `if (guarantorRestitutionOwed > 0)` block):

```ts
      const stillUnpaidInsts = await this.repaymentModel.find({
        loanId,
        status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
        ...legacyDateFilter,
      }).exec();
```

Every other line in `recoverDefaultedLoan` stays unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && npx jest default-recovery.job.spec.ts`
Expected: PASS (all tests, including the three new ones and the pre-existing ones)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/jobs/default-recovery.job.ts apps/api/src/loans/jobs/default-recovery.job.spec.ts
git commit -m "feat(loans): skip pre-cutover legacy arrears in default-recovery job"
```

---

### Task 4: Bulk legacy loan import service

**Files:**
- Create: `apps/api/src/loans/schemas/loan-legacy-import-batch.schema.ts`
- Create: `apps/api/src/loans/loans.legacy-import.service.ts`
- Test: `apps/api/src/loans/loans.legacy-import.service.spec.ts`

**Interfaces:**
- Consumes: `LoansService.createForLegacyImport(...)` and `LegacyInstalmentInput` from Task 1; `StaffService.findByStaffId(staffId: string): Promise<StaffDocument | null>`; `ImportProgressService.start/increment/complete`; `normalizeExcelDate` from `../common/utils/excel-date.util`.
- Produces: `LoansLegacyImportService` with `processImport(buffer, fileName, actorId, actorName, jobId?): Promise<{ batchId: string; created: number; flagged: number; total: number }>`, `listBatches`, `getBatch`, `dismissFlaggedEntry`, `clearFlaggedEntries` — same shapes as `LoansRecordsImportService` (consumed by Task 5's controller wiring).

- [ ] **Step 1: Create the batch schema**

Create `apps/api/src/loans/schemas/loan-legacy-import-batch.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type LoanLegacyImportBatchDocument = HydratedDocument<LoanLegacyImportBatch>;

@Schema({ _id: false })
class LoanLegacyFlaggedEntry {
  @Prop({ required: true }) loanRef!: string;
  @Prop({ default: '' }) staffId!: string;
  @Prop({ default: '' }) guarantorId!: string;
  @Prop({ default: 0 }) principalAmount!: number;
  @Prop({ default: '' }) disbursedDate!: string;
  @Prop({ required: true }) reason!: string;
}

@Schema({ timestamps: true, collection: 'loan_legacy_import_batches' })
export class LoanLegacyImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, default: 0 }) totalRows!: number;
  @Prop({ required: true, default: 0 }) matchedRows!: number;
  @Prop({ required: true, default: 0 }) flaggedRows!: number;
  @Prop({ type: [LoanLegacyFlaggedEntry], default: [] }) flaggedEntries!: LoanLegacyFlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const LoanLegacyImportBatchSchema = SchemaFactory.createForClass(LoanLegacyImportBatch);
LoanLegacyImportBatchSchema.index({ status: 1 });
LoanLegacyImportBatchSchema.index({ createdAt: -1 });
```

- [ ] **Step 2: Write the failing test for a valid single-loan import**

Create `apps/api/src/loans/loans.legacy-import.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { LoansLegacyImportService } from './loans.legacy-import.service';
import { LoanLegacyImportBatch } from './schemas/loan-legacy-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };
const mockLoansService = { createForLegacyImport: jest.fn().mockResolvedValue({}) };
const mockStaffService = {
  findByStaffId: jest.fn((id: string) => Promise.resolve({ _id: { toString: () => `resolved-${id}` } })),
};
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

function twoSheetBuffer(
  loanRows: Record<string, unknown>[],
  instalmentRows: Record<string, unknown>[],
): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loanRows), 'Loans');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instalmentRows), 'Instalments');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const validLoanRow = {
  'Loan Ref': 'L1', 'Staff ID': 'S1', 'Guarantor Staff ID': 'S2',
  'Principal Amount': 6000, 'Tenure Months': 2, 'Disbursed Date': '15/12/2024',
  'Status': 'Active', 'Cutover Date': '01/01/2026',
  'Guarantor Restitution Owed': 0, 'Guarantor Restitution Paid': 0,
  'Cheque No': 'C1', 'PV No': 'PV1',
};
const validInstalmentRows = [
  { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': 3000, 'Paid Date': '04/01/2025', 'Status': 'Paid' },
  { 'Loan Ref': 'L1', 'Instalment Number': 2, 'Due Date': '05/02/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'Pending' },
];

describe('LoansLegacyImportService', () => {
  let service: LoansLegacyImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansLegacyImportService,
        { provide: getModelToken(LoanLegacyImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansLegacyImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });
  });

  it('creates a legacy loan from a valid loan row and its matching instalment rows', async () => {
    const buffer = twoSheetBuffer([validLoanRow], validInstalmentRows);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).toHaveBeenCalledWith(
      'resolved-S1',
      'resolved-S2',
      expect.objectContaining({ principalAmount: 6000, tenureMonths: 2, status: 'Active' }),
      expect.arrayContaining([
        expect.objectContaining({ instalmentNumber: 1, dueAmount: 3000, paidAmount: 3000 }),
        expect.objectContaining({ instalmentNumber: 2, dueAmount: 3000, paidAmount: 0 }),
      ]),
      'actor-1',
      'Actor',
    );
    expect(result).toEqual({ batchId: 'batch-1', created: 1, flagged: 0, total: 1 });
  });

  it('throws BadRequestException when the workbook is missing the Instalments sheet', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([validLoanRow]), 'Loans');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await expect(service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('flags the whole loan when an instalment row has an invalid Status, and does not create it', async () => {
    const badInstalments = [
      { 'Loan Ref': 'L1', 'Instalment Number': 1, 'Due Date': '05/01/2025', 'Due Amount': 3000, 'Paid Amount': 0, 'Status': 'NotAStatus' },
    ];
    const buffer = twoSheetBuffer([validLoanRow], badInstalments);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.flagged).toBe(1);
  });

  it('flags the loan when Staff ID is not found and does not call createForLegacyImport', async () => {
    mockStaffService.findByStaffId.mockImplementationOnce(() => Promise.resolve(null));
    const buffer = twoSheetBuffer([validLoanRow], validInstalmentRows);

    const result = await service.processImport(buffer, 'legacy.xlsx', 'actor-1', 'Actor');

    expect(mockLoansService.createForLegacyImport).not.toHaveBeenCalled();
    expect(result.flagged).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && npx jest loans.legacy-import.service.spec.ts`
Expected: FAIL — `Cannot find module './loans.legacy-import.service'`

- [ ] **Step 4: Implement `LoansLegacyImportService`**

Create `apps/api/src/loans/loans.legacy-import.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  AuditAction,
  AuditEntity,
  ImportBatchStatus,
  LoanRepaymentStatus,
  LoanStatus,
  PaginatedResult,
} from '@welfare/shared';
import { LoanLegacyImportBatch, LoanLegacyImportBatchDocument } from './schemas/loan-legacy-import-batch.schema';
import { LoansService, LegacyInstalmentInput } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { normalizeExcelDate } from '../common/utils/excel-date.util';
import { ImportProgressService } from '../common/import-progress.service';

interface LoanRow {
  'Loan Ref'?: string;
  'Staff ID'?: string;
  'Guarantor Staff ID'?: string;
  'Principal Amount'?: number;
  'Tenure Months'?: number;
  'Disbursed Date'?: string | number | Date;
  'Status'?: string;
  'Cutover Date'?: string | number | Date;
  'Guarantor Restitution Owed'?: number;
  'Guarantor Restitution Paid'?: number;
  'Cheque No'?: string;
  'PV No'?: string;
  'Notes'?: string;
}

interface InstalmentRow {
  'Loan Ref'?: string;
  'Instalment Number'?: number;
  'Due Date'?: string | number | Date;
  'Due Amount'?: number;
  'Paid Amount'?: number;
  'Paid Date'?: string | number | Date;
  'Status'?: string;
}

export interface LoansLegacyImportResult {
  batchId: string;
  created: number;
  flagged: number;
  total: number;
}

@Injectable()
export class LoansLegacyImportService {
  constructor(
    @InjectModel(LoanLegacyImportBatch.name)
    private readonly batchModel: Model<LoanLegacyImportBatchDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<LoansLegacyImportResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const loansSheet = workbook.Sheets['Loans'];
    const instalmentsSheet = workbook.Sheets['Instalments'];
    if (!loansSheet || !instalmentsSheet) {
      throw new BadRequestException('Workbook must contain a "Loans" sheet and an "Instalments" sheet');
    }

    const loanRows = XLSX.utils.sheet_to_json<LoanRow>(loansSheet);
    const instalmentRows = XLSX.utils.sheet_to_json<InstalmentRow>(instalmentsSheet);
    if (loanRows.length === 0) throw new BadRequestException('Loans sheet has no data rows');

    const instalmentsByRef = new Map<string, InstalmentRow[]>();
    for (const row of instalmentRows) {
      const ref = String(row['Loan Ref'] ?? '').trim();
      if (!ref) continue;
      const list = instalmentsByRef.get(ref) ?? [];
      list.push(row);
      instalmentsByRef.set(ref, list);
    }

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      uploadedBy: actorName,
      totalRows: loanRows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    const flaggedEntries: LoanLegacyImportBatchDocument['flaggedEntries'] = [];
    let created = 0;

    this.progressService.start(batchId, loanRows.length);
    try {
      for (let i = 0; i < loanRows.length; i++) {
        this.progressService.increment(batchId);

        const row = loanRows[i];
        const loanRef = String(row['Loan Ref'] ?? '').trim();
        const rawStaffId = String(row['Staff ID'] ?? '').trim();
        const rawGuarantorId = String(row['Guarantor Staff ID'] ?? '').trim();
        const principalAmount = Number(row['Principal Amount'] ?? 0);
        const tenureMonths = Number(row['Tenure Months'] ?? 0);
        const disbursedDateRaw = normalizeExcelDate(row['Disbursed Date']);
        const cutoverDateRaw = normalizeExcelDate(row['Cutover Date']);
        const status = String(row['Status'] ?? '').trim();
        const guarantorRestitutionOwed = Number(row['Guarantor Restitution Owed'] ?? 0);
        const guarantorRestitutionPaid = Number(row['Guarantor Restitution Paid'] ?? 0);
        const chequeNo = String(row['Cheque No'] ?? '').trim();
        const pvNo = String(row['PV No'] ?? '').trim();
        const notes = String(row['Notes'] ?? '').trim() || undefined;

        const flag = (reason: string) =>
          flaggedEntries.push({
            loanRef, staffId: rawStaffId, guarantorId: rawGuarantorId,
            principalAmount, disbursedDate: disbursedDateRaw, reason,
          });

        if (!loanRef) { flag('Missing Loan Ref'); continue; }
        if (!rawStaffId) { flag('Missing Staff ID'); continue; }
        if (!rawGuarantorId) { flag('Missing Guarantor Staff ID'); continue; }
        if (!(principalAmount > 0)) { flag('Principal Amount must be > 0'); continue; }
        if (!(tenureMonths >= 1)) { flag('Tenure Months must be >= 1'); continue; }
        if (!disbursedDateRaw || isNaN(new Date(disbursedDateRaw).getTime())) { flag('Missing or invalid Disbursed Date'); continue; }
        if (!Object.values(LoanStatus).includes(status as LoanStatus)) { flag(`Invalid Status "${status}"`); continue; }
        if (!cutoverDateRaw || isNaN(new Date(cutoverDateRaw).getTime())) { flag('Missing or invalid Cutover Date'); continue; }

        const rows = instalmentsByRef.get(loanRef) ?? [];
        if (rows.length === 0) { flag('No instalment rows found for this Loan Ref'); continue; }

        const instalments: LegacyInstalmentInput[] = [];
        let instalmentError: string | undefined;
        for (const instRow of rows) {
          const instalmentNumber = Number(instRow['Instalment Number'] ?? 0);
          const dueDateRaw = normalizeExcelDate(instRow['Due Date']);
          const dueAmount = Number(instRow['Due Amount'] ?? 0);
          const paidAmount = Number(instRow['Paid Amount'] ?? 0);
          const paidDateRaw = normalizeExcelDate(instRow['Paid Date']);
          const instStatus = String(instRow['Status'] ?? '').trim();

          if (!(instalmentNumber >= 1)) { instalmentError = `Instalment ${instalmentNumber}: Instalment Number must be >= 1`; break; }
          if (!dueDateRaw || isNaN(new Date(dueDateRaw).getTime())) { instalmentError = `Instalment ${instalmentNumber}: missing or invalid Due Date`; break; }
          if (!(dueAmount > 0)) { instalmentError = `Instalment ${instalmentNumber}: Due Amount must be > 0`; break; }
          if (!Object.values(LoanRepaymentStatus).includes(instStatus as LoanRepaymentStatus)) {
            instalmentError = `Instalment ${instalmentNumber}: invalid Status "${instStatus}"`; break;
          }
          if ((instStatus === LoanRepaymentStatus.Paid || instStatus === LoanRepaymentStatus.Partial) && !paidDateRaw) {
            instalmentError = `Instalment ${instalmentNumber}: Paid Date required when Status is ${instStatus}`; break;
          }

          instalments.push({
            instalmentNumber,
            dueDate: new Date(dueDateRaw),
            dueAmount,
            paidAmount,
            paidDate: paidDateRaw ? new Date(paidDateRaw) : undefined,
            status: instStatus as LoanRepaymentStatus,
          });
        }
        if (instalmentError) { flag(instalmentError); continue; }

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
        } catch (err: unknown) {
          flag(err instanceof Error ? err.message : 'Processing error');
        }
      }
    } finally {
      this.progressService.complete(batchId);
    }

    const flagged = flaggedEntries.length;
    await this.batchModel.findByIdAndUpdate(batchId, {
      $set: {
        matchedRows: created,
        flaggedRows: flagged,
        flaggedEntries,
        status: flagged === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending,
      },
    }).exec();

    this.auditService.log(
      actorId, actorName, AuditAction.Import, AuditEntity.Loan, batchId,
      undefined, { total: loanRows.length, created, flagged },
    );

    return { batchId, created, flagged, total: loanRows.length };
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<LoanLegacyImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<LoanLegacyImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<LoanLegacyImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, batchId);
    return batch;
  }

  async clearFlaggedEntries(batchId: string, actorId: string, actorName: string): Promise<LoanLegacyImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    batch.flaggedEntries = [];
    batch.flaggedRows = 0;
    batch.status = ImportBatchStatus.Completed;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, batchId);
    return batch;
  }
}
```

Note: `LoansService` must export `LegacyInstalmentInput` (added as a top-level export in Task 1 Step 4) for this import to resolve.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && npx jest loans.legacy-import.service.spec.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/schemas/loan-legacy-import-batch.schema.ts apps/api/src/loans/loans.legacy-import.service.ts apps/api/src/loans/loans.legacy-import.service.spec.ts
git commit -m "feat(loans): add bulk legacy loan+schedule import service"
```

---

### Task 5: Wire the new service into the module and controller

**Files:**
- Modify: `apps/api/src/loans/loans.module.ts`
- Modify: `apps/api/src/loans/loans.controller.ts`

**Interfaces:**
- Consumes: `LoansLegacyImportService` from Task 4.

- [ ] **Step 1: Register the schema and service in the module**

In `apps/api/src/loans/loans.module.ts`, add the import and registration:

```ts
import { LoansLegacyImportService } from './loans.legacy-import.service';
// ...
import { LoanLegacyImportBatch, LoanLegacyImportBatchSchema } from './schemas/loan-legacy-import-batch.schema';
```

Add `{ name: LoanLegacyImportBatch.name, schema: LoanLegacyImportBatchSchema }` to the `MongooseModule.forFeature([...])` array (alongside `LoanImportBatch` and `LoanRecordsImportBatch`), and add `LoansLegacyImportService` to the `providers` array:

```ts
  providers: [LoansService, LoansImportService, LoansRecordsImportService, LoansLegacyImportService, OverdueDetectionJob, DefaultRecoveryJob, LoanScheduleSenderService, PaymentReminderJob],
```

- [ ] **Step 2: Add controller routes**

In `apps/api/src/loans/loans.controller.ts`, add the import and constructor injection:

```ts
import { LoansLegacyImportService } from './loans.legacy-import.service';
```

```ts
  constructor(
    private readonly loansService: LoansService,
    private readonly importService: LoansImportService,
    private readonly recordsImportService: LoansRecordsImportService,
    private readonly legacyImportService: LoansLegacyImportService,
  ) {}
```

Add a new route block after the `// ── loan records import routes ──` section (before `@Delete('bulk')`):

```ts
  // ── legacy loan bulk import routes ──

  @Post('legacy-import')
  @RequirePermission(AppModule.Loans, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importLegacyLoans(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId: string | undefined,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    return this.legacyImportService.processImport(file.buffer, file.originalname, user._id.toString(), user.displayName, jobId);
  }

  @Get('legacy-import')
  @RequirePermission(AppModule.Loans, 'readonly')
  listLegacyImportBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.legacyImportService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('legacy-import/:batchId')
  @RequirePermission(AppModule.Loans, 'readonly')
  getLegacyImportBatch(@Param('batchId') batchId: string) {
    return this.legacyImportService.getBatch(batchId);
  }

  @Patch('legacy-import/:batchId/dismiss')
  @RequirePermission(AppModule.Loans, 'full')
  dismissLegacyFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    return this.legacyImportService.dismissFlaggedEntry(batchId, dto.index, user._id.toString(), user.displayName);
  }

  @Patch('legacy-import/:batchId/clear-flagged')
  @RequirePermission(AppModule.Loans, 'full')
  clearLegacyFlaggedEntries(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    return this.legacyImportService.clearFlaggedEntries(batchId, user._id.toString(), user.displayName);
  }
```

There is no existing controller test suite for `loans.controller.ts` (none of the other import routes have one either) — this task is verified by the type-check/build step below instead.

- [ ] **Step 3: Type-check the whole api workspace**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors (confirms the new imports, DI wiring, and route signatures all type-check against `LoansLegacyImportService` and the DTOs it reuses)

- [ ] **Step 4: Run the full loans test suite for a final regression check**

Run: `cd apps/api && npx jest loans`
Expected: PASS (every `*.spec.ts` file under `src/loans`, including all four tasks' new tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/loans.module.ts apps/api/src/loans/loans.controller.ts
git commit -m "feat(loans): expose legacy loan bulk import via loans module and controller"
```
