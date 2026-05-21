# Loan UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four loan-related issues: equal-width new-loan layout, repayment table column alignment, principal/interest breakdown in schedule tables, and config-driven active-loan eligibility check.

**Architecture:** Schema changes flow from shared → API schema → API service → frontend. Backend tasks use TDD (write failing test first). Frontend tasks have no unit tests — verify visually via the app. All changes are additive; existing data shows `—` in new columns.

**Tech Stack:** NestJS (API), Mongoose (DB), Next.js 14 App Router (web), React Hook Form, TanStack Query, Jest (API tests), TypeScript throughout.

---

## File Map

| File | What changes |
|------|-------------|
| `packages/shared/src/enums/config-key.enum.ts` | Add `MaxLoansPerStaff` |
| `packages/shared/src/interfaces/loan-repayment.interface.ts` | Add `principalAmount?`, `interestAmount?` |
| `apps/api/src/loans/schemas/loan-repayment.schema.ts` | Add `principalAmount`, `interestAmount` Mongoose props |
| `apps/api/src/loans/loans.service.ts` | Populate split fields on loan creation |
| `apps/api/src/loans/loans.service.spec.ts` | Assert split fields in insertMany |
| `apps/api/src/staff/staff.service.ts` | Inject Loan model, add active-loan count to eligibility |
| `apps/api/src/staff/staff.service.spec.ts` | Add mock Loan model + two new eligibility tests |
| `apps/api/src/staff/staff.module.ts` | Register Loan schema |
| `apps/web/src/app/(dashboard)/settings/settings-client.tsx` | Add `MAX_LOANS_PER_STAFF` field to Loans section |
| `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx` | Grid layout + split columns in preview table |
| `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx` | Fix header alignment + split columns in schedule table |

---

## Task 1: Shared package — ConfigKey + ILoanRepayment

**Files:**
- Modify: `packages/shared/src/enums/config-key.enum.ts`
- Modify: `packages/shared/src/interfaces/loan-repayment.interface.ts`

- [ ] **Step 1: Add MaxLoansPerStaff to ConfigKey**

  Open `packages/shared/src/enums/config-key.enum.ts`. Add after `MaxLoansPerGuarantor`:

  ```ts
  MaxLoansPerStaff = 'MAX_LOANS_PER_STAFF',
  ```

  Full file after change:
  ```ts
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

- [ ] **Step 2: Add split fields to ILoanRepayment**

  Open `packages/shared/src/interfaces/loan-repayment.interface.ts`. Add two optional fields after `penaltyAmount`:

  ```ts
  import { LoanRepaymentStatus } from '../enums/loan-repayment-status.enum';
  import { RepaymentSource } from '../enums/repayment-source.enum';

  export interface ILoanRepayment {
    _id: string;
    loanId: string;
    staffId: string;
    instalmentNumber: number;
    dueDate: string;
    dueAmount: number;
    principalAmount?: number;
    interestAmount?: number;
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

- [ ] **Step 3: Build shared package**

  ```bash
  cd packages/shared && npm run build
  ```

  Expected: no TypeScript errors, `dist/` updated.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/shared/src/enums/config-key.enum.ts packages/shared/src/interfaces/loan-repayment.interface.ts packages/shared/dist
  git commit -m "feat(shared): add MaxLoansPerStaff config key and principal/interest fields to ILoanRepayment"
  ```

---

## Task 2: LoanRepayment Mongoose schema

**Files:**
- Modify: `apps/api/src/loans/schemas/loan-repayment.schema.ts`

- [ ] **Step 1: Add principalAmount and interestAmount props**

  Full file after change:

  ```ts
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
    @Prop({ min: 0 }) principalAmount?: number;
    @Prop({ min: 0 }) interestAmount?: number;
    @Prop({ required: true, min: 0, default: 0 }) paidAmount!: number;
    @Prop({ required: true, min: 0, default: 0 }) penaltyAmount!: number;
    @Prop({ required: true, enum: LoanRepaymentStatus, default: LoanRepaymentStatus.Pending })
    status!: LoanRepaymentStatus;
    @Prop() paidDate?: Date;
    @Prop({ enum: RepaymentSource }) source?: RepaymentSource;
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
  git commit -m "feat(api): add principalAmount and interestAmount to LoanRepayment schema"
  ```

---

## Task 3: Loan creation — populate principal/interest split

**Files:**
- Modify: `apps/api/src/loans/loans.service.spec.ts`
- Modify: `apps/api/src/loans/loans.service.ts`

**Background:** Each instalment's `dueAmount` = `monthlyInstalment`. We split this into `interestAmount = totalInterest / tenureMonths` (last instalment absorbs remainder) and `principalAmount = dueAmount - interestAmount`. For a GHS 10,000 / 3-month / 5% loan: `totalInterest = 500`, `baseInterestPerInst = 166.67`, last instalment interest = `500 - 166.67 * 2 = 166.66`.

- [ ] **Step 1: Write failing test**

  In `apps/api/src/loans/loans.service.spec.ts`, find the `'creates loan with correct totalRepayable and schedule'` test (inside `describe('create', ...)`). Replace the `insertMany` assertion with:

  ```ts
  expect(repaymentModel.insertMany).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        instalmentNumber: 1,
        dueAmount: 3500,
        principalAmount: 3333.33,
        interestAmount: 166.67,
        status: LoanRepaymentStatus.Pending,
      }),
      expect.objectContaining({ instalmentNumber: 2, principalAmount: 3333.33, interestAmount: 166.67 }),
      expect.objectContaining({ instalmentNumber: 3, principalAmount: 3333.34, interestAmount: 166.66 }),
    ]),
  );
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx jest apps/api/src/loans/loans.service.spec.ts --testNamePattern="creates loan with correct" --no-coverage
  ```

  Expected: FAIL — `principalAmount` and `interestAmount` not present in insertMany call.

- [ ] **Step 3: Update loans.service.ts create() — populate split fields**

  In `apps/api/src/loans/loans.service.ts`, find the schedule-building block (around line 207, after `const disbursedDate = ...`). Replace it with:

  ```ts
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

  this.syncLoanToMeilisearch(loan, staff.fullName);

  const loanId = loan._id.toString();
  const totalInterest = round2(totalRepayable - dto.principalAmount);
  const baseInterestPerInst = round2(totalInterest / dto.tenureMonths);

  const schedule = Array.from({ length: dto.tenureMonths }, (_, i) => {
    const isLast = i === dto.tenureMonths - 1;
    const dueAmount = isLast
      ? round2(totalRepayable - monthlyInstalment * (dto.tenureMonths - 1))
      : monthlyInstalment;
    const interestAmount = isLast
      ? round2(totalInterest - baseInterestPerInst * (dto.tenureMonths - 1))
      : baseInterestPerInst;
    const principalAmount = round2(dueAmount - interestAmount);
    return {
      loanId,
      staffId: dto.staffId,
      instalmentNumber: i + 1,
      dueDate: computeDueDate(disbursedDate, i + 1),
      dueAmount,
      principalAmount,
      interestAmount,
      paidAmount: 0,
      penaltyAmount: 0,
      status: LoanRepaymentStatus.Pending,
    };
  });
  await this.repaymentModel.insertMany(schedule);
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx jest apps/api/src/loans/loans.service.spec.ts --no-coverage
  ```

  Expected: all tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts
  git commit -m "feat(api): populate principalAmount and interestAmount on loan repayment schedule creation"
  ```

---

## Task 4: Staff eligibility — active-loan count check

**Files:**
- Modify: `apps/api/src/staff/staff.service.spec.ts`
- Modify: `apps/api/src/staff/staff.service.ts`
- Modify: `apps/api/src/staff/staff.module.ts`

**Background:** `StaffService.isLoanEligible()` currently checks employment duration only. We add a count of active loans against `MAX_LOANS_PER_STAFF` (default 1). The `Loan` schema is registered directly in `StaffModule` (same pattern as `LoansModule` registering the `Staff` schema) — no circular dependency.

- [ ] **Step 1: Write failing tests**

  In `apps/api/src/staff/staff.service.spec.ts`:

  a) Add `mockLoanModel` and the import near the top of the file:

  ```ts
  import { Loan } from '../loans/schemas/loan.schema';
  ```

  b) Add `mockLoanModel` constant alongside the other mocks:

  ```ts
  const mockLoanModel = {
    countDocuments: jest.fn(),
  };
  ```

  c) Add `mockLoanModel` to the `getAll` default config so it includes `MAX_LOANS_PER_STAFF`:

  Update `mockConfigService`:
  ```ts
  const mockConfigService = {
    getAll: jest.fn().mockResolvedValue({
      ELIGIBILITY_MONTHS: { value: '6' },
      MAX_LOANS_PER_STAFF: { value: '1' },
    }),
  };
  ```

  d) Add `{ provide: getModelToken(Loan.name), useValue: mockLoanModel }` to the providers array inside `beforeEach`:

  ```ts
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StaffService,
      { provide: getModelToken(Staff.name), useValue: mockStaffModel },
      { provide: getModelToken(Loan.name), useValue: mockLoanModel },
      { provide: AuditService, useValue: mockAuditService },
      { provide: SystemConfigService, useValue: mockConfigService },
      { provide: MEILISEARCH_CLIENT, useValue: mockMeilisearchClient },
      { provide: MINIO_CLIENT, useValue: mockMinioClient },
    ],
  }).compile();
  ```

  e) Add two new tests inside `describe('isLoanEligible', ...)`:

  ```ts
  it('returns false when staff has reached max active loans', async () => {
    mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
    mockLoanModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
    const result = await service.isLoanEligible('staff-id-1');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/active loan/i);
  });

  it('returns true when staff has fewer active loans than max', async () => {
    mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
    mockLoanModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
    const result = await service.isLoanEligible('staff-id-1');
    expect(result.eligible).toBe(true);
  });
  ```

  f) The existing `'returns true for long-serving active staff'` test also needs the loan model mock (or it will error). Update it:

  ```ts
  it('returns true for long-serving active staff', async () => {
    mockStaffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
    mockLoanModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
    const result = await service.isLoanEligible('staff-id-1');
    expect(result.eligible).toBe(true);
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npx jest apps/api/src/staff/staff.service.spec.ts --testNamePattern="isLoanEligible" --no-coverage
  ```

  Expected: FAIL — `loanModel` not injected, `countDocuments` not called.

- [ ] **Step 3: Update StaffService — inject Loan model + add active-loan check**

  In `apps/api/src/staff/staff.service.ts`:

  a) Add imports at the top:

  ```ts
  import { InjectModel } from '@nestjs/mongoose';
  import { Model } from 'mongoose';
  import { LoanStatus } from '@welfare/shared';
  import { Loan, LoanDocument } from '../loans/schemas/loan.schema';
  ```

  Note: `InjectModel` and `Model` are already used-ish by other files — make sure `InjectModel` is from `@nestjs/mongoose` and `Model` from `mongoose`.

  b) Add the `loanModel` parameter to the constructor (add after `configService`):

  ```ts
  constructor(
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly auditService: AuditService,
    private readonly configService: SystemConfigService,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    @Inject(MEILISEARCH_CLIENT) private readonly meiliClient: MeiliSearch,
  ) {}
  ```

  c) Replace `isLoanEligible` method body with:

  ```ts
  async isLoanEligible(id: string): Promise<{ eligible: boolean; reason?: string }> {
    const staff = await this.findById(id);
    if (staff.status !== StaffStatus.Active) {
      return { eligible: false, reason: 'Staff is not active' };
    }
    const config = await this.configService.getAll();
    const threshold = parseInt((config as any)['ELIGIBILITY_MONTHS']?.value ?? '6', 10);
    const employedMs = Date.now() - new Date(staff.dateOfEmployment).getTime();
    const employedMonths = employedMs / (1000 * 60 * 60 * 24 * 30.44);
    if (employedMonths < threshold) {
      return {
        eligible: false,
        reason: `Eligibility requires ${threshold} months of employment`,
      };
    }
    const maxActiveLoans = parseInt((config as any)['MAX_LOANS_PER_STAFF']?.value ?? '1', 10);
    const activeCount = await this.loanModel
      .countDocuments({ staffId: id, status: LoanStatus.Active })
      .exec();
    if (activeCount >= maxActiveLoans) {
      return { eligible: false, reason: 'Staff already has an active loan' };
    }
    return { eligible: true };
  }
  ```

- [ ] **Step 4: Update StaffModule — register Loan schema**

  Full file after change:

  ```ts
  import { Module } from '@nestjs/common';
  import { MongooseModule } from '@nestjs/mongoose';
  import { MulterModule } from '@nestjs/platform-express';
  import { StaffController } from './staff.controller';
  import { StaffService } from './staff.service';
  import { Staff, StaffSchema } from './schemas/staff.schema';
  import { Loan, LoanSchema } from '../loans/schemas/loan.schema';
  import { SystemConfigModule } from '../system-config/system-config.module';

  @Module({
    imports: [
      MongooseModule.forFeature([
        { name: Staff.name, schema: StaffSchema },
        { name: Loan.name, schema: LoanSchema },
      ]),
      MulterModule.register({}),
      SystemConfigModule,
    ],
    controllers: [StaffController],
    providers: [StaffService],
    exports: [StaffService],
  })
  export class StaffModule {}
  ```

- [ ] **Step 5: Run all staff service tests**

  ```bash
  npx jest apps/api/src/staff/staff.service.spec.ts --no-coverage
  ```

  Expected: all tests PASS including the two new eligibility tests.

- [ ] **Step 6: Run full API test suite to catch regressions**

  ```bash
  npx jest --no-coverage
  ```

  Expected: all tests PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/api/src/staff/staff.service.ts apps/api/src/staff/staff.service.spec.ts apps/api/src/staff/staff.module.ts
  git commit -m "feat(api): check active loan count in staff eligibility, add MAX_LOANS_PER_STAFF config"
  ```

---

## Task 5: Settings UI — MAX_LOANS_PER_STAFF field

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/settings-client.tsx`

No unit tests. Verify visually: Settings → Loans section should show the new "Max Active Loans per Staff" field.

- [ ] **Step 1: Add MAX_LOANS_PER_STAFF to LOAN_KEYS, LoanFields, initLoan**

  In `settings-client.tsx`:

  a) Update `LOAN_KEYS`:
  ```ts
  const LOAN_KEYS = [
    'LOAN_MIN_AMOUNT', 'LOAN_MAX_AMOUNT', 'INTEREST_RATE_SHORT',
    'INTEREST_RATE_LONG', 'ELIGIBILITY_MONTHS', 'LOAN_MAX_TENURE',
    'MAX_LOANS_PER_STAFF',
  ] as const;
  ```

  b) Update `LoanFields` type:
  ```ts
  type LoanFields = {
    LOAN_MIN_AMOUNT: string;
    LOAN_MAX_AMOUNT: string;
    INTEREST_RATE_SHORT: string;
    INTEREST_RATE_LONG: string;
    ELIGIBILITY_MONTHS: string;
    LOAN_MAX_TENURE: string;
    MAX_LOANS_PER_STAFF: string;
  };
  ```

  c) Update `initLoan`:
  ```ts
  function initLoan(cfg: ConfigMap): LoanFields {
    return {
      LOAN_MIN_AMOUNT:     cfg['LOAN_MIN_AMOUNT']?.value ?? '',
      LOAN_MAX_AMOUNT:     cfg['LOAN_MAX_AMOUNT']?.value ?? '',
      INTEREST_RATE_SHORT: cfg['INTEREST_RATE_SHORT']?.value ?? '',
      INTEREST_RATE_LONG:  cfg['INTEREST_RATE_LONG']?.value ?? '',
      ELIGIBILITY_MONTHS:  cfg['ELIGIBILITY_MONTHS']?.value ?? '',
      LOAN_MAX_TENURE:     cfg['LOAN_MAX_TENURE']?.value ?? '',
      MAX_LOANS_PER_STAFF: cfg['MAX_LOANS_PER_STAFF']?.value ?? '1',
    };
  }
  ```

  d) Add `'MAX_LOANS_PER_STAFF'` to `numericKeys` in the `save()` function:
  ```ts
  const numericKeys: (keyof LoanFields)[] = [
    'LOAN_MIN_AMOUNT', 'LOAN_MAX_AMOUNT', 'INTEREST_RATE_SHORT',
    'INTEREST_RATE_LONG', 'ELIGIBILITY_MONTHS', 'LOAN_MAX_TENURE',
    'MAX_LOANS_PER_STAFF',
  ];
  ```

- [ ] **Step 2: Add input field to LoansSection render**

  In `LoansSection`, inside the `<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">`, add after the Maximum Loan Tenure field:

  ```tsx
  <Field label="Max Active Loans per Staff" helper="Staff at this limit are ineligible for new loans. Default: 1." required>
    <Input type="number" min={1} step={1} value={fields.MAX_LOANS_PER_STAFF} onChange={set('MAX_LOANS_PER_STAFF')} disabled={saving} />
  </Field>
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit -p apps/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/app/\(dashboard\)/settings/settings-client.tsx
  git commit -m "feat(web): add MAX_LOANS_PER_STAFF setting to Loans section"
  ```

---

## Task 6: New loan form — equal-width layout + preview table split

**Files:**
- Modify: `apps/web/src/app/(dashboard)/loans/new/new-loan-client.tsx`

No unit tests. Verify visually: new loan page should show two equal-width panels; schedule preview table shows Principal and Interest columns instead of Instalment.

- [ ] **Step 1: Switch outer container to CSS grid**

  Line 159 — change:
  ```tsx
  <div className="flex gap-5 items-start">
    <div className="flex-1 min-w-0">
  ```
  To:
  ```tsx
  <div className="grid grid-cols-2 gap-6 items-start">
    <div>
  ```

  Line 272 — change:
  ```tsx
  <div className="w-80 flex-shrink-0 sticky top-4">
  ```
  To:
  ```tsx
  <div className="sticky top-4">
  ```

- [ ] **Step 2: Add principalAmt and interestAmt to schedulePreview memo**

  Find the `schedulePreview` useMemo (around line 109). Replace its body with:

  ```ts
  const schedulePreview = useMemo(() => {
    if (!watchPrincipal || !watchTenure || !watchDate) return [];
    const d = new Date(watchDate);
    if (isNaN(d.getTime())) return [];
    const totalInterest = round2(watchPrincipal * derivedRate / 100);
    const baseInterestPerInst = round2(totalInterest / watchTenure);
    let balance = totalRepayable;
    return Array.from({ length: watchTenure }, (_, i) => {
      const isLast = i === watchTenure - 1;
      const dueDate = computeDueDate(d, i + 1);
      const interestAmt = isLast
        ? round2(totalInterest - baseInterestPerInst * (watchTenure - 1))
        : baseInterestPerInst;
      const principalAmt = round2(monthlyInstalment - interestAmt);
      balance = round2(Math.max(0, balance - monthlyInstalment));
      return { n: i + 1, dueDate, instalment: monthlyInstalment, principalAmt, interestAmt, balanceAfter: balance };
    });
  }, [watchPrincipal, watchTenure, watchDate, totalRepayable, monthlyInstalment, derivedRate]);
  ```

- [ ] **Step 3: Update preview table headers and cells**

  Find the schedule preview table (around line 280). Replace header and body:

  Headers — change from `['#','Due Date','Instalment']` to:
  ```tsx
  <thead>
    <tr className="border-b border-neutral-200 bg-neutral-50">
      {([
        { label: '#',         align: 'left'  },
        { label: 'Due Date',  align: 'left'  },
        { label: 'Principal', align: 'right' },
        { label: 'Interest',  align: 'right' },
      ] as { label: string; align: 'left' | 'right' }[]).map((h) => (
        <th key={h.label} className={`px-3 py-2 text-${h.align} text-xs font-semibold text-neutral-500 uppercase tracking-wide`}>{h.label}</th>
      ))}
    </tr>
  </thead>
  ```

  Body rows — replace the single `Instalment` cell with two cells:
  ```tsx
  <tbody className="divide-y divide-neutral-100">
    {schedulePreview.map((row) => (
      <tr key={row.n} className="hover:bg-neutral-50">
        <td className="px-3 py-2 text-neutral-500">{row.n}</td>
        <td className="px-3 py-2 font-mono tabular text-xs">{fmtDate(row.dueDate)}</td>
        <td className="px-3 py-2 font-mono tabular font-medium text-right">{fmtGHS(row.principalAmt)}</td>
        <td className="px-3 py-2 font-mono tabular text-neutral-500 text-right">{fmtGHS(row.interestAmt)}</td>
      </tr>
    ))}
  </tbody>
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit -p apps/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/app/\(dashboard\)/loans/new/new-loan-client.tsx
  git commit -m "feat(web): equal-width layout and principal/interest split in schedule preview"
  ```

---

## Task 7: Loan detail page — fix column alignment + split schedule columns

**Files:**
- Modify: `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

No unit tests. Verify visually: repayment schedule table headers align with numeric cells; split columns show Principal / Interest / Paid (Int.) / Paid (Prin.) instead of Due / Paid.

- [ ] **Step 1: Define typed header config and replace header row**

  In `loan-detail-client.tsx`, find the `<thead>` of the repayment schedule table (around line 226). Replace the header block with:

  ```tsx
  <thead>
    <tr className="border-b border-neutral-200 bg-neutral-50">
      {([
        { label: '#',            align: 'left'  },
        { label: 'Due Date',    align: 'left'  },
        { label: 'Principal',   align: 'right' },
        { label: 'Interest',    align: 'right' },
        { label: 'Paid (Int.)', align: 'right' },
        { label: 'Paid (Prin.)', align: 'right' },
        { label: 'Penalty',     align: 'right' },
        { label: 'Status',      align: 'left'  },
        { label: 'Source',      align: 'left'  },
      ] as { label: string; align: 'left' | 'right' }[]).map((h) => (
        <th key={h.label} className={`px-4 py-2 text-${h.align} text-xs font-semibold text-neutral-500 uppercase tracking-wide`}>{h.label}</th>
      ))}
    </tr>
  </thead>
  ```

- [ ] **Step 2: Replace Due + Paid cells with four split cells**

  Find the `<tbody>` rows. Each row currently has a `Due` cell and a `Paid` cell. Replace those two cells with four:

  ```tsx
  <td className="px-4 py-2 text-right font-mono tabular">
    {row.principalAmount != null ? fmtGHS(row.principalAmount) : '—'}
  </td>
  <td className="px-4 py-2 text-right font-mono tabular">
    {row.interestAmount != null ? fmtGHS(row.interestAmount) : '—'}
  </td>
  <td className="px-4 py-2 text-right font-mono tabular">
    {row.interestAmount != null ? fmtGHS(Math.min(row.paidAmount, row.interestAmount)) : '—'}
  </td>
  <td className="px-4 py-2 text-right font-mono tabular">
    {row.interestAmount != null ? fmtGHS(Math.max(0, row.paidAmount - row.interestAmount)) : '—'}
  </td>
  ```

  The cells for `Penalty`, `Status`, and `Source` stay unchanged. The row should now read:
  `# | Due Date | Principal | Interest | Paid (Int.) | Paid (Prin.) | Penalty | Status | Source`

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit -p apps/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/app/\(dashboard\)/loans/\[id\]/loan-detail-client.tsx
  git commit -m "feat(web): fix repayment schedule column alignment and add principal/interest split columns"
  ```

---

## Self-Review Checklist (do not execute — for reference)

- [x] Spec §1 (layout): Task 6 step 1 — grid cols-2, sticky preview
- [x] Spec §2 (alignment): Task 7 step 1 — typed header array with per-column align
- [x] Spec §3a (schema): Task 2 — `@Prop` fields added
- [x] Spec §3b (interface): Task 1 step 2 — `ILoanRepayment` updated
- [x] Spec §3c (creation): Task 3 — split computed and stored
- [x] Spec §3d (preview table): Task 6 steps 2–3 — memo + table updated
- [x] Spec §3e (detail table): Task 7 step 2 — four split cells
- [x] Spec §4a (ConfigKey): Task 1 step 1 — `MaxLoansPerStaff` added
- [x] Spec §4b (eligibility): Task 4 step 3 — `countDocuments` + threshold check
- [x] Spec §4c (settings UI): Task 5 — field rendered in Loans section
- [x] Spec §4d (badge): No change needed — existing badge already shows `eligibility.reason`
- [x] Type consistency: `principalAmount`/`interestAmount` named identically across schema, interface, service, and frontend
- [x] No placeholders
