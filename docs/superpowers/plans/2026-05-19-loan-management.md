# Loan Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full loan lifecycle — record approved loans, generate repayment schedules, import/record payments with surplus carry and penalty, detect overdue instalments with guarantor offset, and handle exit settlement with bad-debt tracking.

**Architecture:** NestJS `LoansModule` with `LoansService` (core operations) and `LoansImportService` (Excel import), a `@Cron`-based `OverdueDetectionJob`, and a `StaffLoansController` sibling to handle `/staff/:id/loans`. Guarantor offset flows through `ContributionsService.debitGuarantorOffset`, which creates a signed debit entry in the existing `contributions` collection.

**Tech Stack:** NestJS, Mongoose (MongoDB), `@nestjs/schedule` (@Cron), `minio`, `xlsx`, `class-validator`, `@welfare/shared` enums.

---

## File Map

**Create:**
| File | Purpose |
|------|---------|
| `packages/shared/src/enums/repayment-source.enum.ts` | `RepaymentSource` enum |
| `apps/api/src/loans/schemas/loan.schema.ts` | Loan Mongoose schema |
| `apps/api/src/loans/schemas/loan-repayment.schema.ts` | LoanRepayment Mongoose schema |
| `apps/api/src/loans/dto/create-loan.dto.ts` | POST /loans body |
| `apps/api/src/loans/dto/record-payment.dto.ts` | POST /loans/:id/repayments body |
| `apps/api/src/loans/dto/exit-settlement.dto.ts` | POST /loans/:id/settle-exit body |
| `apps/api/src/loans/dto/loan-query.dto.ts` | GET /loans query params |
| `apps/api/src/loans/loans.service.ts` | Core loan operations |
| `apps/api/src/loans/loans.import.service.ts` | Excel import processing |
| `apps/api/src/loans/jobs/overdue-detection.job.ts` | Daily @Cron overdue job |
| `apps/api/src/loans/loans.controller.ts` | `/loans` HTTP endpoints |
| `apps/api/src/loans/staff-loans.controller.ts` | `/staff/:id/loans` endpoint |
| `apps/api/src/loans/loans.module.ts` | Module wiring |
| `apps/api/src/loans/loans.service.spec.ts` | LoansService unit tests |
| `apps/api/src/loans/jobs/overdue-detection.job.spec.ts` | OverdueDetectionJob unit tests |

**Modify:**
| File | Change |
|------|--------|
| `packages/shared/src/enums/contribution-source.enum.ts` | Add `GuarantorOffset` |
| `packages/shared/src/enums/config-key.enum.ts` | Add `GracePeriodDays` |
| `packages/shared/src/interfaces/loan.interface.ts` | Fix `interestRate` type, rename `approvalDocumentKey` → `documentKey`, add `notes` |
| `packages/shared/src/interfaces/loan-repayment.interface.ts` | Align fields with schema |
| `packages/shared/src/index.ts` | Export `RepaymentSource` |
| `apps/api/src/contributions/schemas/contribution.schema.ts` | Add `isDebit` field, update unique index to partial |
| `apps/api/src/contributions/contributions.service.ts` | Add `getBalance` + `debitGuarantorOffset` |
| `apps/api/src/system-config/system-config.service.ts` | Add `GracePeriodDays` seed + validation |
| `apps/api/src/app.module.ts` | Import `LoansModule` |

---

## Task 1: Shared — RepaymentSource enum + ContributionSource.GuarantorOffset + ConfigKey.GracePeriodDays + updated interfaces

**Files:**
- Create: `packages/shared/src/enums/repayment-source.enum.ts`
- Modify: `packages/shared/src/enums/contribution-source.enum.ts`
- Modify: `packages/shared/src/enums/config-key.enum.ts`
- Modify: `packages/shared/src/interfaces/loan.interface.ts`
- Modify: `packages/shared/src/interfaces/loan-repayment.interface.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create RepaymentSource enum**

```typescript
// packages/shared/src/enums/repayment-source.enum.ts
export enum RepaymentSource {
  DirectPayment = 'DirectPayment',
  Import = 'Import',
  GuarantorOffset = 'GuarantorOffset',
  ExitDeduction = 'ExitDeduction',
}
```

- [ ] **Step 2: Add GuarantorOffset to ContributionSource**

Replace the content of `packages/shared/src/enums/contribution-source.enum.ts`:

```typescript
export enum ContributionSource {
  PayrollImport = 'PayrollImport',
  ManualEntry = 'ManualEntry',
  LumpSum = 'LumpSum',
  GuarantorOffset = 'GuarantorOffset',
}
```

- [ ] **Step 3: Add GracePeriodDays to ConfigKey**

Add one entry to `packages/shared/src/enums/config-key.enum.ts` after `MaxLoansPerGuarantor`:

```typescript
  GracePeriodDays = 'GRACE_PERIOD_DAYS',
```

Full file after change:

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
  GracePeriodDays = 'GRACE_PERIOD_DAYS',
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

- [ ] **Step 4: Update ILoan interface**

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
  exitDeductionAmount?: number;
  guarantorOffsetAmount?: number;
  badDebtAmount?: number;
  settledAt?: string;
  notes?: string;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 5: Update ILoanRepayment interface**

Replace `packages/shared/src/interfaces/loan-repayment.interface.ts`:

```typescript
import { LoanRepaymentStatus } from '../enums/loan-repayment-status.enum';
import { RepaymentSource } from '../enums/repayment-source.enum';

export interface ILoanRepayment {
  _id: string;
  loanId: string;
  staffId: string;
  instalmentNumber: number;
  dueDate: string;
  dueAmount: number;
  paidAmount: number;
  penaltyAmount: number;
  status: LoanRepaymentStatus;
  paidDate?: string;
  source?: RepaymentSource;
  guarantorStaffId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 6: Export RepaymentSource from shared index**

In `packages/shared/src/index.ts`, add after the last enum export line:

```typescript
export { RepaymentSource } from './enums/repayment-source.enum';
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/enums/repayment-source.enum.ts \
        packages/shared/src/enums/contribution-source.enum.ts \
        packages/shared/src/enums/config-key.enum.ts \
        packages/shared/src/interfaces/loan.interface.ts \
        packages/shared/src/interfaces/loan-repayment.interface.ts \
        packages/shared/src/index.ts
git commit -m "feat(shared): add RepaymentSource enum, GuarantorOffset source, GracePeriodDays config key"
```

---

## Task 2: Contribution schema — isDebit field + partial unique index

**Files:**
- Modify: `apps/api/src/contributions/schemas/contribution.schema.ts`

The `contributions` collection currently has a strict unique index `{ staffId, month, year }`. Guarantor offset debits create multiple entries for the same month/year, so the index must be scoped to non-debit entries via a partial filter.

- [ ] **Step 1: Write the failing test (ContributionsService balance)**

In `apps/api/src/contributions/contributions.service.spec.ts`, add to the existing describe block:

```typescript
describe('getBalance', () => {
  it('returns credits minus debits for a staff member', async () => {
    // aggregate is not on the standard mock — mock it directly
    const mockAggregate = jest.fn();
    (service as any).contributionModel.aggregate = mockAggregate;

    mockAggregate
      .mockResolvedValueOnce([{ total: 5000 }])  // credits
      .mockResolvedValueOnce([{ total: 1200 }]);  // debits

    const balance = await service.getBalance('staff-mongo-id');
    expect(balance).toBe(3800);
  });

  it('handles no records (returns 0)', async () => {
    const mockAggregate = jest.fn();
    (service as any).contributionModel.aggregate = mockAggregate;
    mockAggregate.mockResolvedValue([]);
    const balance = await service.getBalance('staff-mongo-id');
    expect(balance).toBe(0);
  });
});

describe('debitGuarantorOffset', () => {
  it('creates debit entry for available balance and returns remainder', async () => {
    const mockAggregate = jest.fn();
    (service as any).contributionModel.aggregate = mockAggregate;
    mockAggregate
      .mockResolvedValueOnce([{ total: 800 }])
      .mockResolvedValueOnce([]);

    const mockCreate = jest.fn().mockResolvedValue({});
    (service as any).contributionModel.create = mockCreate;

    const result = await service.debitGuarantorOffset(
      'guarantor-id', 1000, 'loan-id', 'actor-id', 'Actor Name'
    );

    expect(result.debited).toBe(800);
    expect(result.remaining).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ isDebit: true, paidAmount: 800, source: 'GuarantorOffset' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest contributions.service.spec.ts --testNamePattern="getBalance|debitGuarantorOffset" --no-coverage
```

Expected: FAIL — `service.getBalance is not a function`

- [ ] **Step 3: Update Contribution schema**

Replace `apps/api/src/contributions/schemas/contribution.schema.ts`:

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ContributionStatus, ContributionSource } from '@welfare/shared';

export type ContributionDocument = HydratedDocument<Contribution>;

@Schema({ timestamps: true, collection: 'contributions' })
export class Contribution {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0 }) expectedAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) surplusCarriedForward!: number;
  @Prop({ required: true, enum: ContributionStatus, default: ContributionStatus.Missed })
  status!: ContributionStatus;
  @Prop({ required: true, enum: ContributionSource }) source!: ContributionSource;
  @Prop({ default: false }) isDebit!: boolean;
  @Prop() importBatchId?: string;
  @Prop({ required: true }) recordedBy!: string;
}

export const ContributionSchema = SchemaFactory.createForClass(Contribution);

// Unique constraint applies only to non-debit (credit) entries
ContributionSchema.index(
  { staffId: 1, month: 1, year: 1 },
  { unique: true, partialFilterExpression: { isDebit: { $ne: true } } },
);
ContributionSchema.index({ status: 1 });
ContributionSchema.index({ month: 1, year: 1 });
ContributionSchema.index({ staffId: 1, isDebit: 1 });
```

- [ ] **Step 4: Add getBalance and debitGuarantorOffset to ContributionsService**

Append the following methods to the `ContributionsService` class in `apps/api/src/contributions/contributions.service.ts` (before the closing `}`):

```typescript
  async getBalance(staffId: string): Promise<number> {
    const [creditResult, debitResult] = await Promise.all([
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: true } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
    ]);
    const credits = (creditResult as { total: number }[])[0]?.total ?? 0;
    const debits = (debitResult as { total: number }[])[0]?.total ?? 0;
    return credits - debits;
  }

  async debitGuarantorOffset(
    guarantorId: string,
    amount: number,
    _loanId: string,
    _actorId: string,
    actorName: string,
  ): Promise<{ debited: number; remaining: number }> {
    const balance = await this.getBalance(guarantorId);
    const debited = Math.min(amount, Math.max(0, balance));
    const remaining = amount - debited;

    if (debited > 0) {
      const now = new Date();
      await this.contributionModel.create({
        staffId: guarantorId,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        expectedAmount: 0,
        paidAmount: debited,
        surplusCarriedForward: 0,
        isDebit: true,
        status: ContributionStatus.Paid,
        source: ContributionSource.GuarantorOffset,
        recordedBy: actorName,
      });
    }

    return { debited, remaining };
  }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && npx jest contributions.service.spec.ts --testNamePattern="getBalance|debitGuarantorOffset" --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/contributions/schemas/contribution.schema.ts \
        apps/api/src/contributions/contributions.service.ts \
        apps/api/src/contributions/contributions.service.spec.ts
git commit -m "feat(contributions): add isDebit field, partial unique index, getBalance, debitGuarantorOffset"
```

---

## Task 3: SystemConfig — GracePeriodDays seed + validation

**Files:**
- Modify: `apps/api/src/system-config/system-config.service.ts`

- [ ] **Step 1: Add GracePeriodDays to SEED_DEFAULTS array**

In `system-config.service.ts`, add after the `MaxLoansPerGuarantor` entry in `SEED_DEFAULTS`:

```typescript
  { key: ConfigKey.GracePeriodDays, value: '0' },
```

- [ ] **Step 2: Add GracePeriodDays validation to validateUpdates switch**

In `system-config.service.ts`, add a case inside `validateUpdates` after `MaxLoansPerGuarantor`:

```typescript
        case ConfigKey.GracePeriodDays:
          if (!(parseInt(value, 10) >= 0))
            throw new UnprocessableEntityException(`GracePeriodDays must be >= 0`);
          break;
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/system-config/system-config.service.ts
git commit -m "feat(config): add GracePeriodDays config key with seed default 0"
```

---

## Task 4: Loan schema

**Files:**
- Create: `apps/api/src/loans/schemas/loan.schema.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/loans/loans.service.spec.ts` with just the describe shell and one schema smoke test (the full tests come in Task 13; this just ensures the file exists to track progress):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoansService } from './loans.service';
import { Loan } from './schemas/loan.schema';
import { LoanRepayment } from './schemas/loan-repayment.schema';
import { StaffService } from '../staff/staff.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionsService } from '../contributions/contributions.service';
import { MINIO_CLIENT } from '../storage/minio.module';

describe('LoansService', () => {
  it('placeholder — full tests added in Task 13', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd apps/api && npx jest loans.service.spec.ts --no-coverage
```

Expected: PASS (1 test)

- [ ] **Step 3: Create Loan schema**

Create `apps/api/src/loans/schemas/loan.schema.ts`:

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
  @Prop({ required: true, min: 1, max: 12 }) tenureMonths!: number;
  @Prop({ required: true }) disbursedDate!: Date;
  @Prop({ required: true, enum: LoanStatus, default: LoanStatus.Active }) status!: LoanStatus;
  @Prop() documentKey?: string;
  @Prop({ min: 0, default: 0 }) exitDeductionAmount?: number;
  @Prop({ min: 0, default: 0 }) guarantorOffsetAmount?: number;
  @Prop({ min: 0, default: 0 }) badDebtAmount?: number;
  @Prop() settledAt?: Date;
  @Prop() notes?: string;
  @Prop({ required: true }) recordedBy!: string;
}

export const LoanSchema = SchemaFactory.createForClass(Loan);
LoanSchema.index({ staffId: 1, status: 1 });
LoanSchema.index({ guarantorId: 1 });
LoanSchema.index({ status: 1 });
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/loans/schemas/loan.schema.ts \
        apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): add Loan schema"
```

---

## Task 5: LoanRepayment schema

**Files:**
- Create: `apps/api/src/loans/schemas/loan-repayment.schema.ts`

- [ ] **Step 1: Create LoanRepayment schema**

Create `apps/api/src/loans/schemas/loan-repayment.schema.ts`:

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LoanRepaymentStatus, RepaymentSource } from '@welfare/shared';

export type LoanRepaymentDocument = HydratedDocument<LoanRepayment>;

@Schema({ timestamps: true, collection: 'loan_repayments' })
export class LoanRepayment {
  @Prop({ required: true }) loanId!: string;
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, min: 1 }) instalmentNumber!: number;
  @Prop({ required: true }) dueDate!: Date;
  @Prop({ required: true, min: 0 }) dueAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
  @Prop({ required: true, min: 0, default: 0 }) penaltyAmount!: number;
  @Prop({ required: true, enum: LoanRepaymentStatus, default: LoanRepaymentStatus.Pending })
  status!: LoanRepaymentStatus;
  @Prop() paidDate?: Date;
  @Prop({ enum: Object.values(RepaymentSource) }) source?: RepaymentSource;
  @Prop() guarantorStaffId?: string;
  @Prop() notes?: string;
}

export const LoanRepaymentSchema = SchemaFactory.createForClass(LoanRepayment);
LoanRepaymentSchema.index({ loanId: 1, instalmentNumber: 1 }, { unique: true });
LoanRepaymentSchema.index({ loanId: 1, status: 1 });
LoanRepaymentSchema.index({ staffId: 1 });
LoanRepaymentSchema.index({ dueDate: 1, status: 1 });
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/loans/schemas/loan-repayment.schema.ts
git commit -m "feat(loans): add LoanRepayment schema"
```

---

## Task 6: DTOs

**Files:**
- Create: `apps/api/src/loans/dto/create-loan.dto.ts`
- Create: `apps/api/src/loans/dto/record-payment.dto.ts`
- Create: `apps/api/src/loans/dto/exit-settlement.dto.ts`
- Create: `apps/api/src/loans/dto/loan-query.dto.ts`

- [ ] **Step 1: Create CreateLoanDto**

```typescript
// apps/api/src/loans/dto/create-loan.dto.ts
import { IsString, IsNotEmpty, IsNumber, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLoanDto {
  @IsString() @IsNotEmpty() staffId!: string;
  @IsString() @IsNotEmpty() guarantorId!: string;
  @IsNumber() @Min(1) @Type(() => Number) principalAmount!: number;
  @IsNumber() @Min(1) @Max(12) @Type(() => Number) tenureMonths!: number;
  @IsDateString() disbursedDate!: string;
}
```

- [ ] **Step 2: Create RecordPaymentDto**

```typescript
// apps/api/src/loans/dto/record-payment.dto.ts
import { IsNumber, IsDateString, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RecordPaymentDto {
  @IsNumber() @Min(0.01) @Type(() => Number) amount!: number;
  @IsDateString() paidDate!: string;
  @IsString() @IsOptional() notes?: string;
}
```

- [ ] **Step 3: Create ExitSettlementDto**

```typescript
// apps/api/src/loans/dto/exit-settlement.dto.ts
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ExitSettlementDto {
  @IsNumber() @Min(0) @Type(() => Number) exitDeductionAmount!: number;
  @IsString() @IsOptional() notes?: string;
}
```

- [ ] **Step 4: Create LoanQueryDto**

```typescript
// apps/api/src/loans/dto/loan-query.dto.ts
import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { LoanStatus } from '@welfare/shared';

export class LoanQueryDto {
  @IsString() @IsOptional() staffId?: string;
  @IsEnum(LoanStatus) @IsOptional() status?: LoanStatus;
  @IsNumber() @Min(1) @Type(() => Number) @IsOptional() page?: number;
  @IsNumber() @Min(1) @Type(() => Number) @IsOptional() limit?: number;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/dto/
git commit -m "feat(loans): add DTOs for loan creation, payment, exit settlement, and list query"
```

---

## Task 7: LoansService — create loan + repayment schedule generation

**Files:**
- Create: `apps/api/src/loans/loans.service.ts`

- [ ] **Step 1: Write the failing test (create loan happy path)**

Replace the placeholder in `apps/api/src/loans/loans.service.spec.ts` with:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LoansService } from './loans.service';
import { Loan } from './schemas/loan.schema';
import { LoanRepayment } from './schemas/loan-repayment.schema';
import { StaffService } from '../staff/staff.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionsService } from '../contributions/contributions.service';
import { MINIO_CLIENT } from '../storage/minio.module';
import { LoanStatus, LoanRepaymentStatus, StaffStatus } from '@welfare/shared';

const activeStaff = (id: string, staffId = 'SF001') => ({
  _id: { toString: () => id },
  staffId,
  status: StaffStatus.Active,
  dateOfEmployment: new Date('2020-01-01'),
  fullName: 'Test Staff',
  toObject: () => ({ _id: id, staffId, status: StaffStatus.Active }),
});

const mockConfig = () => ({
  LOAN_MIN_AMOUNT: { value: '500' },
  LOAN_MAX_AMOUNT: { value: '50000' },
  LOAN_MAX_TENURE: { value: '12' },
  INTEREST_RATE_SHORT: { value: '5' },
  INTEREST_RATE_LONG: { value: '8' },
  ELIGIBILITY_MONTHS: { value: '6' },
  PENALTY_TYPE: { value: 'Fixed' },
  PENALTY_VALUE: { value: '500' },
  MAX_LOANS_PER_GUARANTOR: { value: '3' },
  GRACE_PERIOD_DAYS: { value: '0' },
});

describe('LoansService', () => {
  let service: LoansService;
  let loanModel: any;
  let repaymentModel: any;
  let staffService: any;
  let configService: any;
  let auditService: any;
  let contributionsService: any;
  let minioClient: any;

  beforeEach(async () => {
    loanModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    repaymentModel = {
      insertMany: jest.fn(),
      find: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
    };
    staffService = { findOne: jest.fn() };
    configService = { getAll: jest.fn() };
    auditService = { log: jest.fn() };
    contributionsService = { debitGuarantorOffset: jest.fn() };
    minioClient = { putObject: jest.fn(), presignedGetObject: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: StaffService, useValue: staffService },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
        { provide: MINIO_CLIENT, useValue: minioClient },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto = {
      staffId: 'staff-mongo-id',
      guarantorId: 'guarantor-mongo-id',
      principalAmount: 10000,
      tenureMonths: 3,
      disbursedDate: '2026-03-15',
    };

    it('creates loan with correct totalRepayable and schedule', async () => {
      staffService.findOne
        .mockResolvedValueOnce(activeStaff('staff-mongo-id', 'SF001'))   // borrower
        .mockResolvedValueOnce(activeStaff('guarantor-mongo-id', 'SF002')); // guarantor

      loanModel.findOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })   // no active loan
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });    // guarantor loan count

      configService.getAll.mockResolvedValue(mockConfig());

      const savedLoan = {
        _id: { toString: () => 'loan-id' },
        staffId: 'staff-mongo-id',
        principalAmount: 10000,
        interestRate: 5,
        totalRepayable: 10500,
        monthlyInstalment: 3500,
        tenureMonths: 3,
        disbursedDate: new Date('2026-03-15'),
        status: LoanStatus.Active,
        toObject: () => ({}),
      };
      loanModel.create.mockResolvedValue(savedLoan);
      repaymentModel.insertMany.mockResolvedValue([]);

      const result = await service.create(dto, 'actor-id', 'Actor');

      expect(loanModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          principalAmount: 10000,
          interestRate: 5,
          totalRepayable: 10500,
          monthlyInstalment: 3500,
          tenureMonths: 3,
        }),
      );
      expect(repaymentModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            instalmentNumber: 1,
            dueAmount: 3500,
            status: LoanRepaymentStatus.Pending,
          }),
          expect.objectContaining({ instalmentNumber: 2 }),
          expect.objectContaining({ instalmentNumber: 3 }),
        ]),
      );
      // Instalment 1 due date: disbursed March 2026 → April 5, 2026
      const [firstInstalment] = (repaymentModel.insertMany.mock.calls[0] as any[][])[0];
      expect(new Date(firstInstalment.dueDate).getDate()).toBe(5);
      expect(new Date(firstInstalment.dueDate).getMonth()).toBe(3); // April = 3
    });

    it('throws BadRequestException when staff is not Active', async () => {
      staffService.findOne.mockResolvedValueOnce({
        ...activeStaff('staff-mongo-id'),
        status: StaffStatus.Resigned,
      });
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when staff already has an active loan', async () => {
      staffService.findOne.mockResolvedValueOnce(activeStaff('staff-mongo-id'));
      loanModel.findOne.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({ _id: 'existing-loan' }),
      });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when employment below threshold', async () => {
      staffService.findOne.mockResolvedValueOnce({
        ...activeStaff('staff-mongo-id'),
        dateOfEmployment: new Date(), // employed today → 0 months
      });
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when guarantorId equals staffId', async () => {
      const sameId = { ...dto, guarantorId: dto.staffId };
      staffService.findOne.mockResolvedValueOnce(activeStaff('staff-mongo-id'));
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(sameId, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when guarantor is not Active', async () => {
      staffService.findOne
        .mockResolvedValueOnce(activeStaff('staff-mongo-id'))
        .mockResolvedValueOnce({ ...activeStaff('guarantor-mongo-id'), status: StaffStatus.Retired });
      loanModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      configService.getAll.mockResolvedValue(mockConfig());
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when amount below configured minimum', async () => {
      staffService.findOne
        .mockResolvedValueOnce(activeStaff('staff-mongo-id'))
        .mockResolvedValueOnce(activeStaff('guarantor-mongo-id'));
      loanModel.findOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) });
      configService.getAll.mockResolvedValue({ ...mockConfig(), LOAN_MIN_AMOUNT: { value: '20000' } });
      await expect(service.create(dto, 'actor', 'Actor')).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest loans.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './loans.service'`

- [ ] **Step 3: Create LoansService**

Create `apps/api/src/loans/loans.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client as MinioClient } from 'minio';
import {
  AuditAction,
  AuditEntity,
  ConfigKey,
  LoanRepaymentStatus,
  LoanStatus,
  PaginatedResult,
  RepaymentSource,
  StaffStatus,
} from '@welfare/shared';
import { Loan, LoanDocument } from './schemas/loan.schema';
import { LoanRepayment, LoanRepaymentDocument } from './schemas/loan-repayment.schema';
import { StaffService } from '../staff/staff.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionsService } from '../contributions/contributions.service';
import { MINIO_CLIENT } from '../storage/minio.module';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ExitSettlementDto } from './dto/exit-settlement.dto';
import { LoanQueryDto } from './dto/loan-query.dto';

type ConfigMap = Record<string, { value: string }>;

const LOAN_DOCS_BUCKET = 'loan-docs';
const LOAN_DOC_PRESIGN_TTL = 15 * 60;
const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  );
}

function computeDueDate(disbursedDate: Date, instalmentN: number): Date {
  const d = new Date(disbursedDate);
  d.setDate(1);
  d.setMonth(d.getMonth() + instalmentN);
  d.setDate(5);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class LoansService {
  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name)
    private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly staffService: StaffService,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
  ) {}

  // ───────────────── CREATE LOAN ─────────────────

  async create(dto: CreateLoanDto, actorId: string, actorName: string): Promise<LoanDocument> {
    const config = await this.configService.getAll();

    const staff = await this.staffService.findOne(dto.staffId);
    if (!staff) throw new NotFoundException(`Staff ${dto.staffId} not found`);
    if (staff.status !== StaffStatus.Active)
      throw new BadRequestException('Staff is not Active');

    const activeLoan = await this.loanModel
      .findOne({ staffId: dto.staffId, status: LoanStatus.Active })
      .exec();
    if (activeLoan) throw new ConflictException('Staff already has an active loan');

    const eligibilityMonths = parseInt(config[ConfigKey.EligibilityMonths]?.value ?? '6', 10);
    const employed = monthsBetween(new Date(staff.dateOfEmployment), new Date());
    if (employed < eligibilityMonths)
      throw new BadRequestException(
        `Staff must be employed for at least ${eligibilityMonths} months (currently ${employed})`,
      );

    if (dto.guarantorId === dto.staffId)
      throw new BadRequestException('Guarantor must be different from borrower');

    const guarantor = await this.staffService.findOne(dto.guarantorId);
    if (!guarantor) throw new NotFoundException(`Guarantor ${dto.guarantorId} not found`);
    if (guarantor.status !== StaffStatus.Active)
      throw new BadRequestException('Guarantor is not Active');

    const maxPerGuarantor = parseInt(config[ConfigKey.MaxLoansPerGuarantor]?.value ?? '0', 10);
    if (maxPerGuarantor > 0) {
      const guarantorLoanCount = await this.loanModel
        .countDocuments({ guarantorId: dto.guarantorId, status: LoanStatus.Active })
        .exec();
      if (guarantorLoanCount >= maxPerGuarantor)
        throw new BadRequestException(
          `Guarantor has reached the maximum of ${maxPerGuarantor} guaranteed active loans`,
        );
    }

    const minAmount = parseFloat(config[ConfigKey.LoanMinAmount]?.value ?? '500');
    const maxAmount = parseFloat(config[ConfigKey.LoanMaxAmount]?.value ?? '50000');
    if (dto.principalAmount < minAmount || dto.principalAmount > maxAmount)
      throw new BadRequestException(
        `Loan amount must be between ${minAmount} and ${maxAmount}`,
      );

    if (dto.tenureMonths < 1 || dto.tenureMonths > 12)
      throw new BadRequestException('Tenure must be between 1 and 12 months');

    const interestRate =
      dto.tenureMonths <= 6
        ? parseFloat(config[ConfigKey.InterestRateShort]?.value ?? '5')
        : parseFloat(config[ConfigKey.InterestRateLong]?.value ?? '8');

    const totalRepayable = round2(
      dto.principalAmount + dto.principalAmount * (interestRate / 100),
    );
    const monthlyInstalment = round2(totalRepayable / dto.tenureMonths);
    const disbursedDate = new Date(dto.disbursedDate);

    const loan = await this.loanModel.create({
      staffId: dto.staffId,
      guarantorId: dto.guarantorId,
      principalAmount: dto.principalAmount,
      interestRate,
      totalRepayable,
      monthlyInstalment,
      tenureMonths: dto.tenureMonths,
      disbursedDate,
      status: LoanStatus.Active,
      recordedBy: actorName,
    });

    const loanId = loan._id.toString();
    const schedule = Array.from({ length: dto.tenureMonths }, (_, i) => ({
      loanId,
      staffId: dto.staffId,
      instalmentNumber: i + 1,
      dueDate: computeDueDate(disbursedDate, i + 1),
      dueAmount: monthlyInstalment,
      paidAmount: 0,
      penaltyAmount: 0,
      status: LoanRepaymentStatus.Pending,
    }));
    await this.repaymentModel.insertMany(schedule);

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Disburse,
      AuditEntity.Loan,
      loanId,
      undefined,
      { principalAmount: dto.principalAmount, tenureMonths: dto.tenureMonths },
    );

    return loan;
  }

  // ───────────────── QUERIES ─────────────────

  async findAll(query: LoanQueryDto): Promise<PaginatedResult<LoanDocument>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = {};
    if (query.staffId) filter['staffId'] = query.staffId;
    if (query.status) filter['status'] = query.status;

    const [data, total] = await Promise.all([
      this.loanModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.loanModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string): Promise<LoanDocument> {
    const loan = await this.loanModel.findById(id).exec();
    if (!loan) throw new NotFoundException(`Loan ${id} not found`);
    return loan;
  }

  async findByStaff(
    staffId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<LoanDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.loanModel.find({ staffId }).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.loanModel.countDocuments({ staffId }).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByGuarantor(
    guarantorId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<LoanDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.loanModel
        .find({ guarantorId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.loanModel.countDocuments({ guarantorId }).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findBadDebt(page = 1, limit = 20): Promise<PaginatedResult<LoanDocument>> {
    const skip = (page - 1) * limit;
    const filter = { status: LoanStatus.BadDebt };
    const [data, total] = await Promise.all([
      this.loanModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).exec(),
      this.loanModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getRepaymentSchedule(loanId: string): Promise<LoanRepaymentDocument[]> {
    return this.repaymentModel.find({ loanId }).sort({ instalmentNumber: 1 }).exec();
  }

  // ───────────────── DOCUMENT ─────────────────

  async uploadDocument(
    loanId: string,
    file: Express.Multer.File,
    actorId: string,
    actorName: string,
  ): Promise<LoanDocument> {
    const loan = await this.findOne(loanId);

    if (!ALLOWED_DOC_TYPES.includes(file.mimetype))
      throw new BadRequestException('Document must be PDF, JPEG, or PNG');
    if (file.size > MAX_DOC_BYTES)
      throw new BadRequestException('Document must not exceed 10 MB');

    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? 'pdf';
    const key = `${loanId}/approval.${ext}`;
    await this.minioClient.putObject(LOAN_DOCS_BUCKET, key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });

    const updated = await this.loanModel
      .findByIdAndUpdate(loanId, { $set: { documentKey: key } }, { new: true })
      .exec();

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Update,
      AuditEntity.Loan,
      loanId,
      { documentKey: loan.documentKey },
      { documentKey: key },
    );

    return updated!;
  }

  async getDocumentUrl(loanId: string): Promise<{ url: string }> {
    const loan = await this.findOne(loanId);
    if (!loan.documentKey)
      throw new NotFoundException('No approval document uploaded for this loan');
    const url = await this.minioClient.presignedGetObject(
      LOAN_DOCS_BUCKET,
      loan.documentKey,
      LOAN_DOC_PRESIGN_TTL,
    );
    return { url };
  }
}
```

- [ ] **Step 4: Run tests to verify create tests pass**

```bash
cd apps/api && npx jest loans.service.spec.ts --testNamePattern="create" --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/loans.service.ts \
        apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): LoansService — loan creation with validation and repayment schedule"
```

---

## Task 8: LoansService — record payment (surplus carry + penalty)

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts` (add `recordPayment` method)
- Modify: `apps/api/src/loans/loans.service.spec.ts` (add `recordPayment` tests)

- [ ] **Step 1: Write the failing tests**

Append to the `describe('LoansService')` block in `loans.service.spec.ts`:

```typescript
  describe('recordPayment', () => {
    const loanId = 'loan-id';
    const dto: RecordPaymentDto = { amount: 3500, paidDate: '2026-04-10', notes: undefined };

    const makeLoan = (status = LoanStatus.Active) => ({
      _id: { toString: () => loanId },
      status,
      toObject: () => ({}),
    });

    const makeInstalment = (
      n: number,
      status: LoanRepaymentStatus,
      paidAmount = 0,
      penaltyAmount = 0,
      dueDate = new Date('2026-04-05'),
    ) => ({
      _id: { toString: () => `inst-${n}` },
      instalmentNumber: n,
      dueDate,
      dueAmount: 3500,
      paidAmount,
      penaltyAmount,
      status,
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks instalment Paid when payment equals dueAmount', async () => {
      const inst = makeInstalment(1, LoanRepaymentStatus.Pending);
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find.mockReturnValue({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) });
      configService.getAll.mockResolvedValue(mockConfig());
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(inst.save).toHaveBeenCalled();
      expect(inst.status).toBe(LoanRepaymentStatus.Paid);
      expect(inst.paidAmount).toBe(3500);
    });

    it('carries surplus to next instalment when overpaying', async () => {
      const inst1 = makeInstalment(1, LoanRepaymentStatus.Pending);
      const inst2 = makeInstalment(2, LoanRepaymentStatus.Pending);
      const overpayDto: RecordPaymentDto = { amount: 5000, paidDate: '2026-04-10' };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find.mockReturnValue({
        sort: () => ({ exec: jest.fn().mockResolvedValue([inst1, inst2]) }),
      });
      configService.getAll.mockResolvedValue(mockConfig());
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.recordPayment(loanId, overpayDto, 'actor', 'Actor');

      expect(inst1.status).toBe(LoanRepaymentStatus.Paid);
      expect(inst1.paidAmount).toBe(3500);
      expect(inst2.status).toBe(LoanRepaymentStatus.Partial);
      expect(inst2.paidAmount).toBe(1500); // 5000 - 3500
    });

    it('applies penalty when paying an Overdue instalment after dueDate', async () => {
      const overdueInst = makeInstalment(
        1,
        LoanRepaymentStatus.Overdue,
        0,
        0,
        new Date('2026-04-05'),
      );
      const latePayDto: RecordPaymentDto = { amount: 4000, paidDate: '2026-04-20' };
      // penalty = 500 (Fixed from mockConfig), total owed = 3500 + 500 = 4000

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find.mockReturnValue({
        sort: () => ({ exec: jest.fn().mockResolvedValue([overdueInst]) }),
      });
      configService.getAll.mockResolvedValue(mockConfig());
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.recordPayment(loanId, latePayDto, 'actor', 'Actor');

      expect(overdueInst.penaltyAmount).toBe(500);
      expect(overdueInst.paidAmount).toBe(4000);
      expect(overdueInst.status).toBe(LoanRepaymentStatus.Paid);
    });

    it('marks loan Completed when all instalments are Paid', async () => {
      const inst = makeInstalment(1, LoanRepaymentStatus.Pending);
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find
        .mockReturnValueOnce({ sort: () => ({ exec: jest.fn().mockResolvedValue([inst]) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ ...inst, status: LoanRepaymentStatus.Paid }]) });
      configService.getAll.mockResolvedValue(mockConfig());
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.recordPayment(loanId, dto, 'actor', 'Actor');

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        loanId,
        { $set: { status: LoanStatus.Completed } },
        { new: true },
      );
    });

    it('throws NotFoundException when loan does not exist', async () => {
      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.recordPayment('missing', dto, 'actor', 'Actor')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
```

Add import at the top: `import { RecordPaymentDto } from './dto/record-payment.dto';`

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest loans.service.spec.ts --testNamePattern="recordPayment" --no-coverage
```

Expected: FAIL — `service.recordPayment is not a function`

- [ ] **Step 3: Add recordPayment to LoansService**

Append to `loans.service.ts` (inside the class, before last `}`):

```typescript
  // ───────────────── RECORD PAYMENT ─────────────────

  async recordPayment(
    loanId: string,
    dto: RecordPaymentDto,
    actorId: string,
    actorName: string,
  ): Promise<LoanRepaymentDocument[]> {
    const loan = await this.findOne(loanId);
    if (loan.status === LoanStatus.Completed)
      throw new BadRequestException('Loan is already completed');

    const config = await this.configService.getAll();
    const paidDate = new Date(dto.paidDate);

    const pendingInstalments = await this.repaymentModel
      .find({
        loanId,
        status: {
          $in: [
            LoanRepaymentStatus.Pending,
            LoanRepaymentStatus.Partial,
            LoanRepaymentStatus.Overdue,
          ],
        },
      })
      .sort({ instalmentNumber: 1 })
      .exec();

    if (pendingInstalments.length === 0)
      throw new BadRequestException('No pending instalments for this loan');

    let remaining = dto.amount;
    const updated: LoanRepaymentDocument[] = [];

    for (const inst of pendingInstalments) {
      if (remaining <= 0) break;

      // Apply penalty if paying late on an Overdue instalment
      if (inst.status === LoanRepaymentStatus.Overdue && paidDate > inst.dueDate && inst.penaltyAmount === 0) {
        inst.penaltyAmount = this.calculatePenalty(inst.dueAmount, config);
      }

      const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);

      if (remaining >= outstanding) {
        inst.paidAmount = round2(inst.paidAmount + outstanding);
        inst.status = LoanRepaymentStatus.Paid;
        remaining = round2(remaining - outstanding);
      } else {
        inst.paidAmount = round2(inst.paidAmount + remaining);
        inst.status = LoanRepaymentStatus.Partial;
        remaining = 0;
      }

      inst.paidDate = paidDate;
      inst.source = RepaymentSource.DirectPayment;
      if (dto.notes) inst.notes = dto.notes;
      await inst.save();
      updated.push(inst);
    }

    await this.checkAndCompleteIfDone(loanId, actorId, actorName);

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.RecordPayment,
      AuditEntity.Loan,
      loanId,
      undefined,
      { amount: dto.amount, paidDate: dto.paidDate },
    );

    return updated;
  }

  private calculatePenalty(dueAmount: number, config: ConfigMap): number {
    const penaltyType = config[ConfigKey.PenaltyType]?.value ?? 'Fixed';
    const penaltyValue = parseFloat(config[ConfigKey.PenaltyValue]?.value ?? '0');
    if (penaltyValue === 0) return 0;
    return penaltyType === 'Percentage'
      ? round2(dueAmount * (penaltyValue / 100))
      : penaltyValue;
  }

  private async checkAndCompleteIfDone(
    loanId: string,
    actorId: string,
    actorName: string,
  ): Promise<void> {
    const remaining = await this.repaymentModel
      .find({
        loanId,
        status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
      })
      .exec();

    if (remaining.length === 0) {
      await this.loanModel
        .findByIdAndUpdate(loanId, { $set: { status: LoanStatus.Completed } }, { new: true })
        .exec();
      this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, undefined, {
        status: LoanStatus.Completed,
      });
    }
  }
```

Also add `ConfigMap` type at top of file (after imports):

```typescript
type ConfigMap = Record<string, { value: string }>;
```

- [ ] **Step 4: Run tests to verify recordPayment tests pass**

```bash
cd apps/api && npx jest loans.service.spec.ts --testNamePattern="recordPayment" --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/loans.service.ts \
        apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): add recordPayment with surplus carry, penalty, and loan completion"
```

---

## Task 9: LoansService — exit settlement

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts` (add `exitSettle` method)
- Modify: `apps/api/src/loans/loans.service.spec.ts` (add `exitSettle` tests)

- [ ] **Step 1: Write the failing tests**

Append to `describe('LoansService')` in `loans.service.spec.ts`:

```typescript
  describe('exitSettle', () => {
    const loanId = 'loan-id';

    const makeLoan = (guarantorId = 'guarantor-id') => ({
      _id: { toString: () => loanId },
      guarantorId,
      status: LoanStatus.Active,
      toObject: () => ({}),
      save: jest.fn().mockResolvedValue(undefined),
    });

    const makeInstalment = (
      n: number,
      paidAmount = 0,
      penaltyAmount = 0,
      status = LoanRepaymentStatus.Pending,
    ) => ({
      _id: { toString: () => `inst-${n}` },
      instalmentNumber: n,
      dueAmount: 3500,
      paidAmount,
      penaltyAmount,
      status,
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks loan Completed when exitDeductionAmount covers full outstanding', async () => {
      const insts = [makeInstalment(1), makeInstalment(2), makeInstalment(3)]; // 3 × 3500 = 10500 outstanding
      const dto: ExitSettlementDto = { exitDeductionAmount: 10500 };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue(insts) });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.exitSettle(loanId, dto, 'actor', 'Actor');

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        loanId,
        expect.objectContaining({
          $set: expect.objectContaining({ status: LoanStatus.Completed, exitDeductionAmount: 10500 }),
        }),
        { new: true },
      );
      insts.forEach((i) => expect(i.save).toHaveBeenCalled());
    });

    it('uses guarantor offset when deduction is insufficient', async () => {
      const insts = [makeInstalment(1), makeInstalment(2)]; // 7000 outstanding
      const dto: ExitSettlementDto = { exitDeductionAmount: 4000 }; // 3000 gap

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue(insts) });
      contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 3000, remaining: 0 });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.exitSettle(loanId, dto, 'actor', 'Actor');

      expect(contributionsService.debitGuarantorOffset).toHaveBeenCalledWith(
        'guarantor-id', 3000, loanId, 'actor', 'Actor',
      );
      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        loanId,
        expect.objectContaining({
          $set: expect.objectContaining({
            status: LoanStatus.Completed,
            guarantorOffsetAmount: 3000,
            badDebtAmount: 0,
          }),
        }),
        { new: true },
      );
    });

    it('sets status BadDebt when guarantor offset still leaves a remainder', async () => {
      const insts = [makeInstalment(1), makeInstalment(2)]; // 7000 outstanding
      const dto: ExitSettlementDto = { exitDeductionAmount: 2000 };

      loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
      repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue(insts) });
      contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 1000, remaining: 4000 });
      loanModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

      await service.exitSettle(loanId, dto, 'actor', 'Actor');

      expect(loanModel.findByIdAndUpdate).toHaveBeenCalledWith(
        loanId,
        expect.objectContaining({
          $set: expect.objectContaining({
            status: LoanStatus.BadDebt,
            badDebtAmount: 4000,
          }),
        }),
        { new: true },
      );
    });
  });
```

Add import: `import { ExitSettlementDto } from './dto/exit-settlement.dto';`

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest loans.service.spec.ts --testNamePattern="exitSettle" --no-coverage
```

Expected: FAIL — `service.exitSettle is not a function`

- [ ] **Step 3: Add exitSettle to LoansService**

Append to `loans.service.ts` (inside class):

```typescript
  // ───────────────── EXIT SETTLEMENT ─────────────────

  async exitSettle(
    loanId: string,
    dto: ExitSettlementDto,
    actorId: string,
    actorName: string,
  ): Promise<LoanDocument> {
    const loan = await this.findOne(loanId);
    if (loan.status !== LoanStatus.Active)
      throw new BadRequestException('Loan is not Active');

    const unpaidInstalments = await this.repaymentModel
      .find({
        loanId,
        status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] },
      })
      .exec();

    const outstanding = round2(
      unpaidInstalments.reduce(
        (sum, i) => sum + i.dueAmount + i.penaltyAmount - i.paidAmount,
        0,
      ),
    );

    let guarantorOffsetAmount = 0;
    let badDebtAmount = 0;
    let finalStatus = LoanStatus.Completed;

    let remaining = round2(outstanding - dto.exitDeductionAmount);

    // Apply exit deduction to earliest instalments
    let budgetLeft = dto.exitDeductionAmount;
    for (const inst of unpaidInstalments) {
      if (budgetLeft <= 0) break;
      const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
      if (budgetLeft >= owed) {
        inst.paidAmount = round2(inst.paidAmount + owed);
        inst.status = LoanRepaymentStatus.Paid;
        inst.source = RepaymentSource.ExitDeduction;
        inst.paidDate = new Date();
        budgetLeft = round2(budgetLeft - owed);
      } else {
        inst.paidAmount = round2(inst.paidAmount + budgetLeft);
        inst.status = LoanRepaymentStatus.Partial;
        inst.source = RepaymentSource.ExitDeduction;
        inst.paidDate = new Date();
        budgetLeft = 0;
      }
      await inst.save();
    }

    if (remaining > 0) {
      const { debited, remaining: stillUnpaid } =
        await this.contributionsService.debitGuarantorOffset(
          loan.guarantorId,
          remaining,
          loanId,
          actorId,
          actorName,
        );
      guarantorOffsetAmount = debited;
      badDebtAmount = round2(stillUnpaid);
      finalStatus = badDebtAmount > 0 ? LoanStatus.BadDebt : LoanStatus.Completed;

      // Mark guarantor-offset portion as paid on remaining instalments
      if (guarantorOffsetAmount > 0) {
        let offsetLeft = guarantorOffsetAmount;
        const stillUnpaidInsts = await this.repaymentModel
          .find({ loanId, status: { $nin: [LoanRepaymentStatus.Paid, LoanRepaymentStatus.Waived] } })
          .exec();
        for (const inst of stillUnpaidInsts) {
          if (offsetLeft <= 0) break;
          const owed = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
          if (offsetLeft >= owed) {
            inst.paidAmount = round2(inst.paidAmount + owed);
            inst.status = LoanRepaymentStatus.Paid;
            inst.source = RepaymentSource.GuarantorOffset;
            inst.guarantorStaffId = loan.guarantorId;
            inst.paidDate = new Date();
            offsetLeft = round2(offsetLeft - owed);
          } else {
            inst.paidAmount = round2(inst.paidAmount + offsetLeft);
            inst.status = LoanRepaymentStatus.Partial;
            inst.source = RepaymentSource.GuarantorOffset;
            inst.guarantorStaffId = loan.guarantorId;
            inst.paidDate = new Date();
            offsetLeft = 0;
          }
          await inst.save();
        }
      }
    }

    const updated = await this.loanModel
      .findByIdAndUpdate(
        loanId,
        {
          $set: {
            status: finalStatus,
            exitDeductionAmount: dto.exitDeductionAmount,
            guarantorOffsetAmount,
            badDebtAmount,
            settledAt: new Date(),
            notes: dto.notes,
          },
        },
        { new: true },
      )
      .exec();

    this.auditService.log(actorId, actorName, AuditAction.Settle, AuditEntity.Loan, loanId, undefined, {
      exitDeductionAmount: dto.exitDeductionAmount,
      guarantorOffsetAmount,
      badDebtAmount,
      finalStatus,
    });

    return updated!;
  }
```

- [ ] **Step 4: Run tests to verify exitSettle tests pass**

```bash
cd apps/api && npx jest loans.service.spec.ts --testNamePattern="exitSettle" --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run all LoansService tests**

```bash
cd apps/api && npx jest loans.service.spec.ts --no-coverage
```

Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.service.ts \
        apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): add exitSettle with deduction, guarantor offset, and bad debt tracking"
```

---

## Task 10: LoansImportService — Excel repayment import

**Files:**
- Create: `apps/api/src/loans/loans.import.service.ts`

- [ ] **Step 1: Create LoansImportService**

```typescript
// apps/api/src/loans/loans.import.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, RepaymentSource } from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from './schemas/loan-repayment.schema';
import { Loan, LoanDocument } from './schemas/loan.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { LoanStatus, LoanRepaymentStatus } from '@welfare/shared';

interface ImportRow {
  'Staff Name'?: string;
  'Staff ID'?: string;
  'Loan ID'?: string;
  Amount?: number;
  'Mode of Payment'?: string;
  'Paid Date'?: string;
}

export interface ImportRepaymentResult {
  total: number;
  processed: number;
  failed: { row: number; staffId: string; reason: string }[];
}

@Injectable()
export class LoansImportService {
  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanRepayment.name)
    private readonly repaymentModel: Model<LoanRepaymentDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    actorId: string,
    actorName: string,
  ): Promise<ImportRepaymentResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const failed: ImportRepaymentResult['failed'] = [];
    let processed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawStaffId = String(row['Staff ID'] ?? '').trim();
      const amount = Number(row.Amount ?? 0);
      const paidDateRaw = String(row['Paid Date'] ?? '').trim();
      const notes = String(row['Mode of Payment'] ?? '').trim() || undefined;

      if (!rawStaffId) {
        failed.push({ row: i + 2, staffId: '', reason: 'Missing Staff ID' });
        continue;
      }
      if (!(amount > 0)) {
        failed.push({ row: i + 2, staffId: rawStaffId, reason: 'Amount must be > 0' });
        continue;
      }

      let paidDate: string;
      if (paidDateRaw) {
        const d = new Date(paidDateRaw);
        if (isNaN(d.getTime())) {
          failed.push({ row: i + 2, staffId: rawStaffId, reason: 'Invalid Paid Date' });
          continue;
        }
        paidDate = d.toISOString();
      } else {
        paidDate = new Date().toISOString();
      }

      try {
        // Resolve staff
        const staff = await this.staffService.findByStaffId(rawStaffId);
        if (!staff) {
          failed.push({ row: i + 2, staffId: rawStaffId, reason: 'Staff ID not found' });
          continue;
        }

        // Resolve loan
        let loanId: string | undefined = row['Loan ID']
          ? String(row['Loan ID']).trim()
          : undefined;

        if (!loanId) {
          const activeLoan = await this.loanModel
            .findOne({ staffId: staff._id.toString(), status: LoanStatus.Active })
            .exec();
          if (!activeLoan) {
            failed.push({ row: i + 2, staffId: rawStaffId, reason: 'No active loan found' });
            continue;
          }
          loanId = activeLoan._id.toString();
        }

        await this.loansService.recordPaymentInternal(
          loanId,
          { amount, paidDate, notes },
          RepaymentSource.Import,
          actorId,
          actorName,
        );
        processed++;
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'Processing error';
        failed.push({ row: i + 2, staffId: rawStaffId, reason });
      }
    }

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Loan,
      'bulk-import',
      undefined,
      { total: rows.length, processed, failed: failed.length },
    );

    return { total: rows.length, processed, failed };
  }
}
```

- [ ] **Step 2: Expose recordPaymentInternal on LoansService**

`LoansImportService` calls `loansService.recordPaymentInternal(loanId, dto, source, actorId, actorName)` — a variant of `recordPayment` that accepts an explicit `RepaymentSource`. Add this method to `loans.service.ts`:

```typescript
  async recordPaymentInternal(
    loanId: string,
    dto: { amount: number; paidDate: string; notes?: string },
    source: RepaymentSource,
    actorId: string,
    actorName: string,
  ): Promise<LoanRepaymentDocument[]> {
    const loan = await this.findOne(loanId);
    if (loan.status === LoanStatus.Completed)
      throw new BadRequestException('Loan is already completed');

    const config = await this.configService.getAll();
    const paidDate = new Date(dto.paidDate);

    const pendingInstalments = await this.repaymentModel
      .find({
        loanId,
        status: {
          $in: [
            LoanRepaymentStatus.Pending,
            LoanRepaymentStatus.Partial,
            LoanRepaymentStatus.Overdue,
          ],
        },
      })
      .sort({ instalmentNumber: 1 })
      .exec();

    if (pendingInstalments.length === 0)
      throw new BadRequestException('No pending instalments for this loan');

    let remaining = dto.amount;
    const updated: LoanRepaymentDocument[] = [];

    for (const inst of pendingInstalments) {
      if (remaining <= 0) break;

      if (inst.status === LoanRepaymentStatus.Overdue && paidDate > inst.dueDate && inst.penaltyAmount === 0) {
        inst.penaltyAmount = this.calculatePenalty(inst.dueAmount, config);
      }

      const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);

      if (remaining >= outstanding) {
        inst.paidAmount = round2(inst.paidAmount + outstanding);
        inst.status = LoanRepaymentStatus.Paid;
        remaining = round2(remaining - outstanding);
      } else {
        inst.paidAmount = round2(inst.paidAmount + remaining);
        inst.status = LoanRepaymentStatus.Partial;
        remaining = 0;
      }

      inst.paidDate = paidDate;
      inst.source = source;
      if (dto.notes) inst.notes = dto.notes;
      await inst.save();
      updated.push(inst);
    }

    await this.checkAndCompleteIfDone(loanId, actorId, actorName);

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.RecordPayment,
      AuditEntity.Loan,
      loanId,
      undefined,
      { amount: dto.amount, paidDate: dto.paidDate, source },
    );

    return updated;
  }
```

Also refactor `recordPayment` to delegate to `recordPaymentInternal`:

```typescript
  async recordPayment(
    loanId: string,
    dto: RecordPaymentDto,
    actorId: string,
    actorName: string,
  ): Promise<LoanRepaymentDocument[]> {
    return this.recordPaymentInternal(
      loanId,
      { amount: dto.amount, paidDate: dto.paidDate, notes: dto.notes },
      RepaymentSource.DirectPayment,
      actorId,
      actorName,
    );
  }
```

Then remove the duplicate body that was in `recordPayment` (the original implementation).

- [ ] **Step 3: Run all LoansService tests**

```bash
cd apps/api && npx jest loans.service.spec.ts --no-coverage
```

Expected: PASS (all tests — the refactor must not break existing tests)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/loans/loans.import.service.ts \
        apps/api/src/loans/loans.service.ts
git commit -m "feat(loans): add LoansImportService for Excel repayment import"
```

---

## Task 11: OverdueDetectionJob

**Files:**
- Create: `apps/api/src/loans/jobs/overdue-detection.job.ts`
- Create: `apps/api/src/loans/jobs/overdue-detection.job.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/loans/jobs/overdue-detection.job.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OverdueDetectionJob } from './overdue-detection.job';
import { LoanRepayment } from '../schemas/loan-repayment.schema';
import { Loan } from '../schemas/loan.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';
import { LoanRepaymentStatus, LoanStatus, RepaymentSource } from '@welfare/shared';

const mockConfig = () => ({
  PENALTY_TYPE: { value: 'Fixed' },
  PENALTY_VALUE: { value: '500' },
  GRACE_PERIOD_DAYS: { value: '0' },
});

describe('OverdueDetectionJob', () => {
  let job: OverdueDetectionJob;
  let repaymentModel: any;
  let loanModel: any;
  let configService: any;
  let auditService: any;
  let contributionsService: any;

  beforeEach(async () => {
    repaymentModel = {
      find: jest.fn(),
    };
    loanModel = {
      findById: jest.fn(),
    };
    configService = { getAll: jest.fn() };
    auditService = { log: jest.fn() };
    contributionsService = { debitGuarantorOffset: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueDetectionJob,
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: AuditService, useValue: auditService },
        { provide: ContributionsService, useValue: contributionsService },
      ],
    }).compile();

    job = module.get<OverdueDetectionJob>(OverdueDetectionJob);
    jest.clearAllMocks();
  });

  const pastDate = new Date('2026-01-05'); // clearly in the past

  const makeInstalment = (loanId = 'loan-1', overrideDate = pastDate) => ({
    _id: { toString: () => 'inst-1' },
    loanId,
    dueDate: overrideDate,
    dueAmount: 3500,
    paidAmount: 0,
    penaltyAmount: 0,
    status: LoanRepaymentStatus.Pending,
    save: jest.fn().mockResolvedValue(undefined),
  });

  const makeLoan = (guarantorId = 'guarantor-id') => ({
    _id: { toString: () => 'loan-1' },
    guarantorId,
    status: LoanStatus.Active,
    save: jest.fn().mockResolvedValue(undefined),
  });

  it('marks pending instalments as Overdue and applies penalty', async () => {
    const inst = makeInstalment();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeLoan()) });
    configService.getAll.mockResolvedValue(mockConfig());

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Overdue);
    expect(inst.penaltyAmount).toBe(500);
    expect(inst.save).toHaveBeenCalled();
  });

  it('triggers guarantor offset when grace period has passed (gracePeriodDays=0 and new month)', async () => {
    // dueDate in past month → grace period passed
    const inst = makeInstalment('loan-1', new Date('2026-04-05'));
    // jest will run this test in May 2026 per the plan date (2026-05-19)
    // so we mock Date to be May 19 2026
    const realNow = Date;
    global.Date = class extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super('2026-05-19');
        } else {
          super(...(args as [any]));
        }
      }
    } as any;

    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    const loan = makeLoan('guarantor-id');
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(loan) });
    configService.getAll.mockResolvedValue(mockConfig());
    contributionsService.debitGuarantorOffset.mockResolvedValue({ debited: 4000, remaining: 0 });

    await job.detectAndProcess();

    expect(contributionsService.debitGuarantorOffset).toHaveBeenCalledWith(
      'guarantor-id',
      expect.any(Number),
      'loan-1',
      'system',
      'Overdue Detection Job',
    );
    expect(inst.status).toBe(LoanRepaymentStatus.Paid);
    expect(inst.source).toBe(RepaymentSource.GuarantorOffset);

    global.Date = realNow;
  });

  it('marks instalment Partial when guarantor balance is insufficient', async () => {
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

    await job.detectAndProcess();

    expect(inst.status).toBe(LoanRepaymentStatus.Partial);
    expect(inst.paidAmount).toBe(1000);

    global.Date = realNow;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest overdue-detection.job.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './overdue-detection.job'`

- [ ] **Step 3: Create OverdueDetectionJob**

Create `apps/api/src/loans/jobs/overdue-detection.job.ts`:

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
  RepaymentSource,
} from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { ContributionsService } from '../../contributions/contributions.service';

type ConfigMap = Record<string, { value: string }>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class OverdueDetectionJob {
  private readonly logger = new Logger(OverdueDetectionJob.name);

  constructor(
    @InjectModel(LoanRepayment.name)
    private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
    private readonly contributionsService: ContributionsService,
  ) {}

  @Cron('5 0 * * *')
  async detectAndProcess(): Promise<void> {
    this.logger.log('Starting overdue detection job');
    const config = await this.configService.getAll();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueInstalments = await this.repaymentModel
      .find({
        dueDate: { $lt: today },
        status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] },
      })
      .exec();

    this.logger.log(`Found ${dueInstalments.length} overdue instalments`);

    for (const inst of dueInstalments) {
      try {
        await this.processOverdueInstalment(inst, config, today);
      } catch (err) {
        this.logger.error(`Failed to process instalment ${inst._id.toString()}`, err);
      }
    }
  }

  private async processOverdueInstalment(
    inst: LoanRepaymentDocument,
    config: ConfigMap,
    today: Date,
  ): Promise<void> {
    // Mark as Overdue and apply penalty (once)
    inst.status = LoanRepaymentStatus.Overdue;
    if (inst.penaltyAmount === 0) {
      inst.penaltyAmount = this.calculatePenalty(inst.dueAmount, config);
    }
    await inst.save();

    // Check grace period
    if (!this.isGracePeriodExpired(inst.dueDate, today, config)) return;

    const loan = await this.loanModel.findById(inst.loanId).exec();
    if (!loan) return;

    const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);

    const { debited, remaining } = await this.contributionsService.debitGuarantorOffset(
      loan.guarantorId,
      outstanding,
      inst.loanId,
      'system',
      'Overdue Detection Job',
    );

    if (debited > 0) {
      inst.paidAmount = round2(inst.paidAmount + debited);
      inst.guarantorStaffId = loan.guarantorId;
      inst.source = RepaymentSource.GuarantorOffset;
      inst.paidDate = new Date();

      if (remaining === 0) {
        inst.status = LoanRepaymentStatus.Paid;
      } else {
        inst.status = LoanRepaymentStatus.Partial;
      }
      await inst.save();

      this.auditService.log(
        'system',
        'Overdue Detection Job',
        AuditAction.Update,
        AuditEntity.LoanRepayment,
        inst._id.toString(),
        undefined,
        { debited, remaining, guarantorId: loan.guarantorId },
      );
    }
  }

  private isGracePeriodExpired(dueDate: Date, today: Date, config: ConfigMap): boolean {
    const gracePeriodDays = parseInt(config[ConfigKey.GracePeriodDays]?.value ?? '0', 10);

    if (gracePeriodDays === 0) {
      // Default: expired when we're past the end of the due month
      return (
        today.getFullYear() > dueDate.getFullYear() ||
        (today.getFullYear() === dueDate.getFullYear() &&
          today.getMonth() > dueDate.getMonth())
      );
    }

    const expiry = new Date(dueDate.getTime() + gracePeriodDays * 86_400_000);
    return today >= expiry;
  }

  private calculatePenalty(dueAmount: number, config: ConfigMap): number {
    const penaltyType = config[ConfigKey.PenaltyType]?.value ?? 'Fixed';
    const penaltyValue = parseFloat(config[ConfigKey.PenaltyValue]?.value ?? '0');
    if (penaltyValue === 0) return 0;
    return penaltyType === 'Percentage'
      ? round2(dueAmount * (penaltyValue / 100))
      : penaltyValue;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx jest overdue-detection.job.spec.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/jobs/overdue-detection.job.ts \
        apps/api/src/loans/jobs/overdue-detection.job.spec.ts
git commit -m "feat(loans): add OverdueDetectionJob with daily @Cron, penalty, and guarantor offset"
```

---

## Task 12: LoansController + StaffLoansController

**Files:**
- Create: `apps/api/src/loans/loans.controller.ts`
- Create: `apps/api/src/loans/staff-loans.controller.ts`

- [ ] **Step 1: Create LoansController**

Create `apps/api/src/loans/loans.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LoansService } from './loans.service';
import { LoansImportService } from './loans.import.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ExitSettlementDto } from './dto/exit-settlement.dto';
import { LoanQueryDto } from './dto/loan-query.dto';

@Controller('loans')
export class LoansController {
  constructor(
    private readonly loansService: LoansService,
    private readonly importService: LoansImportService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateLoanDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.create(dto, user.sub, user.displayName);
  }

  @Get('bad-debt')
  getBadDebt(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.loansService.findBadDebt(page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
  }

  @Get('guarantor/:staffId')
  getByGuarantor(
    @Param('staffId') staffId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loansService.findByGuarantor(
      staffId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get()
  findAll(@Query() query: LoanQueryDto) {
    return this.loansService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.loansService.findOne(id);
  }

  @Get(':id/schedule')
  getSchedule(@Param('id') id: string) {
    return this.loansService.getRepaymentSchedule(id);
  }

  @Get(':id/document')
  getDocument(@Param('id') id: string) {
    return this.loansService.getDocumentUrl(id);
  }

  @Post(':id/document')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.uploadDocument(id, file, user.sub, user.displayName);
  }

  @Post(':id/repayments')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.recordPayment(id, dto, user.sub, user.displayName);
  }

  @Post(':id/settle-exit')
  exitSettle(
    @Param('id') id: string,
    @Body() dto: ExitSettlementDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.exitSettle(id, dto, user.sub, user.displayName);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importRepayments(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.processImport(file.buffer, user.sub, user.displayName);
  }
}
```

- [ ] **Step 2: Create StaffLoansController**

Create `apps/api/src/loans/staff-loans.controller.ts`:

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { LoansService } from './loans.service';

@Controller('staff')
export class StaffLoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get(':staffId/loans')
  getLoanHistory(
    @Param('staffId') staffId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loansService.findByStaff(
      staffId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/loans/loans.controller.ts \
        apps/api/src/loans/staff-loans.controller.ts
git commit -m "feat(loans): add LoansController and StaffLoansController"
```

---

## Task 13: LoansModule + AppModule registration

**Files:**
- Create: `apps/api/src/loans/loans.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create LoansModule**

Create `apps/api/src/loans/loans.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { LoansController } from './loans.controller';
import { StaffLoansController } from './staff-loans.controller';
import { LoansService } from './loans.service';
import { LoansImportService } from './loans.import.service';
import { OverdueDetectionJob } from './jobs/overdue-detection.job';
import { Loan, LoanSchema } from './schemas/loan.schema';
import { LoanRepayment, LoanRepaymentSchema } from './schemas/loan-repayment.schema';
import { StaffModule } from '../staff/staff.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { ContributionsModule } from '../contributions/contributions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Loan.name, schema: LoanSchema },
      { name: LoanRepayment.name, schema: LoanRepaymentSchema },
    ]),
    MulterModule.register({}),
    StaffModule,
    SystemConfigModule,
    ContributionsModule,
  ],
  controllers: [LoansController, StaffLoansController],
  providers: [LoansService, LoansImportService, OverdueDetectionJob],
  exports: [LoansService],
})
export class LoansModule {}
```

- [ ] **Step 2: Register LoansModule in AppModule**

In `apps/api/src/app.module.ts`, add to imports array (after `ContributionsModule`):

```typescript
import { LoansModule } from './loans/loans.module';
// ...
    LoansModule,
```

- [ ] **Step 3: Verify app compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors (fix any type errors before proceeding)

- [ ] **Step 4: Run all tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/loans.module.ts \
        apps/api/src/app.module.ts
git commit -m "feat(loans): wire LoansModule into AppModule"
```

---

## Self-Review Checklist

After writing all code, verify against spec before considering complete:

- [ ] POST /loans — all 6 validations present in `create`
- [ ] Repayment schedule: due date = 5th of disbursedDate.month + N (check `computeDueDate`)
- [ ] Interest rate derived from tenure (≤6 = short, >6 = long)
- [ ] Surplus carry: overpayment flows to next instalments sequentially
- [ ] Penalty applied on Overdue when `paidDate > dueDate && penaltyAmount === 0`
- [ ] Loan marked Completed when all instalments Paid/Waived
- [ ] Import: staff lookup by staffId string, falls back to active loan when Loan ID omitted
- [ ] OverdueDetectionJob: `@Cron('5 0 * * *')`, marks Pending/Partial as Overdue
- [ ] Grace period: 0 = same-month default (next month triggers offset)
- [ ] Guarantor offset: `debitGuarantorOffset` → debit contribution entry, returns `{ debited, remaining }`
- [ ] Partial offset: instalment stays Partial when guarantor balance insufficient
- [ ] Audit log on: create, recordPayment, exitSettle, overdueOffset
- [ ] Exit settlement: deduction → guarantor offset → bad debt waterfall, all fields set
- [ ] GET /loans/bad-debt before GET /loans/:id in controller (route order)
- [ ] GET /loans/guarantor/:staffId before GET /loans/:id in controller (route order)
- [ ] Document upload: bucket `loan-docs`, key `{loanId}/approval.{ext}`
- [ ] `StaffLoansController` handles GET `/staff/:staffId/loans`
- [ ] No circular dependency: `ContributionsModule` already exports `ContributionsService`
