# Loan Default Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect end-of-tenure loan defaults, recover arrears from defaulter then guarantor contributions, and redirect future defaulter contributions to the guarantor until reimbursed.

**Architecture:** A new `DefaultRecoveryJob` (two daily crons) handles detection and recovery. Contribution redirect logic lives in `ContributionsService.processPayment` / `processLumpSum` via a private helper, requiring the Loan model to be registered in `ContributionsModule`.

**Tech Stack:** NestJS, Mongoose, `@nestjs/schedule` (cron), Jest, Next.js (React/TypeScript), `@welfare/shared` monorepo package.

---

## File Map

| File | Change |
|---|---|
| `packages/shared/src/enums/config-key.enum.ts` | Add `EndOfTenureGracePeriodMonths` |
| `packages/shared/src/enums/contribution-source.enum.ts` | Add `DefaulterDeduction`, `DefaulterRestitution` |
| `packages/shared/src/interfaces/loan.interface.ts` | Add 6 new fields |
| `packages/shared/src/dto/loan.dto.ts` | Add 6 new fields to `LoanResponseDto` |
| `apps/api/src/loans/schemas/loan.schema.ts` | Add 6 new `@Prop` fields |
| `apps/api/src/contributions/contributions.module.ts` | Register `Loan` model |
| `apps/api/src/contributions/contributions.service.ts` | Add `debitDefaulterContribution`, `handleRestitutionRedirect`, hook both into `processPayment` and `processLumpSum` |
| `apps/api/src/contributions/contributions.service.spec.ts` | Tests for above |
| `apps/api/src/loans/jobs/default-recovery.job.ts` | **Create** — Cron 1 + Cron 2 |
| `apps/api/src/loans/jobs/default-recovery.job.spec.ts` | **Create** — tests for both crons |
| `apps/api/src/loans/loans.service.ts` | Guard in `checkAndCompleteIfDone` |
| `apps/api/src/loans/loans.service.spec.ts` | Test for guard |
| `apps/api/src/loans/loans.module.ts` | Register `DefaultRecoveryJob` |
| `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx` | Add Default Recovery info card |

---

## Task 1: Shared Enums

**Files:**
- Modify: `packages/shared/src/enums/config-key.enum.ts`
- Modify: `packages/shared/src/enums/contribution-source.enum.ts`

- [ ] **Step 1: Add `EndOfTenureGracePeriodMonths` to ConfigKey**

Replace the closing brace of the enum in `packages/shared/src/enums/config-key.enum.ts`:

```typescript
export enum ConfigKey {
  MonthlyContributionAmount = 'MONTHLY_CONTRIBUTION_AMOUNT',
  LoanMinAmount = 'LOAN_MIN_AMOUNT',
  LoanMaxAmount = 'LOAN_MAX_AMOUNT',
  LoanMaxTenure = 'LOAN_MAX_TENURE',
  InterestRateShort = 'INTEREST_RATE_SHORT',
  InterestRateLong = 'INTEREST_RATE_LONG',
  EligibilityMonths = 'ELIGIBILITY_MONTHS',
  PaymentDeadlineDay = 'PAYMENT_DEADLINE_DAY',
  PenaltyType = 'PENALTY_TYPE',
  PenaltyValue = 'PENALTY_VALUE',
  MaxLoansPerGuarantor = 'MAX_LOANS_PER_GUARANTOR',
  MaxLoansPerStaff = 'MAX_LOANS_PER_STAFF',
  GracePeriodDays = 'GRACE_PERIOD_DAYS',
  EndOfTenureGracePeriodMonths = 'END_OF_TENURE_GRACE_PERIOD_MONTHS',
  EmailProvider = 'EMAIL_PROVIDER',
  EmailFromAddress = 'EMAIL_FROM_ADDRESS',
  EmailFromName = 'EMAIL_FROM_NAME',
  ResendApiKey = 'RESEND_API_KEY',
  OutlookHost = 'OUTLOOK_HOST',
  OutlookPort = 'OUTLOOK_PORT',
  OutlookUsername = 'OUTLOOK_USERNAME',
  OutlookPassword = 'OUTLOOK_PASSWORD',
  EmailContributionStatementCron = 'EMAIL_CONTRIBUTION_STATEMENT_CRON',
  EmailLoanScheduleEnabled = 'EMAIL_LOAN_SCHEDULE_ENABLED',
}
```

- [ ] **Step 2: Add `DefaulterDeduction` and `DefaulterRestitution` to ContributionSource**

Replace `packages/shared/src/enums/contribution-source.enum.ts`:

```typescript
export enum ContributionSource {
  PayrollImport = 'PayrollImport',
  ManualEntry = 'ManualEntry',
  LumpSum = 'LumpSum',
  GuarantorOffset = 'GuarantorOffset',
  DefaulterDeduction = 'DefaulterDeduction',
  DefaulterRestitution = 'DefaulterRestitution',
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/enums/config-key.enum.ts packages/shared/src/enums/contribution-source.enum.ts
git commit -m "feat(shared): add EndOfTenureGracePeriodMonths config key and DefaulterDeduction/DefaulterRestitution contribution sources"
```

---

## Task 2: Shared Interfaces + DTOs

**Files:**
- Modify: `packages/shared/src/interfaces/loan.interface.ts`
- Modify: `packages/shared/src/dto/loan.dto.ts`

- [ ] **Step 1: Add new fields to `ILoan`**

Replace `packages/shared/src/interfaces/loan.interface.ts`:

```typescript
import { LoanStatus } from '../enums/loan-status.enum';

export interface ILoan {
  _id: string;
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  tenureMonths: number;
  interestRate: number;
  totalRepayable: number;
  monthlyInstalment: number;
  disbursedDate: string;
  status: LoanStatus;
  documentKey?: string;
  chequeNo?: string;
  pvNo?: string;
  exitDeductionAmount?: number;
  guarantorOffsetAmount?: number;
  badDebtAmount?: number;
  settledAt?: string;
  notes?: string;
  recordedBy: string;
  defaultedAt?: string;
  endOfTenureGraceExpiry?: string;
  defaulterContributionDebited?: number;
  guarantorRestitutionOwed?: number;
  guarantorRestitutionPaid?: number;
  recoveryRanAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add new fields to `LoanResponseDto`**

Replace `packages/shared/src/dto/loan.dto.ts`:

```typescript
import { LoanStatus } from '../enums/loan-status.enum';

export interface CreateLoanDto {
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  tenureMonths: number;
  interestRate: 10 | 15;
  disbursedDate: string;
  chequeNo: string;
  pvNo: string;
  approvalDocumentKey?: string;
}

export interface UpdateLoanDto {
  status?: LoanStatus;
  exitDeductionAmount?: number;
  guarantorOffsetAmount?: number;
  badDebtAmount?: number;
  settledAt?: string;
  approvalDocumentKey?: string;
}

export interface LoanResponseDto {
  _id: string;
  staffId: string;
  guarantorId: string;
  principalAmount: number;
  tenureMonths: number;
  interestRate: 10 | 15;
  totalRepayable: number;
  monthlyInstalment: number;
  disbursedDate: string;
  status: LoanStatus;
  exitDeductionAmount?: number;
  guarantorOffsetAmount?: number;
  badDebtAmount?: number;
  settledAt?: string;
  approvalDocumentKey?: string;
  recordedBy: string;
  defaultedAt?: string;
  endOfTenureGraceExpiry?: string;
  defaulterContributionDebited?: number;
  guarantorRestitutionOwed?: number;
  guarantorRestitutionPaid?: number;
  recoveryRanAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/interfaces/loan.interface.ts packages/shared/src/dto/loan.dto.ts
git commit -m "feat(shared): add default recovery fields to ILoan and LoanResponseDto"
```

---

## Task 3: Loan Mongoose Schema

**Files:**
- Modify: `apps/api/src/loans/schemas/loan.schema.ts`

- [ ] **Step 1: Add new `@Prop` fields**

Replace `apps/api/src/loans/schemas/loan.schema.ts`:

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LoanStatus } from '@welfare/shared';

export type LoanDocument = HydratedDocument<Loan>;

@Schema({ timestamps: true, collection: 'loans' })
export class Loan {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) guarantorId!: string;
  @Prop({ required: true, min: 0 }) principalAmount!: number;
  @Prop({ required: true, min: 0 }) interestRate!: number;
  @Prop({ required: true, min: 0 }) totalRepayable!: number;
  @Prop({ required: true, min: 0 }) monthlyInstalment!: number;
  @Prop({ required: true, min: 1 }) tenureMonths!: number;
  @Prop({ required: true }) disbursedDate!: Date;
  @Prop({ required: true, enum: LoanStatus, default: LoanStatus.Active }) status!: LoanStatus;
  @Prop() documentKey?: string;
  @Prop({ min: 0, default: 0 }) exitDeductionAmount?: number;
  @Prop({ min: 0, default: 0 }) guarantorOffsetAmount?: number;
  @Prop({ min: 0, default: 0 }) badDebtAmount?: number;
  @Prop() settledAt?: Date;
  @Prop() chequeNo?: string;
  @Prop() pvNo?: string;
  @Prop() notes?: string;
  @Prop({ required: true }) recordedBy!: string;
  @Prop() defaultedAt?: Date;
  @Prop() endOfTenureGraceExpiry?: Date;
  @Prop({ min: 0, default: 0 }) defaulterContributionDebited!: number;
  @Prop({ min: 0, default: 0 }) guarantorRestitutionOwed!: number;
  @Prop({ min: 0, default: 0 }) guarantorRestitutionPaid!: number;
  @Prop() recoveryRanAt?: Date;
}

export const LoanSchema = SchemaFactory.createForClass(Loan);
LoanSchema.index({ staffId: 1, status: 1 });
LoanSchema.index({ guarantorId: 1 });
LoanSchema.index({ status: 1 });
LoanSchema.index({ status: 1, endOfTenureGraceExpiry: 1 });
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/loans/schemas/loan.schema.ts
git commit -m "feat(api): add default recovery fields to Loan schema"
```

---

## Task 4: Register Loan Model in ContributionsModule

**Files:**
- Modify: `apps/api/src/contributions/contributions.module.ts`

- [ ] **Step 1: Add Loan schema to `MongooseModule.forFeature`**

Replace `apps/api/src/contributions/contributions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { ImportService } from './import.service';
import { Contribution, ContributionSchema } from './schemas/contribution.schema';
import { ImportBatch, ImportBatchSchema } from './schemas/import-batch.schema';
import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
import { SystemConfigModule } from '../system-config/system-config.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contribution.name, schema: ContributionSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema },
      { name: Loan.name, schema: LoanSchema },
    ]),
    MulterModule.register({}),
    SystemConfigModule,
    StaffModule,
  ],
  controllers: [ContributionsController],
  providers: [ContributionsService, ImportService],
  exports: [ContributionsService],
})
export class ContributionsModule {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/contributions/contributions.module.ts
git commit -m "feat(api): register Loan model in ContributionsModule for restitution redirect"
```

---

## Task 5: ContributionsService — `debitDefaulterContribution`

**Files:**
- Modify: `apps/api/src/contributions/contributions.service.ts`
- Modify: `apps/api/src/contributions/contributions.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `apps/api/src/contributions/contributions.service.spec.ts`, inside the outer `describe('ContributionsService', ...)`:

First, update the `mockContributionModel` at the top of the file to add `create`:
```typescript
const mockCreate = jest.fn();

const mockContributionModel = {
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
  find: mockFind,
  countDocuments: mockCountDocuments,
  aggregate: mockAggregate,
  create: mockCreate,
};
```

Add `mockCreate.mockResolvedValue(undefined)` in the `beforeEach` after `jest.clearAllMocks()`.

Also add a mock Loan model at top of file:
```typescript
const mockLoanFindOne = jest.fn();
const mockLoanFindByIdAndUpdate = jest.fn();
const mockLoanModel = {
  findOne: mockLoanFindOne,
  findByIdAndUpdate: mockLoanFindByIdAndUpdate,
};
```

Update `TestingModule` setup in `beforeEach`:
```typescript
import { Loan } from '../loans/schemas/loan.schema';
// add to providers:
{ provide: getModelToken(Loan.name), useValue: mockLoanModel },
```

Now add the new test block (after existing `describe` blocks):

```typescript
describe('debitDefaulterContribution', () => {
  it('debits full amount when balance is sufficient', async () => {
    // balance = 10000 (credits) - 0 (debits)
    mockAggregate
      .mockResolvedValueOnce([{ total: 10000 }]) // credits
      .mockResolvedValueOnce([]);                 // debits (none)
    mockCreate.mockResolvedValue(undefined);

    const result = await service.debitDefaulterContribution('staff-1', 3000, 'actor-id', 'Actor');

    expect(result).toEqual({ debited: 3000, remaining: 0 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: 'staff-1',
        paidAmount: 3000,
        isDebit: true,
        source: ContributionSource.DefaulterDeduction,
      }),
    );
  });

  it('debits partial amount when balance is insufficient', async () => {
    mockAggregate
      .mockResolvedValueOnce([{ total: 1000 }])
      .mockResolvedValueOnce([]);
    mockCreate.mockResolvedValue(undefined);

    const result = await service.debitDefaulterContribution('staff-1', 3000, 'actor-id', 'Actor');

    expect(result).toEqual({ debited: 1000, remaining: 2000 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ paidAmount: 1000 }),
    );
  });

  it('creates no entry and returns debited=0 when balance is zero', async () => {
    mockAggregate
      .mockResolvedValueOnce([])  // no credits
      .mockResolvedValueOnce([]); // no debits
    mockCreate.mockResolvedValue(undefined);

    const result = await service.debitDefaulterContribution('staff-1', 3000, 'actor-id', 'Actor');

    expect(result).toEqual({ debited: 0, remaining: 3000 });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/api && npx jest src/contributions/contributions.service.spec.ts --no-coverage --testNamePattern="debitDefaulterContribution"
```

Expected: FAIL — `service.debitDefaulterContribution is not a function`

- [ ] **Step 3: Implement `debitDefaulterContribution`**

In `apps/api/src/contributions/contributions.service.ts`:

1. Add `@InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>` to the constructor and the required imports:

```typescript
import { InjectModel } from '@nestjs/mongoose';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity, ContributionSource, ContributionStatus, LoanStatus, PaginatedResult } from '@welfare/shared';
import { Contribution, ContributionDocument } from './schemas/contribution.schema';
import { Loan, LoanDocument } from '../loans/schemas/loan.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionQueryDto } from './dto/contribution-query.dto';
```

Update constructor:
```typescript
constructor(
  @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
  @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
  private readonly configService: SystemConfigService,
  private readonly auditService: AuditService,
) {}
```

Add the method at the end of the class (before the closing `}`):

```typescript
async debitDefaulterContribution(
  staffId: string,
  amount: number,
  actorId: string,
  actorName: string,
): Promise<{ debited: number; remaining: number }> {
  const balance = await this.getBalance(staffId);
  const debited = Math.min(amount, Math.max(0, balance));
  const remaining = amount - debited;

  if (debited > 0) {
    const now = new Date();
    await this.contributionModel.create({
      staffId,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      expectedAmount: 0,
      paidAmount: debited,
      surplusCarriedForward: 0,
      isDebit: true,
      status: ContributionStatus.Paid,
      source: ContributionSource.DefaulterDeduction,
      recordedBy: actorName,
    });
  }

  return { debited, remaining };
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd apps/api && npx jest src/contributions/contributions.service.spec.ts --no-coverage --testNamePattern="debitDefaulterContribution"
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contributions/contributions.service.ts apps/api/src/contributions/contributions.service.spec.ts
git commit -m "feat(api): add debitDefaulterContribution to ContributionsService"
```

---

## Task 6: ContributionsService — Restitution Redirect Hook

**Files:**
- Modify: `apps/api/src/contributions/contributions.service.ts`
- Modify: `apps/api/src/contributions/contributions.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Add this `describe` block to `contributions.service.spec.ts`:

```typescript
describe('handleRestitutionRedirect (via processPayment)', () => {
  const makeRestitutionLoan = (owed: number, paid: number) => ({
    _id: { toString: () => 'loan-1' },
    staffId: 'staff-1',
    guarantorId: 'guarantor-1',
    status: 'Defaulted',
    guarantorRestitutionOwed: owed,
    guarantorRestitutionPaid: paid,
  });

  beforeEach(() => {
    mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }); // contribution findOne
    mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'c-1' }, toObject: () => ({}) }) });
    mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }); // no restitution by default
    mockLoanFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockCreate.mockResolvedValue(undefined);
  });

  it('creates debit+credit entries and increments guarantorRestitutionPaid when restitution is active', async () => {
    mockLoanFindOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(makeRestitutionLoan(5000, 0)),
    });

    await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-1', isDebit: true, source: ContributionSource.DefaulterRestitution, paidAmount: 3000 }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'guarantor-1', isDebit: false, source: ContributionSource.DefaulterRestitution, paidAmount: 3000 }),
    );
    expect(mockLoanFindByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $inc: { guarantorRestitutionPaid: 3000 } },
    );
  });

  it('caps redirect at remaining restitution owed', async () => {
    mockLoanFindOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(makeRestitutionLoan(5000, 4500)),
    });

    await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ paidAmount: 500 }), // capped at 5000 - 4500
    );
  });

  it('skips redirect when no active restitution loan', async () => {
    mockLoanFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    await service.processPayment('staff-1', 1, 2026, 3000, ContributionSource.ManualEntry, 'actor-id', 'Actor');

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx jest src/contributions/contributions.service.spec.ts --no-coverage --testNamePattern="handleRestitutionRedirect"
```

Expected: FAIL — redirect not implemented yet

- [ ] **Step 3: Implement `handleRestitutionRedirect` and hook into `processPayment` and `processLumpSum`**

Add private method to `ContributionsService`:

```typescript
private async handleRestitutionRedirect(
  staffId: string,
  newPayment: number,
  actorId: string,
  actorName: string,
): Promise<void> {
  const restitutionLoan = await this.loanModel.findOne({
    staffId,
    status: LoanStatus.Defaulted,
    $expr: { $gt: ['$guarantorRestitutionOwed', '$guarantorRestitutionPaid'] },
  }).exec();

  if (!restitutionLoan) return;

  const remainingOwed = restitutionLoan.guarantorRestitutionOwed - restitutionLoan.guarantorRestitutionPaid;
  const redirectAmount = Math.min(newPayment, remainingOwed);
  if (redirectAmount <= 0) return;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  await this.contributionModel.create({
    staffId,
    month,
    year,
    expectedAmount: 0,
    paidAmount: redirectAmount,
    surplusCarriedForward: 0,
    isDebit: true,
    status: ContributionStatus.Paid,
    source: ContributionSource.DefaulterRestitution,
    recordedBy: actorName,
  });

  await this.contributionModel.create({
    staffId: restitutionLoan.guarantorId,
    month,
    year,
    expectedAmount: 0,
    paidAmount: redirectAmount,
    surplusCarriedForward: 0,
    isDebit: false,
    status: ContributionStatus.Paid,
    source: ContributionSource.DefaulterRestitution,
    recordedBy: actorName,
  });

  await this.loanModel.findByIdAndUpdate(restitutionLoan._id, {
    $inc: { guarantorRestitutionPaid: redirectAmount },
  }).exec();

  this.auditService.log(
    actorId, actorName, AuditAction.Update, AuditEntity.Loan,
    restitutionLoan._id.toString(), undefined,
    { redirectAmount, guarantorId: restitutionLoan.guarantorId, staffId },
  );
}
```

Hook into `processPayment` — add this call just before `return result`:

```typescript
await this.handleRestitutionRedirect(staffId, newPayment, actorId, actorName);
return result;
```

Hook into `processLumpSum` — add this call just before `return results`:

```typescript
await this.handleRestitutionRedirect(staffId, amount, actorId, actorName);
return results;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx jest src/contributions/contributions.service.spec.ts --no-coverage --testNamePattern="handleRestitutionRedirect"
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run full contributions service test suite**

```bash
cd apps/api && npx jest src/contributions/contributions.service.spec.ts --no-coverage
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/contributions/contributions.service.ts apps/api/src/contributions/contributions.service.spec.ts
git commit -m "feat(api): add restitution redirect hook to ContributionsService processPayment and processLumpSum"
```

---

## Task 7: DefaultRecoveryJob — Cron 1 (End-of-Tenure Detection)

**Files:**
- Create: `apps/api/src/loans/jobs/default-recovery.job.ts`
- Create: `apps/api/src/loans/jobs/default-recovery.job.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/loans/jobs/default-recovery.job.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DefaultRecoveryJob } from './default-recovery.job';
import { Loan } from '../schemas/loan.schema';
import { LoanRepayment } from '../schemas/loan-repayment.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';
import { LoanRepaymentStatus, LoanStatus } from '@welfare/shared';

const mockConfig = () => ({
  PENALTY_TYPE: { value: 'Fixed' },
  PENALTY_VALUE: { value: '500' },
  END_OF_TENURE_GRACE_PERIOD_MONTHS: { value: '1' },
});

const pastDate = new Date('2026-01-05');
const futureDate = new Date('2099-01-05');

describe('DefaultRecoveryJob', () => {
  let job: DefaultRecoveryJob;
  let loanModel: any;
  let repaymentModel: any;
  let configService: any;
  let auditService: any;
  let contributionsService: any;

  beforeEach(async () => {
    loanModel = {
      find: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };
    repaymentModel = {
      aggregate: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
    };
    configService = { getAll: jest.fn().mockResolvedValue(mockConfig()) };
    auditService = { log: jest.fn() };
    contributionsService = {
      debitDefaulterContribution: jest.fn(),
      debitGuarantorOffset: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefaultRecoveryJob,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
      ],
    }).compile();

    job = module.get<DefaultRecoveryJob>(DefaultRecoveryJob);
    jest.clearAllMocks();
    configService.getAll.mockResolvedValue(mockConfig());
  });

  const makeLoan = (id = 'loan-1', staffId = 'staff-1', guarantorId = 'g-1') => ({
    _id: { toString: () => id },
    staffId,
    guarantorId,
    status: LoanStatus.Active,
    save: jest.fn().mockResolvedValue(undefined),
  });

  describe('detectAndMarkDefaulted (Cron 1)', () => {
    it('marks active loan as Defaulted when final instalment is past due', async () => {
      repaymentModel.aggregate.mockResolvedValue([{ _id: 'loan-1', maxDueDate: pastDate, count: 1 }]);
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([makeLoan()]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      repaymentModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await job.detectAndMarkDefaulted();

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: LoanStatus.Defaulted }),
        }),
      );
      expect(repaymentModel.updateMany).toHaveBeenCalledWith(
        { loanId: 'loan-1', status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] } },
        { $set: { status: LoanRepaymentStatus.Overdue } },
      );
    });

    it('skips when no candidate loans found', async () => {
      repaymentModel.aggregate.mockResolvedValue([]);

      await job.detectAndMarkDefaulted();

      expect(loanModel.find).not.toHaveBeenCalled();
      expect(loanModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('sets endOfTenureGraceExpiry to first day of month after grace period', async () => {
      repaymentModel.aggregate.mockResolvedValue([{ _id: 'loan-1', maxDueDate: pastDate, count: 1 }]);
      loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([makeLoan()]) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      repaymentModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await job.detectAndMarkDefaulted();

      const call = loanModel.findByIdAndUpdate.mock.calls[0];
      const graceExpiry: Date = call[1].$set.endOfTenureGraceExpiry;
      expect(graceExpiry.getDate()).toBe(1); // first day of month
    });
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd apps/api && npx jest src/loans/jobs/default-recovery.job.spec.ts --no-coverage --testNamePattern="Cron 1"
```

Expected: FAIL — `Cannot find module './default-recovery.job'`

- [ ] **Step 3: Create `default-recovery.job.ts` with Cron 1**

Create `apps/api/src/loans/jobs/default-recovery.job.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditAction,
  AuditEntity,
  ConfigKey,
  LoanRepaymentStatus,
  LoanStatus,
  RepaymentSource,
} from '@welfare/shared';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';

type ConfigMap = Record<string, { value: string }>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class DefaultRecoveryJob {
  private readonly logger = new Logger(DefaultRecoveryJob.name);

  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
  ) {}

  @Cron('10 0 * * *')
  async detectAndMarkDefaulted(): Promise<void> {
    this.logger.log('Starting end-of-tenure default detection');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const graceMonths = parseInt(config[ConfigKey.EndOfTenureGracePeriodMonths]?.value ?? '1', 10);

    const candidates = await this.repaymentModel.aggregate([
      { $match: { status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } } },
      { $group: { _id: '$loanId', maxDueDate: { $max: '$dueDate' }, count: { $sum: 1 } } },
      { $match: { maxDueDate: { $lt: today } } },
    ]).exec() as Array<{ _id: string; maxDueDate: Date; count: number }>;

    if (candidates.length === 0) return;

    const candidateLoanIds = candidates.map((c) => c._id);
    const activeLoans = await this.loanModel.find({
      _id: { $in: candidateLoanIds },
      status: LoanStatus.Active,
    }).exec();

    this.logger.log(`Found ${activeLoans.length} loans to mark Defaulted`);

    for (const loan of activeLoans) {
      try {
        const graceExpiry = new Date(today.getFullYear(), today.getMonth() + graceMonths + 1, 1);

        await this.loanModel.findByIdAndUpdate(loan._id, {
          $set: {
            status: LoanStatus.Defaulted,
            defaultedAt: today,
            endOfTenureGraceExpiry: graceExpiry,
          },
        }).exec();

        await this.repaymentModel.updateMany(
          { loanId: loan._id.toString(), status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] } },
          { $set: { status: LoanRepaymentStatus.Overdue } },
        ).exec();

        this.auditService.log(
          'system', 'DefaultRecoveryJob',
          AuditAction.Update, AuditEntity.Loan,
          loan._id.toString(),
          { status: LoanStatus.Active },
          { status: LoanStatus.Defaulted, defaultedAt: today, endOfTenureGraceExpiry: graceExpiry },
        );
      } catch (err) {
        this.logger.error(`Failed to mark loan ${loan._id.toString()} as Defaulted`, err);
      }
    }
  }
}
```

- [ ] **Step 4: Run Cron 1 tests to confirm they pass**

```bash
cd apps/api && npx jest src/loans/jobs/default-recovery.job.spec.ts --no-coverage --testNamePattern="Cron 1"
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/jobs/default-recovery.job.ts apps/api/src/loans/jobs/default-recovery.job.spec.ts
git commit -m "feat(api): add DefaultRecoveryJob Cron 1 - end-of-tenure default detection"
```

---

## Task 8: DefaultRecoveryJob — Cron 2 (Grace Period Recovery)

**Files:**
- Modify: `apps/api/src/loans/jobs/default-recovery.job.ts`
- Modify: `apps/api/src/loans/jobs/default-recovery.job.spec.ts`

- [ ] **Step 1: Write failing tests**

Add this `describe` block inside the outer `describe('DefaultRecoveryJob', ...)` in the spec file:

```typescript
describe('runGracePeriodRecovery (Cron 2)', () => {
  const makeDefaultedLoan = (id = 'loan-1') => ({
    _id: { toString: () => id },
    staffId: 'staff-1',
    guarantorId: 'g-1',
    status: LoanStatus.Defaulted,
    defaulterContributionDebited: 0,
    guarantorRestitutionOwed: 0,
    guarantorRestitutionPaid: 0,
  });

  const makeInstalment = (dueAmount = 5000, paidAmount = 0) => ({
    _id: { toString: () => 'inst-1' },
    loanId: 'loan-1',
    dueAmount,
    paidAmount,
    penaltyAmount: 0,
    status: LoanRepaymentStatus.Overdue,
    source: undefined as any,
    guarantorStaffId: undefined as any,
    paidDate: undefined as any,
    save: jest.fn().mockResolvedValue(undefined),
  });

  it('deducts from defaulter first, then guarantor for shortfall', async () => {
    const loan = makeDefaultedLoan();
    const inst = makeInstalment(5000);

    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    repaymentModel.find
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) }) // unpaid for outstanding calc
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) }); // for guarantor application
    loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 2000, remaining: 3000 });
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 3000, remaining: 0 });

    await job.runGracePeriodRecovery();

    expect(contributionsService.debitDefaulterContribution).toHaveBeenCalledWith('staff-1', 5000, 'system', 'DefaultRecoveryJob');
    expect(contributionsService.debitGuarantorOffset).toHaveBeenCalledWith('g-1', 3000, 'loan-1', 'system', 'DefaultRecoveryJob');
    expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          defaulterContributionDebited: 2000,
          guarantorRestitutionOwed: 3000,
          badDebtAmount: 0,
        }),
      }),
    );
  });

  it('records badDebtAmount when guarantor balance also insufficient', async () => {
    const loan = makeDefaultedLoan();
    const inst = makeInstalment(5000);

    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    repaymentModel.find
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([inst]) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
    loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    contributionsService.debitDefaulterContribution.mockResolvedValue({ debited: 0, remaining: 5000 });
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 2000, remaining: 3000 });

    await job.runGracePeriodRecovery();

    expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          defaulterContributionDebited: 0,
          guarantorRestitutionOwed: 2000,
          badDebtAmount: 3000,
          recoveryRanAt: expect.any(Date),
        }),
      }),
    );
  });

  it('skips when no defaulted loans past grace expiry', async () => {
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.runGracePeriodRecovery();

    expect(contributionsService.debitDefaulterContribution).not.toHaveBeenCalled();
  });

  it('sets recoveryRanAt even when outstanding is zero', async () => {
    const loan = makeDefaultedLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }); // no unpaid
    loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    await job.runGracePeriodRecovery();

    expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { recoveryRanAt: expect.any(Date) } },
    );
    expect(contributionsService.debitDefaulterContribution).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd apps/api && npx jest src/loans/jobs/default-recovery.job.spec.ts --no-coverage --testNamePattern="Cron 2"
```

Expected: FAIL — `job.runGracePeriodRecovery is not a function`

- [ ] **Step 3: Add Cron 2 to `default-recovery.job.ts`**

Add these two methods inside the `DefaultRecoveryJob` class (after `detectAndMarkDefaulted`):

```typescript
@Cron('15 0 * * *')
async runGracePeriodRecovery(): Promise<void> {
  this.logger.log('Starting grace period recovery');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const defaultedLoans = await this.loanModel.find({
    status: LoanStatus.Defaulted,
    endOfTenureGraceExpiry: { $lt: today },
    recoveryRanAt: { $exists: false },
  }).exec();

  this.logger.log(`Found ${defaultedLoans.length} defaulted loans for recovery`);

  for (const loan of defaultedLoans) {
    try {
      await this.recoverDefaultedLoan(loan, today);
    } catch (err) {
      this.logger.error(`Failed recovery for loan ${loan._id.toString()}`, err);
    }
  }
}

private async recoverDefaultedLoan(loan: LoanDocument, today: Date): Promise<void> {
  const loanId = loan._id.toString();

  const unpaidInstalments = await this.repaymentModel.find({
    loanId,
    status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
  }).exec();

  const outstanding = round2(
    unpaidInstalments.reduce((sum, i) => sum + i.dueAmount + i.penaltyAmount - i.paidAmount, 0),
  );

  if (outstanding <= 0) {
    await this.loanModel.findByIdAndUpdate(loan._id, { $set: { recoveryRanAt: today } }).exec();
    return;
  }

  const { debited: defaulterDebited, remaining: afterDefaulter } =
    await this.contributionsService.debitDefaulterContribution(
      loan.staffId, outstanding, 'system', 'DefaultRecoveryJob',
    );

  let guarantorRestitutionOwed = 0;
  let badDebtAmount = 0;

  if (afterDefaulter > 0) {
    const { debited: guarantorDebited, remaining: stillUnpaid } =
      await this.contributionsService.debitGuarantorOffset(
        loan.guarantorId, afterDefaulter, loanId, 'system', 'DefaultRecoveryJob',
      );
    guarantorRestitutionOwed = guarantorDebited;
    badDebtAmount = round2(stillUnpaid);
  }

  let defaulterBudget = defaulterDebited;
  for (const inst of unpaidInstalments) {
    if (defaulterBudget <= 0) break;
    const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
    if (defaulterBudget >= owed) {
      inst.paidAmount = round2(inst.paidAmount + owed);
      inst.status = LoanRepaymentStatus.Paid;
      inst.source = RepaymentSource.ExitDeduction;
      inst.paidDate = today;
      defaulterBudget = round2(defaulterBudget - owed);
    } else {
      inst.paidAmount = round2(inst.paidAmount + defaulterBudget);
      inst.status = LoanRepaymentStatus.Partial;
      inst.source = RepaymentSource.ExitDeduction;
      inst.paidDate = today;
      defaulterBudget = 0;
    }
    await inst.save();
  }

  if (guarantorRestitutionOwed > 0) {
    let guarantorBudget = guarantorRestitutionOwed;
    const stillUnpaidInsts = await this.repaymentModel.find({
      loanId,
      status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
    }).exec();
    for (const inst of stillUnpaidInsts) {
      if (guarantorBudget <= 0) break;
      const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
      if (guarantorBudget >= owed) {
        inst.paidAmount = round2(inst.paidAmount + owed);
        inst.status = LoanRepaymentStatus.Paid;
        inst.source = RepaymentSource.GuarantorOffset;
        inst.guarantorStaffId = loan.guarantorId;
        inst.paidDate = today;
        guarantorBudget = round2(guarantorBudget - owed);
      } else {
        inst.paidAmount = round2(inst.paidAmount + guarantorBudget);
        inst.status = LoanRepaymentStatus.Partial;
        inst.source = RepaymentSource.GuarantorOffset;
        inst.guarantorStaffId = loan.guarantorId;
        inst.paidDate = today;
        guarantorBudget = 0;
      }
      await inst.save();
    }
  }

  await this.loanModel.findByIdAndUpdate(loan._id, {
    $set: {
      defaulterContributionDebited: defaulterDebited,
      guarantorRestitutionOwed,
      badDebtAmount,
      recoveryRanAt: today,
    },
  }).exec();

  this.auditService.log(
    'system', 'DefaultRecoveryJob',
    AuditAction.Update, AuditEntity.Loan,
    loanId, undefined,
    { defaulterDebited, guarantorRestitutionOwed, badDebtAmount },
  );
}
```

- [ ] **Step 4: Run Cron 2 tests to confirm they pass**

```bash
cd apps/api && npx jest src/loans/jobs/default-recovery.job.spec.ts --no-coverage --testNamePattern="Cron 2"
```

Expected: PASS (4 tests)

- [ ] **Step 5: Run full spec file**

```bash
cd apps/api && npx jest src/loans/jobs/default-recovery.job.spec.ts --no-coverage
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/jobs/default-recovery.job.ts apps/api/src/loans/jobs/default-recovery.job.spec.ts
git commit -m "feat(api): add DefaultRecoveryJob Cron 2 - grace period recovery with defaulter and guarantor deduction"
```

---

## Task 9: LoansService — Guard in `checkAndCompleteIfDone`

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts`
- Modify: `apps/api/src/loans/loans.service.spec.ts`

- [ ] **Step 1: Write failing test**

Add this test block to `loans.service.spec.ts`, inside `describe('LoansService', ...)`:

```typescript
describe('checkAndCompleteIfDone guard for Defaulted loans', () => {
  it('does not auto-complete a Defaulted loan with outstanding restitution', async () => {
    // All instalments paid
    repaymentModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    // Loan is Defaulted with restitution still owed
    const defaultedLoan = {
      _id: { toString: () => 'loan-d' },
      staffId: 'staff-1',
      status: LoanStatus.Defaulted,
      guarantorRestitutionOwed: 5000,
      guarantorRestitutionPaid: 2000,
      fullName: 'Test',
    };
    loanModel.findById = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(defaultedLoan) });
    loanModel.findByIdAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    // Trigger via recordPayment path — call checkAndCompleteIfDone indirectly
    // by calling the private method directly through type casting
    await (service as any).checkAndCompleteIfDone('loan-d', 'actor', 'Actor');

    expect(loanModel.findByIdAndUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: { status: LoanStatus.Completed } }),
      expect.anything(),
    );
  });

  it('auto-completes a Defaulted loan when restitution is fully paid', async () => {
    repaymentModel.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    const defaultedLoan = {
      _id: { toString: () => 'loan-d' },
      staffId: 'staff-1',
      status: LoanStatus.Defaulted,
      guarantorRestitutionOwed: 5000,
      guarantorRestitutionPaid: 5000,
      fullName: 'Test',
    };
    loanModel.findById = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(defaultedLoan) });
    loanModel.findByIdAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...defaultedLoan, status: LoanStatus.Completed }),
    });
    staffService.findById = jest.fn().mockResolvedValue({ fullName: 'Test Staff' });

    await (service as any).checkAndCompleteIfDone('loan-d', 'actor', 'Actor');

    expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'loan-d',
      { $set: { status: LoanStatus.Completed } },
      { new: true },
    );
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd apps/api && npx jest src/loans/loans.service.spec.ts --no-coverage --testNamePattern="guard for Defaulted"
```

Expected: FAIL — guard not yet implemented

- [ ] **Step 3: Add guard to `checkAndCompleteIfDone`**

Replace the existing `checkAndCompleteIfDone` method in `apps/api/src/loans/loans.service.ts`:

```typescript
private async checkAndCompleteIfDone(
  loanId: string,
  actorId: string,
  actorName: string,
): Promise<void> {
  const remaining = await this.repaymentModel
    .find({ loanId, status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } })
    .exec();

  if (remaining.length > 0) return;

  const loan = await this.loanModel.findById(loanId).exec();
  if (!loan) return;

  if (
    loan.status === LoanStatus.Defaulted &&
    (loan.guarantorRestitutionOwed ?? 0) > (loan.guarantorRestitutionPaid ?? 0)
  ) {
    return;
  }

  const completedLoan = await this.loanModel
    .findByIdAndUpdate(loanId, { $set: { status: LoanStatus.Completed } }, { new: true })
    .exec();
  this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, undefined, {
    status: LoanStatus.Completed,
  });
  if (completedLoan) {
    this.staffService.findById(completedLoan.staffId)
      .then(staff => this.syncLoanToMeilisearch(completedLoan, staff.fullName))
      .catch(() => { /* non-fatal */ });
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx jest src/loans/loans.service.spec.ts --no-coverage --testNamePattern="guard for Defaulted"
```

Expected: PASS (2 tests)

- [ ] **Step 5: Run full loans service suite**

```bash
cd apps/api && npx jest src/loans/loans.service.spec.ts --no-coverage
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(api): guard checkAndCompleteIfDone against auto-completing Defaulted loans with outstanding restitution"
```

---

## Task 10: Register DefaultRecoveryJob in LoansModule

**Files:**
- Modify: `apps/api/src/loans/loans.module.ts`

- [ ] **Step 1: Add `DefaultRecoveryJob` to providers**

Replace `apps/api/src/loans/loans.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { LoansController } from './loans.controller';
import { StaffLoansController } from './staff-loans.controller';
import { LoansService } from './loans.service';
import { LoansImportService } from './loans.import.service';
import { OverdueDetectionJob } from './jobs/overdue-detection.job';
import { DefaultRecoveryJob } from './jobs/default-recovery.job';
import { Loan, LoanSchema } from './schemas/loan.schema';
import { LoanRepayment, LoanRepaymentSchema } from './schemas/loan-repayment.schema';
import { LoanImportBatch, LoanImportBatchSchema } from './schemas/loan-import-batch.schema';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';
import { StaffModule } from '../staff/staff.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { ContributionsModule } from '../contributions/contributions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Loan.name, schema: LoanSchema },
      { name: LoanRepayment.name, schema: LoanRepaymentSchema },
      { name: LoanImportBatch.name, schema: LoanImportBatchSchema },
      { name: Staff.name, schema: StaffSchema },
    ]),
    MulterModule.register({}),
    StaffModule,
    SystemConfigModule,
    ContributionsModule,
  ],
  controllers: [LoansController, StaffLoansController],
  providers: [LoansService, LoansImportService, OverdueDetectionJob, DefaultRecoveryJob, LoanScheduleSenderService],
  exports: [LoansService],
})
export class LoansModule {}
```

- [ ] **Step 2: Build to verify no DI errors**

```bash
cd apps/api && npx nest build 2>&1 | tail -20
```

Expected: build completes with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/loans/loans.module.ts
git commit -m "feat(api): register DefaultRecoveryJob in LoansModule"
```

---

## Task 11: UI — Default Recovery Info Card

**Files:**
- Modify: `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

- [ ] **Step 1: Add the Default Recovery card after the settlement summary section**

Find the line in `loan-detail-client.tsx` that reads:

```typescript
const showSettlementSummary = loan.status !== LoanStatus.Active &&
    ((loan.exitDeductionAmount ?? 0) > 0 || (loan.guarantorOffsetAmount ?? 0) > 0 || (loan.badDebtAmount ?? 0) > 0);
```

Add directly after it:

```typescript
const showDefaultRecovery = loan.status === LoanStatus.Defaulted;
const restitutionOwed = loan.guarantorRestitutionOwed ?? 0;
const restitutionPaid = loan.guarantorRestitutionPaid ?? 0;
const restitutionRemaining = Math.max(0, restitutionOwed - restitutionPaid);
const restitutionPct = restitutionOwed > 0 ? Math.round((restitutionPaid / restitutionOwed) * 100) : 0;
```

- [ ] **Step 2: Add the card to the JSX**

Find the settlement summary card block in the JSX (it renders when `showSettlementSummary` is true). Add the Default Recovery card immediately after it:

```tsx
{showDefaultRecovery && (
  <Card>
    <CardHeader title="Default Recovery" />
    <CardBody>
      <div className="grid grid-cols-2 gap-4 mb-4 sm:grid-cols-3">
        {([
          ['Defaulted On', loan.defaultedAt ? fmtDate(loan.defaultedAt) : '—'],
          ['Grace Expiry', loan.endOfTenureGraceExpiry ? fmtDate(loan.endOfTenureGraceExpiry) : '—'],
          ['Defaulter Deducted', fmtGHS(loan.defaulterContributionDebited ?? 0)],
          ['Guarantor Deducted', fmtGHS(restitutionOwed)],
          ['Guarantor Reimbursed', fmtGHS(restitutionPaid)],
          ['Still to Reimburse', fmtGHS(restitutionRemaining)],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">{label}</p>
            <p className="text-base font-bold text-neutral-900 mt-0.5 font-mono tabular">{value}</p>
          </div>
        ))}
      </div>
      {restitutionOwed > 0 && (
        <div>
          <div className="flex justify-between text-xs text-neutral-500 mb-1">
            <span>Guarantor reimbursement</span>
            <span>{restitutionPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-warning-500 transition-all"
              style={{ width: `${restitutionPct}%` }}
            />
          </div>
        </div>
      )}
    </CardBody>
  </Card>
)}
```

- [ ] **Step 3: Verify TypeScript types compile**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to new fields (they're all optional in `ILoan`)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx
git commit -m "feat(web): add Default Recovery info card to loan detail page"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ `END_OF_TENURE_GRACE_PERIOD_MONTHS` config key (Task 1)
  - ✅ New loan schema fields including `recoveryRanAt` (Task 3)
  - ✅ `DefaulterDeduction` and `DefaulterRestitution` sources (Task 1)
  - ✅ `debitDefaulterContribution` (Task 5)
  - ✅ Redirect hook in `processPayment` and `processLumpSum` (Task 6)
  - ✅ Cron 1 — detect and mark Defaulted (Task 7)
  - ✅ Cron 2 — grace period recovery (Task 8)
  - ✅ `checkAndCompleteIfDone` guard (Task 9)
  - ✅ Module registration (Task 10)
  - ✅ UI card (Task 11)
  - ✅ Badge colour — already maps `Defaulted` → `'danger'` in existing `STATUS_KIND`, no change needed
- **Placeholders:** None
- **Type consistency:** `debitDefaulterContribution` signature used in Task 5, Task 7, and Task 8 — all match `(staffId, amount, actorId, actorName)` returning `{ debited, remaining }`
