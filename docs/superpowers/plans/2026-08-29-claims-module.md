# Claims Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claims module (Marriage/Birth/Funeral/Cessation welfare claims) with legacy bulk import and a manual-create-with-approval flow, deducted from each staff member's contribution balance at report time, and surfaced in the contribution statement and fund summary reports.

**Architecture:** Mirrors the existing `contributions` module end-to-end — same schema conventions (Mongo `_id` as staff FK), same `ImportBatch`/flagged-entry bulk-import pattern, same permission-gated NestJS controller/service split, same React Query + TanStack Table frontend structure, and the same Puppeteer-HTML-template report rendering. A derived `availableBalance` (total paid contributions − sum of `Approved` claims) gates both claim creation and approval.

**Tech Stack:** NestJS + Mongoose (API), Next.js 14 App Router + React Query + TanStack Table + react-hook-form/zod (web), shared TypeScript types in `packages/shared`, `xlsx` for import parsing, Puppeteer for PDF.

**Spec:** `docs/superpowers/specs/2026-08-29-claims-module-design.md`

## Global Constraints

- Balance formula: `availableBalance(staffId) = totalPaidContributions(staffId) − sum(amount of Approved claims for staffId)`. Only `Approved` claims ever affect balance or report totals.
- Legacy bulk-uploaded claims land as `status: Approved, source: LegacyImport` immediately — no approval gate on historical data.
- Manually created claims land as `status: Pending, source: ManualEntry` and require an explicit approve/reject action (permission `AppModule.Claims = 'full'`) before they count.
- Hard-block (`BadRequestException`) if `amount > availableBalance` — checked both at manual creation and again at approval time (balance may have drifted). Import never hard-blocks; it soft-flags over-balance rows for visibility only.
- Upload columns: `Staff ID`, `Full Name` (informational only, not validated/stored — `staff.fullName` is always canonical), `Claim Type`, `Month`, `Year`, `Amount`, optional `Sub Reason` (required only when `Claim Type` = Cessation).
- All new routes gated via `@RequirePermission(AppModule.Claims, 'readonly' | 'full')`, following the exact decorator/guard pattern already used by `AppModule.Contributions`.

---

## Task 1: Shared package — enums, permissions, interfaces, DTOs

**Files:**
- Create: `packages/shared/src/enums/claim-type.enum.ts`
- Create: `packages/shared/src/enums/cessation-reason.enum.ts`
- Create: `packages/shared/src/enums/claim-status.enum.ts`
- Create: `packages/shared/src/enums/claim-source.enum.ts`
- Modify: `packages/shared/src/enums/app-module.enum.ts`
- Modify: `packages/shared/src/enums/audit-action.enum.ts`
- Modify: `packages/shared/src/enums/audit-entity.enum.ts`
- Modify: `packages/shared/src/constants/permissions.constants.ts`
- Create: `packages/shared/src/interfaces/claim.interface.ts`
- Create: `packages/shared/src/interfaces/claim-import-batch.interface.ts`
- Modify: `packages/shared/src/interfaces/report.interface.ts`
- Create: `packages/shared/src/dto/claim.dto.ts`
- Create: `packages/shared/src/dto/claim-import-batch.dto.ts`
- Modify: `packages/shared/src/index.ts`
- Test: none (type-only package) — verified by the shared package's build step in Step 2 below

**Interfaces:**
- Produces: `ClaimType`, `CessationReason`, `ClaimStatus`, `ClaimSource` enums; `AppModule.Claims`; `IClaim`, `IClaimFlaggedEntry`, `IClaimImportBatch`, `CreateClaimDto`, `ClaimResponseDto`, `IFundSummaryClaimsBreakdownRow`; `IFundSummaryReport.claims` field; `IClaimYearRow` (statement claims-by-year shape). All later tasks (API schemas, DTOs, frontend) import these by exact name.

- [ ] **Step 1: Create the four new enums**

`packages/shared/src/enums/claim-type.enum.ts`:
```typescript
export enum ClaimType {
  Marriage = 'Marriage',
  Birth = 'Birth',
  Funeral = 'Funeral',
  Cessation = 'Cessation',
}
```

`packages/shared/src/enums/cessation-reason.enum.ts`:
```typescript
export enum CessationReason {
  Resignation = 'Resignation',
  Termination = 'Termination',
  Death = 'Death',
}
```

`packages/shared/src/enums/claim-status.enum.ts`:
```typescript
export enum ClaimStatus {
  Pending = 'Pending',
  Approved = 'Approved',
  Rejected = 'Rejected',
}
```

`packages/shared/src/enums/claim-source.enum.ts`:
```typescript
export enum ClaimSource {
  LegacyImport = 'LegacyImport',
  ManualEntry = 'ManualEntry',
}
```

- [ ] **Step 2: Add `Claims` to `AppModule` and wire `PERMISSIONS`**

Edit `packages/shared/src/enums/app-module.enum.ts` — add one line:
```typescript
export enum AppModule {
  Contributions  = 'contributions',
  Claims         = 'claims',
  Staff          = 'staff',
  Loans          = 'loans',
  Remittances    = 'remittances',
  Investments    = 'investments',
  Reports        = 'reports',
  Settings       = 'settings',
  AuditLog       = 'audit_log',
  EmailLog       = 'email_log',
  UserManagement = 'user_management',
}
```

Edit `packages/shared/src/constants/permissions.constants.ts` — add `[AppModule.Claims]` to each of the four role blocks (same tier as `Contributions` in every role):
```typescript
export const PERMISSIONS: PermissionMatrix = {
  [UserRole.WelfareOfficer]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Claims]:         'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Remittances]:    'full',
    [AppModule.Investments]:    'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'none',
    [AppModule.AuditLog]:       'none',
    [AppModule.EmailLog]:       'none',
    [AppModule.UserManagement]: 'none',
  },
  [UserRole.WelfareManager]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Claims]:         'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Remittances]:    'full',
    [AppModule.Investments]:    'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'full',
    [AppModule.EmailLog]:       'full',
    [AppModule.UserManagement]: 'full',
  },
  [UserRole.WelfareDirector]: {
    [AppModule.Contributions]:  'readonly',
    [AppModule.Claims]:         'readonly',
    [AppModule.Staff]:          'readonly',
    [AppModule.Loans]:          'readonly',
    [AppModule.Remittances]:    'readonly',
    [AppModule.Investments]:    'readonly',
    [AppModule.Reports]:        'readonly',
    [AppModule.Settings]:       'none',
    [AppModule.AuditLog]:       'readonly',
    [AppModule.EmailLog]:       'readonly',
    [AppModule.UserManagement]: 'none',
  },
  [UserRole.Admin]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Claims]:         'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Remittances]:    'full',
    [AppModule.Investments]:    'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'full',
    [AppModule.EmailLog]:       'full',
    [AppModule.UserManagement]: 'full',
  },
};
```

- [ ] **Step 3: Add `Claim` audit entity and `Approve`/`Reject` are already covered — add `Reject` action**

Edit `packages/shared/src/enums/audit-entity.enum.ts`:
```typescript
export enum AuditEntity {
  Staff = 'Staff',
  Contribution = 'Contribution',
  Claim = 'Claim',
  ClaimImportBatch = 'ClaimImportBatch',
  Loan = 'Loan',
  LoanRepayment = 'LoanRepayment',
  ImportBatch = 'ImportBatch',
  Config = 'Config',
  EmailLog = 'EmailLog',
  User = 'User',
}
```

Edit `packages/shared/src/enums/audit-action.enum.ts` — `Approve` already exists; add `Reject`:
```typescript
export enum AuditAction {
  Create = 'Create',
  Update = 'Update',
  Delete = 'Delete',
  Import = 'Import',
  Approve = 'Approve',
  Reject = 'Reject',
  Disburse = 'Disburse',
  Settle = 'Settle',
  WriteOff = 'WriteOff',
  RecordPayment = 'RecordPayment',
  GenerateStatement = 'GenerateStatement',
  Login = 'Login',
  Logout = 'Logout',
  ConfigChange = 'ConfigChange',
}
```

- [ ] **Step 4: Create claim interfaces**

`packages/shared/src/interfaces/claim.interface.ts`:
```typescript
import { ClaimType } from '../enums/claim-type.enum';
import { CessationReason } from '../enums/cessation-reason.enum';
import { ClaimStatus } from '../enums/claim-status.enum';
import { ClaimSource } from '../enums/claim-source.enum';

export interface IClaim {
  _id: string;
  staffId: string;
  claimType: ClaimType;
  subReason?: CessationReason;
  month: number;
  year: number;
  amount: number;
  status: ClaimStatus;
  source: ClaimSource;
  importBatchId?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  recordedBy: string;
  createdAt: string;
}
```

`packages/shared/src/interfaces/claim-import-batch.interface.ts`:
```typescript
import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface IClaimFlaggedEntry {
  staffId: string;
  employeeName: string;
  amount: number;
  reason: string;
  // Carried so a resolved entry (staff mapped, or "exceeds balance" reviewed) can be
  // recreated as a real Claim — unlike contributions' FlaggedEntry, a Claim needs more
  // than staffId+month+year+amount to exist. Absent when the row failed validation
  // before these could be parsed (e.g. an invalid Claim Type) — such rows are fixed in
  // the source file and re-uploaded rather than resolved in place.
  claimType?: string;
  month?: number;
  year?: number;
  subReason?: string;
}

export interface IClaimImportBatch {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: IClaimFlaggedEntry[];
  status: ImportBatchStatus;
  createdAt: string;
}
```

- [ ] **Step 5: Add claims fields to `report.interface.ts`**

Edit `packages/shared/src/interfaces/report.interface.ts` — add near the fund-summary interfaces and extend `IFundSummaryReport`:
```typescript
export interface IFundSummaryClaimsBreakdownRow {
  claimType: string;
  count: number;
  totalAmount: number;
}

export interface IFundSummaryClaims {
  totalAmount: number;
  count: number;
  byType: Record<string, number>;
}
```
Then extend the existing `IFundSummaryReport` interface (add one field to the existing declaration):
```typescript
export interface IFundSummaryReport {
  period: { year: number; fromMonth: number; toMonth: number };
  contributions: IFundSummaryContributions;
  loans: IFundSummaryLoans;
  recovery: IFundSummaryRecovery;
  fundBalance: IFundSummaryBalance;
  membership: IFundSummaryMembership;
  contributionBreakdown: IFundSummaryContributionBreakdownRow[];
  loanBreakdown: IFundSummaryLoanBreakdownRow[];
  defaultDetails: IFundSummaryDefaultRow[];
  totalDiscountsGiven: number;
  discountBreakdown: IFundSummaryDiscountRow[];
  claims: IFundSummaryClaims;
  claimsBreakdown: IFundSummaryClaimsBreakdownRow[];
}
```

- [ ] **Step 6: Create claim DTOs**

`packages/shared/src/dto/claim.dto.ts`:
```typescript
import { ClaimType } from '../enums/claim-type.enum';
import { CessationReason } from '../enums/cessation-reason.enum';
import { ClaimStatus } from '../enums/claim-status.enum';
import { ClaimSource } from '../enums/claim-source.enum';

export interface CreateClaimDto {
  staffId: string;
  claimType: ClaimType;
  subReason?: CessationReason;
  month: number;
  year: number;
  amount: number;
}

export interface ClaimResponseDto {
  _id: string;
  staffId: string;
  claimType: ClaimType;
  subReason?: CessationReason;
  month: number;
  year: number;
  amount: number;
  status: ClaimStatus;
  source: ClaimSource;
  importBatchId?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  recordedBy: string;
  createdAt: string;
}
```

`packages/shared/src/dto/claim-import-batch.dto.ts`:
```typescript
import { ImportBatchStatus } from '../enums/import-batch-status.enum';

export interface ClaimFlaggedEntryDto {
  staffId: string;
  employeeName: string;
  amount: number;
  reason: string;
  claimType?: string;
  month?: number;
  year?: number;
  subReason?: string;
}

export interface ClaimImportBatchResponseDto {
  _id: string;
  fileName: string;
  uploadedBy: string;
  totalRows: number;
  matchedRows: number;
  flaggedRows: number;
  flaggedEntries: ClaimFlaggedEntryDto[];
  status: ImportBatchStatus;
  createdAt: string;
}
```

- [ ] **Step 7: Export everything from `packages/shared/src/index.ts`**

Add these lines (grouped with the existing enum/interface/DTO export blocks):
```typescript
export { ClaimType } from './enums/claim-type.enum';
export { CessationReason } from './enums/cessation-reason.enum';
export { ClaimStatus } from './enums/claim-status.enum';
export { ClaimSource } from './enums/claim-source.enum';

export type { IClaim } from './interfaces/claim.interface';
export type { IClaimFlaggedEntry, IClaimImportBatch } from './interfaces/claim-import-batch.interface';

export type { CreateClaimDto, ClaimResponseDto } from './dto/claim.dto';
export type { ClaimFlaggedEntryDto, ClaimImportBatchResponseDto } from './dto/claim-import-batch.dto';
```
Also add `IFundSummaryClaims` and `IFundSummaryClaimsBreakdownRow` to the existing `export type { ... } from './interfaces/report.interface'` block (append them to that list).

- [ ] **Step 8: Build the shared package to verify no type errors**

Run: `npm run build -w @welfare/shared`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add Claims enums, interfaces, DTOs, and permissions"
```

---

## Task 2: Claim & ClaimImportBatch Mongoose schemas

**Files:**
- Create: `apps/api/src/claims/schemas/claim.schema.ts`
- Create: `apps/api/src/claims/schemas/claim-import-batch.schema.ts`
- Test: `apps/api/src/claims/schemas/claim.schema.spec.ts`

**Interfaces:**
- Consumes: `ClaimType`, `CessationReason`, `ClaimStatus`, `ClaimSource` from `@welfare/shared` (Task 1).
- Produces: `Claim`, `ClaimDocument`, `ClaimSchema`; `ClaimImportBatch`, `ClaimImportBatchDocument`, `ClaimImportBatchSchema` — consumed by Tasks 3, 4, 6, 9.

- [ ] **Step 1: Write the schema files**

`apps/api/src/claims/schemas/claim.schema.ts`:
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ClaimType, CessationReason, ClaimStatus, ClaimSource } from '@welfare/shared';

export type ClaimDocument = HydratedDocument<Claim>;

@Schema({ timestamps: true, collection: 'claims' })
export class Claim {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true, enum: ClaimType }) claimType!: ClaimType;
  @Prop({ enum: CessationReason }) subReason?: CessationReason;
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0 }) amount!: number;
  @Prop({ required: true, enum: ClaimStatus, default: ClaimStatus.Pending })
  status!: ClaimStatus;
  @Prop({ required: true, enum: ClaimSource }) source!: ClaimSource;
  @Prop() importBatchId?: string;
  @Prop() approvedBy?: string;
  @Prop() approvedAt?: Date;
  @Prop() rejectedReason?: string;
  @Prop({ required: true }) recordedBy!: string;
}

export const ClaimSchema = SchemaFactory.createForClass(Claim);

ClaimSchema.index({ staffId: 1 });
ClaimSchema.index({ status: 1 });
ClaimSchema.index({ year: 1, claimType: 1 });
```

`apps/api/src/claims/schemas/claim-import-batch.schema.ts`:
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type ClaimImportBatchDocument = HydratedDocument<ClaimImportBatch>;

@Schema({ _id: false })
class ClaimFlaggedEntry {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) employeeName!: string;
  @Prop({ required: true }) amount!: number;
  @Prop({ required: true }) reason!: string;
  // Carried so a resolved entry can be recreated as a real Claim (unlike contributions'
  // FlaggedEntry, a Claim needs claimType/month/year/subReason beyond staffId+amount).
  @Prop() claimType?: string;
  @Prop() month?: number;
  @Prop() year?: number;
  @Prop() subReason?: string;
}

@Schema({ timestamps: true, collection: 'claim_import_batches' })
export class ClaimImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, min: 0 }) totalRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) matchedRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) flaggedRows!: number;
  @Prop({ type: [ClaimFlaggedEntry], default: [] }) flaggedEntries!: ClaimFlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const ClaimImportBatchSchema = SchemaFactory.createForClass(ClaimImportBatch);
ClaimImportBatchSchema.index({ status: 1 });
```

- [ ] **Step 2: Write a schema smoke test**

`apps/api/src/claims/schemas/claim.schema.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, connect, Model } from 'mongoose';
import { Claim, ClaimSchema, ClaimDocument } from './claim.schema';
import { ClaimType, ClaimStatus, ClaimSource } from '@welfare/shared';

describe('Claim schema', () => {
  let mongod: MongoMemoryServer;
  let mongoConnection: Connection;
  let claimModel: Model<ClaimDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoConnection = (await connect(mongod.getUri())).connection;
    claimModel = mongoConnection.model(Claim.name, ClaimSchema);
  });

  afterAll(async () => {
    await mongoConnection.close();
    await mongod.stop();
  });

  it('defaults status to Pending and rejects negative amount', async () => {
    const doc = await claimModel.create({
      staffId: 'staff-1',
      claimType: ClaimType.Marriage,
      month: 1,
      year: 2026,
      amount: 500,
      source: ClaimSource.ManualEntry,
      recordedBy: 'tester',
    });
    expect(doc.status).toBe(ClaimStatus.Pending);

    await expect(
      claimModel.create({
        staffId: 'staff-1',
        claimType: ClaimType.Marriage,
        month: 1,
        year: 2026,
        amount: -1,
        source: ClaimSource.ManualEntry,
        recordedBy: 'tester',
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm run test -w @welfare/api -- claim.schema.spec.ts`
Expected: PASS (2 assertions). If `mongodb-memory-server` isn't already a devDependency of `apps/api`, run `npm install -D mongodb-memory-server -w @welfare/api` first — check `apps/api/package.json` for an existing similar schema-level spec to confirm the convention before adding a new dependency.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/claims/schemas
git commit -m "feat(api): add Claim and ClaimImportBatch schemas"
```

---

## Task 3: ClaimsService — balance calculation, create/approve/reject/list

**Files:**
- Create: `apps/api/src/claims/claims.service.ts`
- Test: `apps/api/src/claims/claims.service.spec.ts`

**Interfaces:**
- Consumes: `Contribution`, `ContributionDocument` from `../contributions/schemas/contribution.schema`; `Claim`, `ClaimDocument` from Task 2; `AuditService.log(...)` from `../audit/audit.service`.
- Produces (consumed by Task 6 controller, Tasks 7–8 reports):
  - `getStaffBalance(staffId: string): Promise<number>`
  - `createClaim(dto: CreateClaimDto, actorId: string, actorName: string): Promise<ClaimDocument>`
  - `approveClaim(id: string, actorId: string, actorName: string): Promise<ClaimDocument>`
  - `rejectClaim(id: string, reason: string, actorId: string, actorName: string): Promise<ClaimDocument>`
  - `listClaims(query: ClaimQueryDto): Promise<PaginatedResult<any>>`
  - `findByStaff(staffId: string): Promise<ClaimDocument[]>`
  - `deleteClaim(id: string, actorId: string, actorName: string): Promise<void>`

- [ ] **Step 1: Write the failing test for balance + create + approve**

`apps/api/src/claims/claims.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClaimStatus, ClaimSource, ClaimType } from '@welfare/shared';
import { ClaimsService } from './claims.service';
import { Claim } from './schemas/claim.schema';
import { Contribution } from '../contributions/schemas/contribution.schema';
import { AuditService } from '../audit/audit.service';

const mockClaimModel = {
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
};
const mockContribModel = { aggregate: jest.fn() };
const mockAuditService = { log: jest.fn() };

describe('ClaimsService', () => {
  let service: ClaimsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        { provide: getModelToken(Claim.name), useValue: mockClaimModel },
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(ClaimsService);
    jest.clearAllMocks();
  });

  function mockBalance(paid: number, approvedClaims: number) {
    mockContribModel.aggregate.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: paid }]) });
    mockClaimModel.aggregate.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ total: approvedClaims }]) });
  }

  it('getStaffBalance returns paid contributions minus approved claims', async () => {
    mockBalance(1000, 300);
    const balance = await service.getStaffBalance('staff-1');
    expect(balance).toBe(700);
  });

  it('createClaim hard-blocks when amount exceeds available balance', async () => {
    mockBalance(1000, 300); // balance = 700
    await expect(
      service.createClaim(
        { staffId: 'staff-1', claimType: ClaimType.Marriage, month: 1, year: 2026, amount: 800 },
        'actor-1', 'Actor',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockClaimModel.create).not.toHaveBeenCalled();
  });

  it('createClaim saves as Pending/ManualEntry when within balance', async () => {
    mockBalance(1000, 300); // balance = 700
    mockClaimModel.create.mockResolvedValue({ _id: 'claim-1', toObject: () => ({}) });
    const result = await service.createClaim(
      { staffId: 'staff-1', claimType: ClaimType.Marriage, month: 1, year: 2026, amount: 500 },
      'actor-1', 'Actor',
    );
    expect(mockClaimModel.create).toHaveBeenCalledWith(expect.objectContaining({
      status: ClaimStatus.Pending,
      source: ClaimSource.ManualEntry,
      amount: 500,
    }));
    expect(result._id).toBe('claim-1');
  });

  it('approveClaim re-checks balance and blocks if now insufficient', async () => {
    const pendingClaim = { _id: 'claim-1', staffId: 'staff-1', amount: 500, status: ClaimStatus.Pending, toObject: () => ({}) };
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(pendingClaim) });
    mockBalance(1000, 900); // balance now only 100, less than claim's 500

    await expect(service.approveClaim('claim-1', 'actor-1', 'Actor')).rejects.toThrow(BadRequestException);
  });

  it('approveClaim sets status Approved with approvedBy/approvedAt when balance sufficient', async () => {
    const pendingClaim: any = { _id: 'claim-1', staffId: 'staff-1', amount: 500, status: ClaimStatus.Pending, save: jest.fn().mockResolvedValue(undefined), toObject: () => ({}) };
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(pendingClaim) });
    mockBalance(1000, 0); // balance 1000, sufficient

    const result = await service.approveClaim('claim-1', 'actor-1', 'Actor');

    expect(result.status).toBe(ClaimStatus.Approved);
    expect(result.approvedBy).toBe('Actor');
    expect(pendingClaim.save).toHaveBeenCalled();
  });

  it('rejectClaim sets status Rejected with the given reason', async () => {
    const pendingClaim: any = { _id: 'claim-1', status: ClaimStatus.Pending, save: jest.fn().mockResolvedValue(undefined), toObject: () => ({}) };
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(pendingClaim) });

    const result = await service.rejectClaim('claim-1', 'Not eligible', 'actor-1', 'Actor');

    expect(result.status).toBe(ClaimStatus.Rejected);
    expect(result.rejectedReason).toBe('Not eligible');
  });

  it('rejectClaim throws NotFoundException when claim is missing', async () => {
    mockClaimModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.rejectClaim('missing', 'reason', 'actor-1', 'Actor')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @welfare/api -- claims.service.spec.ts`
Expected: FAIL — `Cannot find module './claims.service'`.

- [ ] **Step 3: Implement `ClaimsService`**

`apps/api/src/claims/claims.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity, ClaimSource, ClaimStatus, CreateClaimDto, PaginatedResult } from '@welfare/shared';
import { Claim, ClaimDocument } from './schemas/claim.schema';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { AuditService } from '../audit/audit.service';
import { ClaimQueryDto } from './dto/claim-query.dto';

@Injectable()
export class ClaimsService {
  constructor(
    @InjectModel(Claim.name) private readonly claimModel: Model<ClaimDocument>,
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    private readonly auditService: AuditService,
  ) {}

  async getStaffBalance(staffId: string): Promise<number> {
    const [contribResult, claimResult] = await Promise.all([
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
      this.claimModel
        .aggregate([
          { $match: { staffId, status: ClaimStatus.Approved } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .exec(),
    ]);
    const totalPaid = (contribResult as { total: number }[])[0]?.total ?? 0;
    const totalApprovedClaims = (claimResult as { total: number }[])[0]?.total ?? 0;
    return totalPaid - totalApprovedClaims;
  }

  async createClaim(dto: CreateClaimDto, actorId: string, actorName: string): Promise<ClaimDocument> {
    const balance = await this.getStaffBalance(dto.staffId);
    if (dto.amount > balance) {
      throw new BadRequestException(`Claim amount exceeds available balance of GHS ${balance.toFixed(2)}`);
    }
    const claim = await this.claimModel.create({
      ...dto,
      status: ClaimStatus.Pending,
      source: ClaimSource.ManualEntry,
      recordedBy: actorName,
    });
    this.auditService.log(
      actorId, actorName, AuditAction.Create, AuditEntity.Claim,
      claim._id.toString(), undefined, claim.toObject() as unknown as Record<string, unknown>,
    );
    return claim;
  }

  async approveClaim(id: string, actorId: string, actorName: string): Promise<ClaimDocument> {
    const claim = await this.findById(id);
    const balance = await this.getStaffBalance(claim.staffId);
    if (claim.amount > balance) {
      throw new BadRequestException(`Cannot approve — claim amount exceeds current available balance of GHS ${balance.toFixed(2)}`);
    }
    const before = claim.toObject() as unknown as Record<string, unknown>;
    claim.status = ClaimStatus.Approved;
    claim.approvedBy = actorName;
    claim.approvedAt = new Date();
    await claim.save();
    this.auditService.log(
      actorId, actorName, AuditAction.Approve, AuditEntity.Claim,
      id, before, claim.toObject() as unknown as Record<string, unknown>,
    );
    return claim;
  }

  async rejectClaim(id: string, reason: string, actorId: string, actorName: string): Promise<ClaimDocument> {
    const claim = await this.findById(id);
    const before = claim.toObject() as unknown as Record<string, unknown>;
    claim.status = ClaimStatus.Rejected;
    claim.rejectedReason = reason;
    await claim.save();
    this.auditService.log(
      actorId, actorName, AuditAction.Reject, AuditEntity.Claim,
      id, before, claim.toObject() as unknown as Record<string, unknown>,
    );
    return claim;
  }

  async findById(id: string): Promise<ClaimDocument> {
    const claim = await this.claimModel.findById(id).exec();
    if (!claim) throw new NotFoundException(`Claim ${id} not found`);
    return claim;
  }

  async findByStaff(staffId: string): Promise<ClaimDocument[]> {
    return this.claimModel.find({ staffId }).sort({ year: -1, month: -1 }).exec();
  }

  async listClaims(query: ClaimQueryDto): Promise<PaginatedResult<ClaimDocument>> {
    const { page = 1, limit = 20, staffId, claimType, status, year } = query;
    const filter: Record<string, unknown> = {};
    if (staffId) filter.staffId = staffId;
    if (claimType) filter.claimType = claimType;
    if (status) filter.status = status;
    if (year) filter.year = year;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.claimModel.find(filter).sort({ year: -1, month: -1 }).skip(skip).limit(limit).exec(),
      this.claimModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async deleteClaim(id: string, actorId: string, actorName: string): Promise<void> {
    const claim = await this.findById(id);
    await this.claimModel.findByIdAndDelete(id).exec();
    this.auditService.log(
      actorId, actorName, AuditAction.Delete, AuditEntity.Claim,
      id, claim.toObject() as unknown as Record<string, unknown>, undefined,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @welfare/api -- claims.service.spec.ts`
Expected: PASS (7 tests). `ClaimQueryDto` doesn't exist yet — it's created in Task 5; for this task's test run, temporarily this will fail to compile. Create a minimal placeholder now (fleshed out fully in Task 5) so this task's tests can run standalone:

`apps/api/src/claims/dto/claim-query.dto.ts` (minimal version — Task 5 replaces this with the full class-validator version):
```typescript
import { ClaimType, ClaimStatus } from '@welfare/shared';

export class ClaimQueryDto {
  staffId?: string;
  claimType?: ClaimType;
  status?: ClaimStatus;
  year?: number;
  page?: number;
  limit?: number;
}
```

Re-run: `npm run test -w @welfare/api -- claims.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/claims/claims.service.ts apps/api/src/claims/claims.service.spec.ts apps/api/src/claims/dto/claim-query.dto.ts
git commit -m "feat(api): add ClaimsService with balance calc, approve/reject workflow"
```

---

## Task 4: Claims import service (legacy bulk upload)

**Files:**
- Create: `apps/api/src/claims/import.service.ts`
- Test: `apps/api/src/claims/import.service.spec.ts`

**Interfaces:**
- Consumes: `ClaimImportBatch`, `ClaimImportBatchDocument` (Task 2); `ClaimsService.getStaffBalance` (Task 3, used only for the soft over-balance flag, never to block); `StaffService.findByStaffId` (existing); `ImportProgressService` (existing, `@Global()`); `AuditService.log` (existing).
- Produces: `ImportService.processImport(buffer, fileName, actorId, actorName, jobId?): Promise<{ batchId, matched, flagged, total }>`, plus `getBatch`, `listBatches`, `resolveFlagged`, `resolveByStaffId`, `dismissFlaggedEntry`, `clearFlaggedEntries` — consumed by Task 6 controller.

- [ ] **Step 1: Write the failing test**

`apps/api/src/claims/import.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ImportBatchStatus, ClaimStatus, ClaimSource, ClaimType } from '@welfare/shared';
import { ImportService } from './import.service';
import { ClaimImportBatch } from './schemas/claim-import-batch.schema';
import { Claim } from './schemas/claim.schema';
import { ClaimsService } from './claims.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: jest.fn(), findById: jest.fn() };
const mockClaimModel = { create: jest.fn() };
const mockClaimsService = { getStaffBalance: jest.fn().mockResolvedValue(100000) };
const mockStaffService = { findByStaffId: jest.fn() };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('ImportService (claims)', () => {
  let service: ImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: getModelToken(ClaimImportBatch.name), useValue: mockBatchModel },
        { provide: getModelToken(Claim.name), useValue: mockClaimModel },
        { provide: ClaimsService, useValue: mockClaimsService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(ImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockClaimsService.getStaffBalance.mockResolvedValue(100000);
  });

  function excelBuffer(rows: Record<string, unknown>[]): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('matches a valid row and saves it as Approved/LegacyImport', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Marriage', Month: 3, Year: 2024, Amount: 500 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result).toEqual({ batchId: 'batch-1', matched: 1, flagged: 0, total: 1 });
    expect(mockClaimModel.create).toHaveBeenCalledWith(expect.objectContaining({
      staffId: 'staff-mongo-1',
      claimType: ClaimType.Marriage,
      month: 3,
      year: 2024,
      amount: 500,
      status: ClaimStatus.Approved,
      source: ClaimSource.LegacyImport,
      importBatchId: 'batch-1',
    }));
  });

  it('flags a row with an unknown Staff ID and does not create a claim', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-2' } });
    mockStaffService.findByStaffId.mockResolvedValue(null);

    const buffer = excelBuffer([
      { 'Staff ID': 'UNKNOWN', 'Full Name': 'Ghost', 'Claim Type': 'Funeral', Month: 1, Year: 2024, Amount: 200 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(0);
    expect(result.flagged).toBe(1);
    expect(mockClaimModel.create).not.toHaveBeenCalled();
  });

  it('flags a Cessation row missing Sub Reason', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-3' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Cessation', Month: 1, Year: 2024, Amount: 900 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(0);
    expect(result.flagged).toBe(1);
    expect(mockClaimModel.create).not.toHaveBeenCalled();
  });

  it('imports a Cessation row when Sub Reason is provided', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-4' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Cessation', Month: 1, Year: 2024, Amount: 900, 'Sub Reason': 'Resignation' },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(1);
    expect(mockClaimModel.create).toHaveBeenCalledWith(expect.objectContaining({ subReason: 'Resignation' }));
  });

  it('imports a row that exceeds balance but flags it as a soft warning (does not block)', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-5' } });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-mongo-1' } });
    mockClaimsService.getStaffBalance.mockResolvedValue(100); // balance less than claim amount

    const buffer = excelBuffer([
      { 'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Claim Type': 'Marriage', Month: 1, Year: 2024, Amount: 500 },
    ]);
    const result = await service.processImport(buffer, 'test.xlsx', 'actor-1', 'Actor');

    expect(result.matched).toBe(1); // still imported
    expect(result.flagged).toBe(1); // and flagged
    expect(mockClaimModel.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @welfare/api -- claims/import.service.spec.ts`
Expected: FAIL — `Cannot find module './import.service'`.

- [ ] **Step 3: Implement the import service**

The `ClaimFlaggedEntry` schema (Task 2) already carries `claimType`/`month`/`year`/`subReason` alongside `staffId`/`employeeName`/`amount`/`reason` — every flagged row below fills in whichever of those it managed to parse before failing, so `resolveOneEntry` can recreate a full claim later without re-parsing the original file.

`apps/api/src/claims/import.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  AuditAction, AuditEntity, ClaimSource, ClaimStatus, ClaimType, CessationReason, ImportBatchStatus, PaginatedResult,
} from '@welfare/shared';
import { ClaimImportBatch, ClaimImportBatchDocument } from './schemas/claim-import-batch.schema';
import { Claim, ClaimDocument } from './schemas/claim.schema';
import { ClaimsService } from './claims.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

interface ExcelRow {
  'Staff ID'?: string;
  'Full Name'?: string;
  'Claim Type'?: string;
  Month?: number;
  Year?: number;
  Amount?: number;
  'Sub Reason'?: string;
}

const VALID_CLAIM_TYPES = new Set(Object.values(ClaimType));
const VALID_SUB_REASONS = new Set(Object.values(CessationReason));

@Injectable()
export class ImportService {
  constructor(
    @InjectModel(ClaimImportBatch.name) private readonly batchModel: Model<ClaimImportBatchDocument>,
    @InjectModel(Claim.name) private readonly claimModel: Model<ClaimDocument>,
    private readonly claimsService: ClaimsService,
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
  ): Promise<{ batchId: string; matched: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    let matched = 0;
    const flaggedEntries: { staffId: string; employeeName: string; amount: number; reason: string }[] = [];

    this.progressService.start(batchId, rows.length);
    try {
      for (const row of rows) {
        this.progressService.increment(batchId);

        const rawStaffId = String(row['Staff ID'] ?? '').trim();
        const employeeName = String(row['Full Name'] ?? '').trim();
        const claimTypeRaw = String(row['Claim Type'] ?? '').trim();
        const amount = Number(row.Amount ?? 0);
        const month = Number(row.Month);
        const year = Number(row.Year);
        const subReasonRaw = String(row['Sub Reason'] ?? '').trim();

        if (!rawStaffId) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Missing Staff ID', claimType: claimTypeRaw || undefined, month: month || undefined, year: year || undefined, subReason: subReasonRaw || undefined });
          continue;
        }
        if (!VALID_CLAIM_TYPES.has(claimTypeRaw as ClaimType)) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Claim Type', month: month || undefined, year: year || undefined });
          continue;
        }
        if (!month || month < 1 || month > 12) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Month', claimType: claimTypeRaw, year: year || undefined });
          continue;
        }
        if (!year || year < 2000) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Year', claimType: claimTypeRaw, month });
          continue;
        }
        const claimType = claimTypeRaw as ClaimType;
        let subReason: CessationReason | undefined;
        if (claimType === ClaimType.Cessation) {
          if (!VALID_SUB_REASONS.has(subReasonRaw as CessationReason)) {
            flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Missing Sub Reason for Cessation claim', claimType, month, year });
            continue;
          }
          subReason = subReasonRaw as CessationReason;
        }

        const staff = await this.staffService.findByStaffId(rawStaffId);
        if (!staff) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Staff ID not found', claimType, month, year, subReason });
          continue;
        }

        const staffMongoId = staff._id.toString();
        await this.claimModel.create({
          staffId: staffMongoId,
          claimType,
          subReason,
          month,
          year,
          amount,
          status: ClaimStatus.Approved,
          source: ClaimSource.LegacyImport,
          importBatchId: batchId,
          recordedBy: actorName,
        });
        matched++;

        const balance = await this.claimsService.getStaffBalance(staffMongoId);
        if (balance < 0) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Exceeds staff balance — review', claimType, month, year, subReason });
        }
      }
    } finally {
      this.progressService.complete(batchId);
    }

    const status = flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await this.batchModel.findByIdAndUpdate(batchId, {
      $set: { matchedRows: matched, flaggedRows: flaggedEntries.length, flaggedEntries, status },
    }).exec();

    this.auditService.log(actorId, actorName, AuditAction.Import, AuditEntity.ClaimImportBatch, batchId);

    return { batchId, matched, flagged: flaggedEntries.length, total: rows.length };
  }

  async getBatch(batchId: string): Promise<ClaimImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Claim import batch ${batchId} not found`);
    return batch;
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<ClaimImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resolveFlagged(
    batchId: string, originalStaffId: string, resolvedStaffMongoId: string, actorId: string, actorName: string,
  ): Promise<ClaimImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    const entryIndex = batch.flaggedEntries.findIndex((e) => e.staffId === originalStaffId);
    if (entryIndex === -1) throw new NotFoundException(`Flagged entry ${originalStaffId} not found`);
    await this.resolveOneEntry(batch, entryIndex, resolvedStaffMongoId, actorName);
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, batchId);
    return batch;
  }

  async resolveByStaffId(
    originalStaffId: string, resolvedStaffMongoId: string, actorId: string, actorName: string,
  ): Promise<{ resolvedCount: number; batchesUpdated: number }> {
    const batches = await this.batchModel
      .find({ status: { $ne: ImportBatchStatus.Completed }, 'flaggedEntries.staffId': originalStaffId })
      .exec();

    let resolvedCount = 0;
    let batchesUpdated = 0;
    for (const batch of batches) {
      let resolvedInBatch = 0;
      for (let i = batch.flaggedEntries.length - 1; i >= 0; i--) {
        if (batch.flaggedEntries[i].staffId !== originalStaffId) continue;
        await this.resolveOneEntry(batch, i, resolvedStaffMongoId, actorName);
        resolvedInBatch++;
      }
      if (resolvedInBatch > 0) {
        await batch.save();
        batchesUpdated++;
        resolvedCount += resolvedInBatch;
      }
    }
    if (resolvedCount > 0) {
      this.auditService.log(
        actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, originalStaffId,
        undefined, { resolvedCount, batchesUpdated },
      );
    }
    return { resolvedCount, batchesUpdated };
  }

  async dismissFlaggedEntry(batchId: string, index: number, actorId: string, actorName: string): Promise<ClaimImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, batchId);
    return batch;
  }

  async clearFlaggedEntries(batchId: string, actorId: string, actorName: string): Promise<ClaimImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    batch.flaggedEntries = [];
    batch.flaggedRows = 0;
    batch.status = ImportBatchStatus.Completed;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ClaimImportBatch, batchId);
    return batch;
  }

  private async resolveOneEntry(
    batch: ClaimImportBatchDocument, entryIndex: number, resolvedStaffMongoId: string, actorName: string,
  ): Promise<void> {
    const entry = batch.flaggedEntries[entryIndex];
    if (entry.claimType && entry.month && entry.year) {
      await this.claimModel.create({
        staffId: resolvedStaffMongoId,
        claimType: entry.claimType,
        subReason: entry.subReason,
        month: entry.month,
        year: entry.year,
        amount: entry.amount,
        status: ClaimStatus.Approved,
        source: ClaimSource.LegacyImport,
        importBatchId: batch._id.toString(),
        recordedBy: actorName,
      });
      batch.matchedRows += 1;
    }
    batch.flaggedEntries.splice(entryIndex, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
  }
```
(A flagged row still missing `claimType`/`month`/`year` — e.g. "Invalid or missing Claim Type" — cannot be resolved via staff-mapping alone; it is dropped from the batch without creating a claim, same as contributions silently drops unresolvable rows via dismiss. This is an acceptable gap matching the "fix the source file and re-upload" guidance already given to users for those reasons.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @welfare/api -- claims/import.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/claims/import.service.ts apps/api/src/claims/import.service.spec.ts
git commit -m "feat(api): add Claims bulk-import service with flagged-entry resolution"
```

---

## Task 5: Claims API-local validation DTOs

**Files:**
- Modify: `apps/api/src/claims/dto/claim-query.dto.ts` (replace the Task-3 placeholder with the full version)
- Create: `apps/api/src/claims/dto/create-claim.dto.ts`
- Create: `apps/api/src/claims/dto/reject-claim.dto.ts`
- Create: `apps/api/src/claims/dto/resolve-flagged.dto.ts`
- Create: `apps/api/src/claims/dto/resolve-by-staff-id.dto.ts`
- Create: `apps/api/src/claims/dto/dismiss-flagged-entry.dto.ts`
- Test: none (DTOs validated via the controller e2e test in Task 6)

**Interfaces:**
- Produces: `CreateClaimDto` (API-local, distinct name collision avoided by only importing the shared one inside `claims.service.ts` — the API-local class here is what the controller's `@Body()` binds to and is what actually gets validated), `RejectClaimDto`, `ResolveFlaggedDto`, `ResolveByStaffIdDto`, `DismissFlaggedEntryDto`, `ClaimQueryDto` — all consumed by Task 6's controller.

- [ ] **Step 1: Replace the placeholder `claim-query.dto.ts`**

`apps/api/src/claims/dto/claim-query.dto.ts`:
```typescript
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ClaimType, ClaimStatus } from '@welfare/shared';

export class ClaimQueryDto {
  @IsOptional() staffId?: string;
  @IsOptional() @IsEnum(ClaimType) claimType?: ClaimType;
  @IsOptional() @IsEnum(ClaimStatus) status?: ClaimStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(2000) year?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) limit?: number = 20;
}
```

- [ ] **Step 2: Write the remaining DTOs**

`apps/api/src/claims/dto/create-claim.dto.ts`:
```typescript
import { IsEnum, IsMongoId, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ClaimType, CessationReason } from '@welfare/shared';

export class CreateClaimDto {
  @IsMongoId() staffId!: string;
  @IsEnum(ClaimType) claimType!: ClaimType;
  @ValidateIf((o) => o.claimType === ClaimType.Cessation)
  @IsEnum(CessationReason)
  subReason?: CessationReason;
  @IsNumber() @Min(1) @Max(12) @Type(() => Number) month!: number;
  @IsNumber() @Min(2000) @Type(() => Number) year!: number;
  @IsNumber() @Min(0) @Type(() => Number) amount!: number;
}
```

`apps/api/src/claims/dto/reject-claim.dto.ts`:
```typescript
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectClaimDto {
  @IsString() @IsNotEmpty() reason!: string;
}
```

`apps/api/src/claims/dto/resolve-flagged.dto.ts`:
```typescript
import { IsMongoId, IsString } from 'class-validator';

export class ResolveFlaggedDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedStaffMongoId!: string;
}
```

`apps/api/src/claims/dto/resolve-by-staff-id.dto.ts`:
```typescript
import { IsMongoId, IsString } from 'class-validator';

export class ResolveByStaffIdDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedStaffMongoId!: string;
}
```

`apps/api/src/claims/dto/dismiss-flagged-entry.dto.ts`:
```typescript
import { IsInt, Min } from 'class-validator';

export class DismissFlaggedEntryDto {
  @IsInt() @Min(0) index!: number;
}
```

- [ ] **Step 3: Build to confirm no type errors**

Run: `npm run build -w @welfare/api`
Expected: builds cleanly (this task has no runtime tests — it's pure DTO scaffolding consumed by Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/claims/dto
git commit -m "feat(api): add Claims request-validation DTOs"
```

---

## Task 6: ClaimsController, ClaimsModule, app wiring

**Files:**
- Create: `apps/api/src/claims/claims.controller.ts`
- Create: `apps/api/src/claims/claims.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/claims/claims.controller.spec.ts`

**Interfaces:**
- Consumes: `ClaimsService` (Task 3), `ImportService` (Task 4), all DTOs (Task 5), `Claim`/`ClaimSchema`, `ClaimImportBatch`/`ClaimImportBatchSchema` (Task 2), `ContributionsModule` (existing, exports `ContributionsService` — actually not needed directly since `ClaimsService` injects the `Contribution` model directly; `ClaimsModule` needs `MongooseModule.forFeature` for `Contribution` too), `StaffModule` (existing).
- Produces: registered `/claims/*` routes — consumed by Task 10's frontend `lib/claims.ts`.

- [ ] **Step 1: Write the controller**

`apps/api/src/claims/claims.controller.ts`:
```typescript
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppModule } from '@welfare/shared';
import { ClaimsService } from './claims.service';
import { ImportService } from './import.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { RejectClaimDto } from './dto/reject-claim.dto';
import { ClaimQueryDto } from './dto/claim-query.dto';
import { ResolveFlaggedDto } from './dto/resolve-flagged.dto';
import { ResolveByStaffIdDto } from './dto/resolve-by-staff-id.dto';
import { DismissFlaggedEntryDto } from './dto/dismiss-flagged-entry.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';

@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly importService: ImportService,
  ) {}

  @Post('import')
  @RequirePermission(AppModule.Claims, 'full')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId?: string,
    @CurrentUser() user?: { sub: string; displayName: string },
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.importService.processImport(
      file.buffer, file.originalname, user?.sub ?? 'system', user?.displayName ?? 'system', jobId,
    );
  }

  @Get('import')
  @RequirePermission(AppModule.Claims, 'readonly')
  listBatches(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  @RequirePermission(AppModule.Claims, 'readonly')
  getBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/resolve')
  @RequirePermission(AppModule.Claims, 'full')
  resolveFlagged(
    @Param('batchId') batchId: string,
    @Body() dto: ResolveFlaggedDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveFlagged(batchId, dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName);
  }

  @Patch('import/resolve-by-staff-id')
  @RequirePermission(AppModule.Claims, 'full')
  resolveByStaffId(
    @Body() dto: ResolveByStaffIdDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveByStaffId(dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName);
  }

  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Claims, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Patch('import/:batchId/clear-flagged')
  @RequirePermission(AppModule.Claims, 'full')
  clearFlaggedEntries(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.clearFlaggedEntries(batchId, user.sub, user.displayName);
  }

  @Post()
  @RequirePermission(AppModule.Claims, 'full')
  create(
    @Body() dto: CreateClaimDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.createClaim(dto, user.sub, user.displayName);
  }

  @Patch(':id/approve')
  @RequirePermission(AppModule.Claims, 'full')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.approveClaim(id, user.sub, user.displayName);
  }

  @Patch(':id/reject')
  @RequirePermission(AppModule.Claims, 'full')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectClaimDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.rejectClaim(id, dto.reason, user.sub, user.displayName);
  }

  @Get('staff/:staffId')
  @RequirePermission(AppModule.Claims, 'readonly')
  getByStaff(@Param('staffId') staffId: string) {
    return this.claimsService.findByStaff(staffId);
  }

  @Get('staff/:staffId/balance')
  @RequirePermission(AppModule.Claims, 'readonly')
  getBalance(@Param('staffId') staffId: string) {
    return this.claimsService.getStaffBalance(staffId).then((balance) => ({ balance }));
  }

  @Get()
  @RequirePermission(AppModule.Claims, 'readonly')
  findAll(@Query() query: ClaimQueryDto) {
    return this.claimsService.listClaims(query);
  }

  @Delete(':id')
  @RequirePermission(AppModule.Claims, 'full')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.claimsService.deleteClaim(id, user.sub, user.displayName);
  }
}
```

- [ ] **Step 2: Write the module**

`apps/api/src/claims/claims.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { ImportService } from './import.service';
import { Claim, ClaimSchema } from './schemas/claim.schema';
import { ClaimImportBatch, ClaimImportBatchSchema } from './schemas/claim-import-batch.schema';
import { Contribution, ContributionSchema } from '../contributions/schemas/contribution.schema';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Claim.name, schema: ClaimSchema },
      { name: ClaimImportBatch.name, schema: ClaimImportBatchSchema },
      { name: Contribution.name, schema: ContributionSchema },
    ]),
    MulterModule.register({}),
    StaffModule,
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService, ImportService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
```

- [ ] **Step 3: Register `ClaimsModule` in `app.module.ts`**

Edit `apps/api/src/app.module.ts` — add the import and list entry:
```typescript
import { ClaimsModule } from './claims/claims.module';
```
and in the `imports` array, add `ClaimsModule,` right after `ContributionsModule,`.

- [ ] **Step 4: Write the controller test**

`apps/api/src/claims/claims.controller.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { ImportService } from './import.service';

const mockClaimsService = {
  createClaim: jest.fn(),
  approveClaim: jest.fn(),
  rejectClaim: jest.fn(),
  findByStaff: jest.fn(),
  getStaffBalance: jest.fn().mockResolvedValue(500),
  listClaims: jest.fn(),
  deleteClaim: jest.fn(),
};
const mockImportService = { processImport: jest.fn(), listBatches: jest.fn(), getBatch: jest.fn() };

describe('ClaimsController', () => {
  let controller: ClaimsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClaimsController],
      providers: [
        { provide: ClaimsService, useValue: mockClaimsService },
        { provide: ImportService, useValue: mockImportService },
      ],
    }).compile();
    controller = module.get(ClaimsController);
    jest.clearAllMocks();
  });

  it('create() delegates to claimsService.createClaim with actor identity', async () => {
    const dto = { staffId: 'staff-1', claimType: 'Marriage' as any, month: 1, year: 2026, amount: 500 };
    const user = { sub: 'actor-1', displayName: 'Actor' };
    await controller.create(dto, user);
    expect(mockClaimsService.createClaim).toHaveBeenCalledWith(dto, 'actor-1', 'Actor');
  });

  it('approve() delegates to claimsService.approveClaim', async () => {
    const user = { sub: 'actor-1', displayName: 'Actor' };
    await controller.approve('claim-1', user);
    expect(mockClaimsService.approveClaim).toHaveBeenCalledWith('claim-1', 'actor-1', 'Actor');
  });

  it('reject() delegates to claimsService.rejectClaim with the reason', async () => {
    const user = { sub: 'actor-1', displayName: 'Actor' };
    await controller.reject('claim-1', { reason: 'Not eligible' }, user);
    expect(mockClaimsService.rejectClaim).toHaveBeenCalledWith('claim-1', 'Not eligible', 'actor-1', 'Actor');
  });

  it('getBalance() wraps the numeric balance in an object', async () => {
    const result = await controller.getBalance('staff-1');
    expect(result).toEqual({ balance: 500 });
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm run test -w @welfare/api -- claims.controller.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Boot the API locally to confirm module wiring**

Run: `npm run start:dev -w @welfare/api` (or the repo's existing dev-server command — check `apps/api/package.json` `scripts` for the exact name if different), watch for `ClaimsModule dependencies initialized` in the Nest startup log with no errors, then stop it (Ctrl+C).
Expected: clean boot, no `UnknownDependenciesException` for `ClaimsModule`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/claims/claims.controller.ts apps/api/src/claims/claims.module.ts apps/api/src/claims/claims.controller.spec.ts apps/api/src/app.module.ts
git commit -m "feat(api): wire up Claims controller, module, and routes"
```

---

## Task 7: Contribution statement — claims-by-year table

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/src/reports/reports.module.ts`
- Test: `apps/api/src/reports/reports.service.spec.ts` (add a describe block — create the file if it doesn't already exist; check first)

**Interfaces:**
- Consumes: `Claim`, `ClaimDocument` (Task 2), `ClaimStatus` (Task 1).
- Produces: `getStaffContributionStatement` return type gains `claimYears: Array<{ year: number; claims: Array<{ claimType: string; amount: number }> }>` and `kpis.totalClaims`; `generateStatementPdf` HTML gains the claims table. Consumed by Task 15 (frontend statement panel) via the existing `GET /reports/contributions/staff-statement` route (no new route needed — same route returns more fields).

- [ ] **Step 1: Register `Claim` schema in `ReportsModule` and inject the model**

Edit `apps/api/src/reports/reports.module.ts`:
```typescript
import { Claim, ClaimSchema } from '../claims/schemas/claim.schema';
```
Add `{ name: Claim.name, schema: ClaimSchema },` to the `MongooseModule.forFeature([...])` array.

Edit `apps/api/src/reports/reports.service.ts` constructor — add the injected model:
```typescript
import { Claim, ClaimDocument } from '../claims/schemas/claim.schema';
import { ClaimStatus } from '@welfare/shared';
// ...
constructor(
  @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
  @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
  @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
  @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
  @InjectModel(ImportBatch.name) private readonly batchModel: Model<ImportBatchDocument>,
  @InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
  @InjectModel(Claim.name) private readonly claimModel: Model<ClaimDocument>,
  @Optional() @Inject(MINIO_CLIENT) private readonly minioClient?: MinioClient,
) {}
```

- [ ] **Step 2: Extend `getStaffContributionStatement` to fetch and group claims**

In `apps/api/src/reports/reports.service.ts`, inside `getStaffContributionStatement` (currently ends around line 974), add claims fetching right before the `return` statement:
```typescript
    const approvedClaims = await this.claimModel
      .find({ staffId: staffMongoId, status: ClaimStatus.Approved })
      .sort({ year: 1 })
      .exec();
    const totalClaims = approvedClaims.reduce((s, c) => s + c.amount, 0);
    const claimsByYear = new Map<number, Array<{ claimType: string; amount: number }>>();
    for (const c of approvedClaims) {
      const bucket = claimsByYear.get(c.year) ?? [];
      bucket.push({ claimType: c.claimType, amount: c.amount });
      claimsByYear.set(c.year, bucket);
    }
    const claimYears = [...claimsByYear.keys()].sort((a, b) => a - b).map((year) => ({
      year,
      claims: claimsByYear.get(year)!,
    }));
```
Then change the `return` statement to add the two new fields:
```typescript
    return {
      staff: { _id: staff._id.toString(), fullName: staff.fullName, staffId: staff.staffId, email: staff.email },
      kpis: { totalPaid, totalExpected, missedMonths, totalSurplus, collectionRate, totalOffsets, totalClaims },
      years,
      rows,
      claimYears,
    };
```
Also update the method's declared return type (the big inline object type in the signature) to add:
```typescript
    kpis: { totalPaid: number; totalExpected: number; missedMonths: number; totalSurplus: number; collectionRate: number; totalOffsets: number; totalClaims: number };
    // ...unchanged years/rows...
    claimYears: Array<{ year: number; claims: Array<{ claimType: string; amount: number }> }>;
```

- [ ] **Step 3: Add the claims table (with rowspan) to `generateStatementPdf`**

In `generateStatementPdf`, destructure the new field:
```typescript
  async generateStatementPdf(staffMongoId: string): Promise<Buffer> {
    const { staff, kpis, years, rows, claimYears } = await this.getStaffContributionStatement(staffMongoId);
```
Add a claims-table HTML builder right after the existing `offsetDetailHtml` block (before the final `const html = ...` template literal), and reference it inside the template:
```typescript
    const totalClaimsAmount = claimYears.reduce((s, y) => s + y.claims.reduce((s2, c) => s2 + c.amount, 0), 0);
    const claimsTableHtml = claimYears.length
      ? `<div style="margin-top:16px"><div style="font-size:11px;font-weight:bold;margin-bottom:6px;color:#1e293b">Welfare Claims</div>
<table>
  <thead><tr><th style="text-align:left">Year</th><th style="text-align:left">Claim Type</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${claimYears.map(y => y.claims.map((c, i) => `<tr>${i === 0 ? `<td rowspan="${y.claims.length}" class="year-label">${y.year}</td>` : ''}<td style="text-align:left">${c.claimType}</td><td style="text-align:right">${fmt(c.amount)}</td></tr>`).join('')).join('')}</tbody>
  <tfoot><tr><td colspan="2" style="text-align:right;font-weight:bold">Total Welfare Claims</td><td style="text-align:right;font-weight:bold">${fmt(totalClaimsAmount)}</td></tr></tfoot>
</table></div>`
      : '';
```
Add a KPI tile for claims in the `.kpis` grid (right after the existing `Loan Deductions` kpi div):
```html
  <div class="kpi"><div class="kpi-label">Welfare Claims</div><div class="kpi-value" style="color:#dc2626">${fmt(kpis.totalClaims)}</div></div>
```
And append `${claimsTableHtml}` at the very end of the body, after `${offsetDetailHtml}`:
```typescript
${offsetDetailHtml}
${claimsTableHtml}
</body></html>`;
```

- [ ] **Step 4: Write/extend the report service test**

Check whether `apps/api/src/reports/reports.service.spec.ts` already exists (`ls apps/api/src/reports/*.spec.ts`). If it exists, add a new `describe` block to it; if not, create it with just this block:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ClaimStatus, ClaimType } from '@welfare/shared';
import { ReportsService } from './reports.service';
import { Contribution } from '../contributions/schemas/contribution.schema';
import { Loan } from '../loans/schemas/loan.schema';
import { LoanRepayment } from '../loans/schemas/loan-repayment.schema';
import { Staff } from '../staff/schemas/staff.schema';
import { ImportBatch } from '../contributions/schemas/import-batch.schema';
import { Discount } from '../loans/schemas/discount.schema';
import { Claim } from '../claims/schemas/claim.schema';

function execResolve(value: unknown) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('ReportsService — statement claims grouping', () => {
  let service: ReportsService;
  const mockClaimModel = { find: jest.fn() };
  const mockStaffModel = { findById: jest.fn() };
  const mockContribModel = { find: jest.fn(), aggregate: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: getModelToken(Loan.name), useValue: {} },
        { provide: getModelToken(LoanRepayment.name), useValue: {} },
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
        { provide: getModelToken(ImportBatch.name), useValue: {} },
        { provide: getModelToken(Discount.name), useValue: {} },
        { provide: getModelToken(Claim.name), useValue: mockClaimModel },
      ],
    }).compile();
    service = module.get(ReportsService);
    jest.clearAllMocks();

    mockStaffModel.findById.mockReturnValue(execResolve({
      _id: 'staff-1', fullName: 'Jane Doe', staffId: 'S1', email: 'jane@x.com', status: 'Active',
    }));
    mockContribModel.find.mockReturnValue({ sort: () => execResolve([]) });
    mockContribModel.aggregate.mockReturnValue(execResolve([]));
  });

  it('groups approved claims by year with rowspan-ready structure', async () => {
    mockClaimModel.find.mockReturnValue({
      sort: () => execResolve([
        { year: 2024, claimType: ClaimType.Marriage, amount: 500, status: ClaimStatus.Approved },
        { year: 2024, claimType: ClaimType.Funeral, amount: 300, status: ClaimStatus.Approved },
        { year: 2025, claimType: ClaimType.Birth, amount: 200, status: ClaimStatus.Approved },
      ]),
    });

    const result = await service.getStaffContributionStatement('staff-1');

    expect(result.claimYears).toEqual([
      { year: 2024, claims: [{ claimType: ClaimType.Marriage, amount: 500 }, { claimType: ClaimType.Funeral, amount: 300 }] },
      { year: 2025, claims: [{ claimType: ClaimType.Birth, amount: 200 }] },
    ]);
    expect(result.kpis.totalClaims).toBe(1000);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm run test -w @welfare/api -- reports.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.module.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(api): add welfare-claims table to contribution statement report"
```

---

## Task 8: Fund summary — claims aggregate and sub-route

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/src/reports/reports.controller.ts`
- Test: extend `apps/api/src/reports/reports.service.spec.ts`

**Interfaces:**
- Consumes: `claimModel` (already injected in Task 7).
- Produces: `getFundSummary(...)` return value gains `claims: IFundSummaryClaims` and `claimsBreakdown: IFundSummaryClaimsBreakdownRow[]`; new route `GET /reports/fund-summary/claims`. Consumed by Task 15 frontend fund-summary panel.

- [ ] **Step 1: Add the claims aggregation to `getFundSummary`**

In `apps/api/src/reports/reports.service.ts`, inside the `Promise.all([...])` array in `getFundSummary` (currently 11 entries ending with `periodDiscounts`), add a 12th aggregation for claims-by-type in the period:
```typescript
      // 9. Claims breakdown by type (approved claims disbursed in period)
      this.claimModel
        .aggregate([
          { $match: { year, month: { $gte: fromMonth, $lte: toMonth }, status: 'Approved' } },
          { $group: { _id: '$claimType', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
        ])
        .exec(),
```
Update the destructuring line above the `Promise.all` call to add `claimGroups` as the 12th element:
```typescript
    const [
      contribRows, loanGroups, recoveryGroups, allTimeContribs, allTimeLoans,
      activeStaff, joiners, exits, defaultRows, allTimeDiscountsAgg, periodDiscounts,
      claimGroups,
    ] = await Promise.all([
```
Then, just before the final `return` statement, compute the claims summary:
```typescript
    const claimsBreakdown: IFundSummaryClaimsBreakdownRow[] = (claimGroups as any[]).map(g => ({
      claimType: g._id,
      count: g.count,
      totalAmount: g.totalAmount,
    }));
    const totalClaimsAmount = claimsBreakdown.reduce((s, r) => s + r.totalAmount, 0);
    const totalClaimsCount = claimsBreakdown.reduce((s, r) => s + r.count, 0);
    const claimsByType: Record<string, number> = Object.fromEntries(claimsBreakdown.map(r => [r.claimType, r.totalAmount]));
```
Add the two new fields to the returned object:
```typescript
      claims: { totalAmount: totalClaimsAmount, count: totalClaimsCount, byType: claimsByType },
      claimsBreakdown,
    };
```
Add `IFundSummaryClaimsBreakdownRow` to the `@welfare/shared` import list at the top of the file.

- [ ] **Step 2: Add CSV columns and the new sub-route in the controller**

Edit `apps/api/src/reports/reports.controller.ts` — add to the `CSV_COLUMNS` object:
```typescript
  fundSummaryClaims: [
    { header: 'Claim Type',   field: 'claimType' },
    { header: 'Count',        field: 'count' },
    { header: 'Total (GHS)',  field: 'totalAmount' },
  ],
```
Add a new endpoint mirroring `getFundSummaryLoans`, placed after it:
```typescript
  @Get('fund-summary/claims')
  @RequirePermission(AppModule.Reports, 'readonly')
  async getFundSummaryClaims(
    @Query() dto: FundSummaryQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const quarterMap: Record<number, [number, number]> = { 1: [1,3], 2: [4,6], 3: [7,9], 4: [10,12] };
    let fromMonth = dto.fromMonth ?? 1;
    let toMonth   = dto.toMonth ?? 12;
    if (dto.quarter) [fromMonth, toMonth] = quarterMap[dto.quarter];
    const summary = await this.reportsService.getFundSummary(dto.year, fromMonth, toMonth);
    if (dto.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="fund-claims-${dto.year}.csv"`);
      return this.reportsService.generateCsv(summary.claimsBreakdown, CSV_COLUMNS.fundSummaryClaims.map(c => c.field));
    }
    if (dto.format === 'pdf') {
      const pdf = await this.reportsService.generatePdf(`Fund Summary — Welfare Claims ${dto.year}`, CSV_COLUMNS.fundSummaryClaims, summary.claimsBreakdown);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="fund-claims-${dto.year}.pdf"`);
      res.end(pdf);
      return;
    }
    return summary.claimsBreakdown;
  }
```

- [ ] **Step 3: Extend the report service test**

Add to `apps/api/src/reports/reports.service.spec.ts` (new `describe` block, reusing the mocks set up in Task 7's file — add whatever additional model mocks `getFundSummary` needs: `loanModel`, `staffModel.find`, etc., following the same `execResolve` helper pattern):
```typescript
describe('ReportsService — fund summary claims aggregate', () => {
  let service: ReportsService;
  const mockClaimModel = { aggregate: jest.fn() };
  const mockContribModel = { aggregate: jest.fn() };
  const mockLoanModel = { aggregate: jest.fn() };
  const mockStaffModel = { find: jest.fn() };
  const mockDiscountModel = { aggregate: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: getModelToken(LoanRepayment.name), useValue: {} },
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
        { provide: getModelToken(ImportBatch.name), useValue: {} },
        { provide: getModelToken(Discount.name), useValue: mockDiscountModel },
        { provide: getModelToken(Claim.name), useValue: mockClaimModel },
      ],
    }).compile();
    service = module.get(ReportsService);
    jest.clearAllMocks();

    mockContribModel.aggregate.mockReturnValue(execResolve([]));
    mockLoanModel.aggregate.mockReturnValue(execResolve([]));
    mockStaffModel.find.mockReturnValue({ select: () => ({ lean: () => execResolve([]) }) });
    mockDiscountModel.aggregate.mockReturnValue(execResolve([]));
  });

  it('includes a claims breakdown by type in the fund summary', async () => {
    mockClaimModel.aggregate.mockReturnValue(execResolve([
      { _id: ClaimType.Marriage, count: 2, totalAmount: 1000 },
      { _id: ClaimType.Funeral, count: 1, totalAmount: 400 },
    ]));

    const result = await service.getFundSummary(2026, 1, 12);

    expect(result.claimsBreakdown).toEqual([
      { claimType: ClaimType.Marriage, count: 2, totalAmount: 1000 },
      { claimType: ClaimType.Funeral, count: 1, totalAmount: 400 },
    ]);
    expect(result.claims).toEqual({ totalAmount: 1400, count: 3, byType: { [ClaimType.Marriage]: 1000, [ClaimType.Funeral]: 400 } });
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @welfare/api -- reports.service.spec.ts`
Expected: PASS (all describe blocks green — this task's test plus Task 7's).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.controller.ts apps/api/src/reports/reports.service.spec.ts
git commit -m "feat(api): add welfare claims breakdown to fund summary report"
```

---

## Task 9: Frontend — `lib/claims.ts` API client

**Files:**
- Create: `apps/web/src/lib/claims.ts`
- Test: none (thin API wrapper, exercised indirectly by the components built in Tasks 10–12; matches the existing convention of not unit-testing `lib/contributions.ts`)

**Interfaces:**
- Consumes: `apiClient` from `./api-client`; `IClaim`, `IClaimImportBatch`, `PaginatedResult`, `ClaimType`, `ClaimStatus`, `CessationReason` from `@welfare/shared`.
- Produces: every function consumed by Tasks 10–12's client components (exact names listed below).

- [ ] **Step 1: Write the client**

`apps/web/src/lib/claims.ts`:
```typescript
import { apiClient } from './api-client';
import type { IClaim, IClaimImportBatch, PaginatedResult, ClaimType, ClaimStatus, CessationReason } from '@welfare/shared';

export interface ClaimFilters {
  staffId?: string;
  claimType?: ClaimType;
  status?: ClaimStatus;
  year?: number;
  page?: number;
  limit?: number;
}

export interface ImportResult {
  batchId: string;
  matched: number;
  flagged: number;
  total: number;
}

export async function listClaims(filters: ClaimFilters = {}): Promise<PaginatedResult<IClaim>> {
  const { data } = await apiClient.get('/claims', { params: filters });
  return data;
}

export async function getClaimsByStaff(staffId: string): Promise<IClaim[]> {
  const { data } = await apiClient.get(`/claims/staff/${staffId}`);
  return data;
}

export async function getStaffClaimBalance(staffId: string): Promise<{ balance: number }> {
  const { data } = await apiClient.get(`/claims/staff/${staffId}/balance`);
  return data;
}

export async function createClaim(payload: {
  staffId: string;
  claimType: ClaimType;
  subReason?: CessationReason;
  month: number;
  year: number;
  amount: number;
}): Promise<IClaim> {
  const { data } = await apiClient.post('/claims', payload);
  return data;
}

export async function approveClaim(id: string): Promise<IClaim> {
  const { data } = await apiClient.patch(`/claims/${id}/approve`);
  return data;
}

export async function rejectClaim(id: string, reason: string): Promise<IClaim> {
  const { data } = await apiClient.patch(`/claims/${id}/reject`, { reason });
  return data;
}

export async function deleteClaim(id: string): Promise<void> {
  await apiClient.delete(`/claims/${id}`);
}

export async function importClaims(file: File, jobId?: string): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/claims/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listClaimImportBatches(page = 1, limit = 20): Promise<PaginatedResult<IClaimImportBatch>> {
  const { data } = await apiClient.get('/claims/import', { params: { page, limit } });
  return data;
}

export async function getClaimImportBatch(batchId: string): Promise<IClaimImportBatch> {
  const { data } = await apiClient.get(`/claims/import/${batchId}`);
  return data;
}

export async function resolveClaimFlaggedEntry(
  batchId: string, originalStaffId: string, resolvedStaffMongoId: string,
): Promise<IClaimImportBatch> {
  const { data } = await apiClient.patch(`/claims/import/${batchId}/resolve`, { originalStaffId, resolvedStaffMongoId });
  return data;
}

export async function resolveClaimsByStaffId(
  originalStaffId: string, resolvedStaffMongoId: string,
): Promise<{ resolvedCount: number; batchesUpdated: number }> {
  const { data } = await apiClient.patch('/claims/import/resolve-by-staff-id', { originalStaffId, resolvedStaffMongoId });
  return data;
}

export async function dismissClaimFlaggedEntry(batchId: string, index: number): Promise<IClaimImportBatch> {
  const { data } = await apiClient.patch(`/claims/import/${batchId}/dismiss`, { index });
  return data;
}

export async function clearClaimFlaggedEntries(batchId: string): Promise<IClaimImportBatch> {
  const { data } = await apiClient.patch(`/claims/import/${batchId}/clear-flagged`);
  return data;
}
```

- [ ] **Step 2: Type-check the web app**

Run: `npm run build -w @welfare/web` (or `npx tsc --noEmit` inside `apps/web` if the repo's web build is slow — check `apps/web/package.json` for a `typecheck` script and prefer that if present)
Expected: no type errors (this file has no consumers yet, so it should compile standalone).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/claims.ts
git commit -m "feat(web): add Claims API client"
```

---

## Task 10: Frontend — sidebar nav entry

**Files:**
- Modify: `apps/web/src/components/nav/sidebar.tsx`

**Interfaces:**
- Consumes: `AppModule.Claims` (Task 1).

- [ ] **Step 1: Add the nav item**

Edit `apps/web/src/components/nav/sidebar.tsx` — add `HeartHandshake` (or another suitable `lucide-react` icon already available in the project's version — check `node_modules/lucide-react`'s exports if unsure, `HandCoins` is a safe fallback) to the icon import list, and add one entry to `navItems` right after `Contributions`:
```typescript
import {
  LayoutDashboard, Users, UserCog, Landmark, FileBarChart2, Settings, ScrollText, Mail,
  Coins, Receipt, TrendingUp, HandCoins, type LucideIcon,
} from 'lucide-react';
```
```typescript
const navItems: NavItem[] = [
  { href: '/',              label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/staff',         label: 'Staff',         icon: Users,         matchPrefix: true, module: AppModule.Staff },
  { href: '/contributions', label: 'Contributions', icon: Coins,         matchPrefix: true, module: AppModule.Contributions },
  { href: '/claims',        label: 'Claims',        icon: HandCoins,     matchPrefix: true, module: AppModule.Claims },
  { href: '/loans',         label: 'Loans',         icon: Landmark,      matchPrefix: true, module: AppModule.Loans },
  { href: '/remittances',   label: 'Remittances',   icon: Receipt,       matchPrefix: true, module: AppModule.Remittances },
  { href: '/investments',   label: 'Investments',   icon: TrendingUp,    matchPrefix: true, module: AppModule.Investments },
  { href: '/reports',       label: 'Reports',       icon: FileBarChart2, matchPrefix: true, module: AppModule.Reports },
  { href: '/audit',         label: 'Audit Log',     icon: ScrollText,    module: AppModule.AuditLog },
  { href: '/email-log',     label: 'Email Log',     icon: Mail,          module: AppModule.EmailLog },
  { href: '/settings',      label: 'Settings',      icon: Settings,      module: AppModule.Settings },
  { href: '/users',         label: 'Users',         icon: UserCog,       matchPrefix: true, module: AppModule.UserManagement },
];
```

- [ ] **Step 2: Verify visually**

Run the web dev server (check `apps/web/package.json` for the exact script, typically `npm run dev -w @welfare/web`), log in, and confirm "Claims" appears in the sidebar between Contributions and Loans for a role with `Claims` permission. (Full page won't exist until Task 11 — clicking it 404s for now, which is expected at this point in the plan.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/nav/sidebar.tsx
git commit -m "feat(web): add Claims entry to sidebar navigation"
```

---

## Task 11: Frontend — Claims list page (with approve/reject)

**Files:**
- Create: `apps/web/src/app/(dashboard)/claims/page.tsx`
- Create: `apps/web/src/app/(dashboard)/claims/claims-list-client.tsx`

**Interfaces:**
- Consumes: `listClaims`, `deleteClaim`, `approveClaim`, `rejectClaim` from `lib/claims.ts` (Task 9); `usePermission`, `AppModule.Claims`.

- [ ] **Step 1: Write the page shell**

`apps/web/src/app/(dashboard)/claims/page.tsx`:
```typescript
import { Suspense } from 'react';
import Link from 'next/link';
import { Upload, PenLine } from 'lucide-react';
import ClaimsListClient from './claims-list-client';
import { TableSkeleton } from '@/components/ui/skeleton';

export const metadata = { title: 'Claims - Welfare Department' };

export default function ClaimsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Welfare Claims</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/claims/import"
            className="inline-flex items-center gap-2 px-4 h-[var(--row-default)] rounded-sm border border-neutral-200 bg-white text-base font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-700 transition-colors duration-fast"
          >
            <Upload size={16} strokeWidth={1.75} />
            Legacy Import
          </Link>
          <Link
            href="/claims/new"
            className="inline-flex items-center gap-2 px-4 h-[var(--row-default)] rounded-sm border border-neutral-200 bg-white text-base font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-700 transition-colors duration-fast"
          >
            <PenLine size={16} strokeWidth={1.75} />
            New Claim
          </Link>
        </div>
      </div>

      <Suspense fallback={<div className="bg-white border border-neutral-200 rounded-md"><TableSkeleton rows={8} cols={7} /></div>}>
        <ClaimsListClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Write the list client**

`apps/web/src/app/(dashboard)/claims/claims-list-client.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { IClaim } from '@welfare/shared';
import { ClaimStatus, ClaimType, AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { listClaims, deleteClaim, approveClaim, rejectClaim } from '@/lib/claims';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Select, Input } from '@/components/ui/field';
import { Pagination } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const statusKind: Record<ClaimStatus, 'success' | 'warning' | 'danger'> = {
  [ClaimStatus.Approved]: 'success',
  [ClaimStatus.Pending]:  'warning',
  [ClaimStatus.Rejected]: 'danger',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

type ClaimRow = IClaim & { staffInfo?: { staffId: string; fullName: string } };

export default function ClaimsListClient() {
  const qc = useQueryClient();
  const permission = usePermission(AppModule.Claims);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<ClaimStatus | ''>('');
  const [claimType, setClaimType] = useState<ClaimType | ''>('');
  const [year, setYear] = useState('');
  const [staffId, setStaffId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ClaimRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ClaimRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['claims', { page, limit, status, claimType, year, staffId }],
    queryFn: () => listClaims({
      page, limit,
      status: status || undefined,
      claimType: claimType || undefined,
      year: year ? parseInt(year, 10) : undefined,
      staffId: staffId || undefined,
    }),
  });

  if (error) toast.error('Failed to load claims');

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveClaim(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['claims'] }); toast.success('Claim approved'); },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Approval failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectClaim(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claims'] });
      setRejectTarget(null);
      setRejectReason('');
      toast.success('Claim rejected');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Rejection failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClaim(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['claims'] }); setDeleteTarget(null); toast.success('Claim deleted'); },
    onError: () => toast.error('Failed to delete claim'),
  });

  const col = createColumnHelper<ClaimRow>();
  const columns = [
    col.display({
      id: 'staff',
      header: 'Staff',
      cell: (i) => {
        const info = i.row.original.staffInfo;
        return info ? (
          <span><span className="font-medium text-neutral-900">{info.fullName}</span><span className="ml-2 font-mono text-xs text-neutral-500">{info.staffId}</span></span>
        ) : <span className="font-mono text-xs text-neutral-400">{i.row.original.staffId}</span>;
      },
    }),
    col.accessor('claimType', { header: 'Type' }),
    col.display({
      id: 'period',
      header: 'Period',
      cell: (i) => <span className="font-mono tabular">{MONTHS[i.row.original.month - 1]} {i.row.original.year}</span>,
    }),
    col.accessor('amount', { header: 'Amount', cell: (i) => <span className="font-mono tabular">{fmtGHS(i.getValue())}</span> }),
    col.accessor('source', { header: 'Source', cell: (i) => <span className="text-xs text-neutral-500">{i.getValue()}</span> }),
    col.accessor('status', { header: 'Status', cell: (i) => <Badge kind={statusKind[i.getValue()]}>{i.getValue()}</Badge> }),
    ...(permission === 'full' ? [col.display({
      id: 'actions',
      header: '',
      cell: (i) => (
        <div className="flex items-center gap-2">
          {i.row.original.status === ClaimStatus.Pending && (
            <>
              <button onClick={() => approveMutation.mutate(i.row.original._id)} title="Approve" className="text-neutral-400 hover:text-success-600 transition-colors duration-fast p-1 rounded">
                <CheckCircle2 size={14} strokeWidth={1.75} />
              </button>
              <button onClick={() => setRejectTarget(i.row.original)} title="Reject" className="text-neutral-400 hover:text-danger-600 transition-colors duration-fast p-1 rounded">
                <XCircle size={14} strokeWidth={1.75} />
              </button>
            </>
          )}
          <button onClick={() => setDeleteTarget(i.row.original)} title="Delete" className="text-neutral-400 hover:text-danger-600 transition-colors duration-fast p-1 rounded">
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        </div>
      ),
    })] : []),
  ];

  const table = useReactTable({
    data: (data?.data ?? []) as ClaimRow[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / limit) : 0,
    getRowId: (row) => row._id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Staff ID" value={staffId} onChange={(e) => { setStaffId(e.target.value); setPage(1); }} style={{ width: 130 }} />
        <Select
          value={claimType}
          onChange={(e) => { setClaimType(e.target.value as ClaimType | ''); setPage(1); }}
          options={[{ value: '', label: 'All Types' }, ...Object.values(ClaimType).map((t) => ({ value: t, label: t }))]}
          style={{ width: 150 }}
        />
        <Input type="number" placeholder="Year" value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }} style={{ width: 100 }} />
        <Select
          value={status}
          onChange={(e) => { setStatus(e.target.value as ClaimStatus | ''); setPage(1); }}
          options={[{ value: '', label: 'All Statuses' }, ...Object.values(ClaimStatus).map((s) => ({ value: s, label: s }))]}
          style={{ width: 150 }}
        />
        {data && <span className="ml-auto text-xs text-neutral-400">{data.total.toLocaleString()} records</span>}
      </div>

      <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
                  {hg.headers.map((h) => (
                    <th key={h.id} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                <tr><td colSpan={columns.length} className="p-0"><TableSkeleton rows={5} cols={columns.length} /></td></tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr><td colSpan={columns.length}><EmptyState heading="No claims found" body="Import legacy claims or record a new one to get started." /></td></tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-neutral-50 transition-colors duration-fast" style={{ height: 'var(--row-default)' }}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 text-neutral-800">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && <Pagination page={page} total={data.total} limit={limit} onPageChange={setPage} onLimitChange={(n) => { setLimit(n); setPage(1); }} />}
      </div>

      {rejectTarget && (
        <Modal open onClose={() => { setRejectTarget(null); setRejectReason(''); }} title="Reject Claim" size="sm" iconKind="danger">
          <div className="mt-3 space-y-3">
            <p className="text-sm text-neutral-600">Reject the {rejectTarget.claimType} claim for {rejectTarget.staffInfo?.fullName ?? rejectTarget.staffId}?</p>
            <Input placeholder="Reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason(''); }}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!rejectReason.trim()}
              loading={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ id: rejectTarget._id, reason: rejectReason.trim() })}
            >
              Reject
            </Button>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Claim"
        body={`Delete the ${deleteTarget?.claimType} claim for ${deleteTarget?.staffInfo?.fullName ?? deleteTarget?.staffId}? This cannot be undone.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!._id)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Start the web+api dev servers, log in as a role with `Claims: 'full'`, navigate to `/claims`. Confirm the empty state renders (no claims yet), filters render, and no console errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/claims/page.tsx" "apps/web/src/app/(dashboard)/claims/claims-list-client.tsx"
git commit -m "feat(web): add Claims list page with approve/reject actions"
```

---

## Task 12: Frontend — Claims legacy-import page

**Files:**
- Create: `apps/web/src/app/(dashboard)/claims/import/page.tsx`
- Create: `apps/web/src/app/(dashboard)/claims/import/import-client.tsx`

**Interfaces:**
- Consumes: `importClaims`, `listClaimImportBatches`, `resolveClaimFlaggedEntry`, `resolveClaimsByStaffId`, `dismissClaimFlaggedEntry`, `clearClaimFlaggedEntries` (Task 9); `useImportProgress`, `genJobId`, `ImportProgressBar` (existing, reused as-is from the contributions import flow).

- [ ] **Step 1: Write the page shell**

`apps/web/src/app/(dashboard)/claims/import/page.tsx`:
```typescript
import { Suspense } from 'react';
import ImportClient from './import-client';

export const metadata = { title: 'Claims Legacy Import - Welfare Department' };

export default function ClaimsImportPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <a href="/claims" className="text-sm text-neutral-500 hover:text-neutral-700">← Claims</a>
        <h1 className="text-xl font-bold text-neutral-900">Legacy Claims Import</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-neutral-400">Loading...</div>}>
        <ImportClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Write the import client**

`apps/web/src/app/(dashboard)/claims/import/import-client.tsx`:
```typescript
'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { ImportBatchStatus } from '@welfare/shared';
import type { IClaimImportBatch } from '@welfare/shared';
import {
  importClaims, listClaimImportBatches, resolveClaimFlaggedEntry,
  resolveClaimsByStaffId, dismissClaimFlaggedEntry, clearClaimFlaggedEntries,
} from '@/lib/claims';
import { searchStaff } from '@/lib/staff';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Badge } from '@/components/ui/badge';
import { fmtGHS } from '@/lib/format';
import { cn } from '@/lib/utils';
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';

const statusKind: Record<ImportBatchStatus, 'success' | 'warning' | 'info'> = {
  [ImportBatchStatus.Pending]:   'warning',
  [ImportBatchStatus.Resolved]:  'info',
  [ImportBatchStatus.Completed]: 'success',
};

interface PreviewRow {
  staffId: string;
  fullName: string;
  claimType: string;
  month: number;
  year: number;
  amount: number;
  subReason: string;
}

export default function ImportClient() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<{ batchId: string; matched: number; flagged: number; total: number } | null>(null);
  const [activeBatch, setActiveBatch] = useState<IClaimImportBatch | null>(null);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [bulkResolveTarget, setBulkResolveTarget] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<{ _id: string; fullName: string; staffId: string }[]>([]);
  const [clearTarget, setClearTarget] = useState<{ batchId: string; fileName: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const { data: batchHistory } = useQuery({ queryKey: ['claim-import-batches'], queryFn: () => listClaimImportBatches() });

  interface AggregatedFlag { staffId: string; employeeName: string; occurrences: number; }
  const aggregatedFlags: AggregatedFlag[] = (() => {
    const byStaffId = new Map<string, AggregatedFlag>();
    for (const batch of batchHistory?.data ?? []) {
      if (batch.status === ImportBatchStatus.Completed) continue;
      for (const entry of batch.flaggedEntries) {
        if (!entry.staffId) continue;
        const existing = byStaffId.get(entry.staffId);
        if (existing) existing.occurrences++;
        else byStaffId.set(entry.staffId, { staffId: entry.staffId, employeeName: entry.employeeName, occurrences: 1 });
      }
    }
    return Array.from(byStaffId.values());
  })();

  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importClaims(file!, id);
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success(`Imported: ${data.matched} matched, ${data.flagged} flagged`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Import failed'),
  });

  const progress = useImportProgress(importMutation.isPending ? jobId : null);

  const resolveMutation = useMutation({
    mutationFn: ({ originalId, resolvedId }: { originalId: string; resolvedId: string }) =>
      resolveClaimFlaggedEntry(activeBatch!._id, originalId, resolvedId),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      setResolveTarget(null);
      setStaffSearch(''); setStaffOptions([]);
      toast.success('Entry resolved');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Resolve failed'),
  });

  const bulkResolveMutation = useMutation({
    mutationFn: ({ originalStaffId, resolvedId }: { originalStaffId: string; resolvedId: string }) =>
      resolveClaimsByStaffId(originalStaffId, resolvedId),
    onSuccess: (result) => {
      setBulkResolveTarget(null);
      setStaffSearch(''); setStaffOptions([]);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success(`Mapped ${result.resolvedCount} entries across ${result.batchesUpdated} imports`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Resolve failed'),
  });

  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissClaimFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Dismiss failed'),
  });

  const clearMutation = useMutation({
    mutationFn: (batchId: string) => clearClaimFlaggedEntries(batchId),
    onSuccess: (updated) => {
      setClearTarget(null);
      if (activeBatch && clearTarget?.batchId === activeBatch._id) setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['claim-import-batches'] });
      toast.success('Flagged entries cleared');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Clear failed'),
  });

  function handleFileChange(f: File) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target?.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      setPreview(rows.map((r) => ({
        staffId:   String(r['Staff ID'] ?? ''),
        fullName:  String(r['Full Name'] ?? ''),
        claimType: String(r['Claim Type'] ?? ''),
        month:     Number(r['Month'] ?? 0),
        year:      Number(r['Year'] ?? 0),
        amount:    Number(r['Amount'] ?? 0),
        subReason: String(r['Sub Reason'] ?? ''),
      })));
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 1) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data.map((s) => ({ _id: s._id, fullName: s.fullName, staffId: s.staffId })));
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <Card>
        <CardHeader title="Upload Excel File" subtitle="Expected columns: Staff ID, Full Name, Claim Type, Month, Year, Amount, Sub Reason (required only for Cessation)" />
        <CardBody className="space-y-4">
          <div
            className={cn('border-2 border-dashed border-neutral-200 rounded-sm p-10 text-center cursor-pointer', 'hover:border-primary-400 hover:bg-primary-50 transition-colors duration-fast')}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f); }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])} />
            <Upload size={32} strokeWidth={1.5} className="mx-auto text-neutral-300 mb-3" />
            {file ? <p className="text-sm text-neutral-700 font-medium">{file.name} — {preview.length} rows parsed</p> : <p className="text-sm text-neutral-400">Drop .xlsx file here or click to browse</p>}
          </div>

          {preview.length > 0 && (
            <div className="overflow-x-auto border border-neutral-200 rounded-sm max-h-60">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>{['Staff ID','Full Name','Claim Type','Month','Year','Amount','Sub Reason'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.slice(0, 50).map((row, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-3 py-1.5 font-mono text-neutral-600">{row.staffId}</td>
                      <td className="px-3 py-1.5 text-neutral-700">{row.fullName}</td>
                      <td className="px-3 py-1.5">{row.claimType}</td>
                      <td className="px-3 py-1.5">{row.month}</td>
                      <td className="px-3 py-1.5">{row.year}</td>
                      <td className="px-3 py-1.5 font-mono tabular">{fmtGHS(row.amount)}</td>
                      <td className="px-3 py-1.5">{row.subReason}</td>
                    </tr>
                  ))}
                  {preview.length > 50 && <tr><td colSpan={7} className="px-3 py-2 text-center text-neutral-400">…and {preview.length - 50} more rows</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          <Button variant="primary" Icon={Upload} disabled={!file || importMutation.isPending} loading={importMutation.isPending} onClick={() => importMutation.mutate()}>
            Import
          </Button>
          {importMutation.isPending && progress && <ImportProgressBar processed={progress.processed} total={progress.total} />}
        </CardBody>
      </Card>

      {result && (
        <Card>
          <CardBody className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-success-700"><CheckCircle size={18} strokeWidth={1.75} /><span className="font-medium">{result.matched} matched</span></div>
            {result.flagged > 0 && <div className="flex items-center gap-2 text-warning-700"><AlertTriangle size={18} strokeWidth={1.75} /><span className="font-medium">{result.flagged} flagged</span></div>}
            <span className="text-neutral-500">{result.total} total rows</span>
          </CardBody>
        </Card>
      )}

      {activeBatch && activeBatch.flaggedEntries.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries" subtitle={`${activeBatch.flaggedEntries.length} entries need mapping`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b border-neutral-200 bg-neutral-50">{['Staff ID','Employee Name','Amount','Reason','Action'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                ))}</tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedEntries.map((entry, idx) => (
                    <tr key={`${entry.staffId}-${idx}`} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.staffId}</td>
                      <td className="px-4 py-2 text-neutral-700">{entry.employeeName}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(Number(entry.amount))}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.reason}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <button onClick={() => setResolveTarget(entry.staffId)} className="text-primary-600 hover:underline text-xs font-medium">Map to Staff</button>
                          <button onClick={() => dismissMutation.mutate(idx)} disabled={dismissMutation.isPending} className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium">Dismiss</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {aggregatedFlags.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries (All Pending Imports)" subtitle={`${aggregatedFlags.length} Staff IDs need mapping across one or more imports`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b border-neutral-200 bg-neutral-50">{['Staff ID', 'Employee Name', 'Occurrences', 'Action'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                ))}</tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {aggregatedFlags.map((flag) => (
                    <tr key={flag.staffId} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{flag.staffId}</td>
                      <td className="px-4 py-2 text-neutral-700">{flag.employeeName}</td>
                      <td className="px-4 py-2 text-neutral-500">{flag.occurrences} import{flag.occurrences === 1 ? '' : 's'}</td>
                      <td className="px-4 py-2"><button onClick={() => setBulkResolveTarget(flag.staffId)} className="text-primary-600 hover:underline text-xs font-medium">Map to Staff (all imports)</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Import History" />
        <CardBody noPadding>
          {!batchHistory?.data.length ? (
            <p className="px-5 py-4 text-sm text-neutral-400">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b border-neutral-200 bg-neutral-50">{['File','Matched','Flagged','Status',''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                ))}</tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">{batch.fileName}</td>
                      <td className="px-4 py-2 text-success-700 font-medium">{batch.matchedRows}</td>
                      <td className="px-4 py-2 text-warning-700 font-medium">{batch.flaggedRows}</td>
                      <td className="px-4 py-2"><Badge kind={statusKind[batch.status]}>{batch.status}</Badge></td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flaggedRows > 0 && <button onClick={() => setActiveBatch(batch)} className="text-primary-600 hover:underline text-xs font-medium">Resolve</button>}
                          {batch.flaggedRows > 0 && <button onClick={() => setClearTarget({ batchId: batch._id, fileName: batch.fileName })} className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium">Clear Flagged</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {resolveTarget && (
        <Modal open onClose={() => { setResolveTarget(null); setStaffSearch(''); setStaffOptions([]); }} title={`Map "${resolveTarget}" to Staff`} size="sm" iconKind="warning">
          <div className="mt-3 space-y-3">
            <Input placeholder="Search staff name or ID…" value={staffSearch} onChange={(e) => handleStaffSearch(e.target.value)} autoFocus />
            {staffOptions.length > 0 && (
              <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100 max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <li key={s._id}>
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast" onClick={() => resolveMutation.mutate({ originalId: resolveTarget, resolvedId: s._id })}>
                      <span className="font-medium text-neutral-900">{s.fullName}</span><span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {bulkResolveTarget && (
        <Modal open onClose={() => { setBulkResolveTarget(null); setStaffSearch(''); setStaffOptions([]); }} title={`Map "${bulkResolveTarget}" to Staff (all imports)`} size="sm" iconKind="warning">
          <div className="mt-3 space-y-3">
            <Input placeholder="Search staff name or ID…" value={staffSearch} onChange={(e) => handleStaffSearch(e.target.value)} autoFocus />
            {staffOptions.length > 0 && (
              <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100 max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <li key={s._id}>
                    <button className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast" disabled={bulkResolveMutation.isPending} onClick={() => bulkResolveMutation.mutate({ originalStaffId: bulkResolveTarget, resolvedId: s._id })}>
                      <span className="font-medium text-neutral-900">{s.fullName}</span><span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!clearTarget}
        title="Clear flagged entries?"
        body={`This clears all flagged rows for "${clearTarget?.fileName}" and marks the import completed. This does not undo any claims already recorded.`}
        confirmLabel="Clear Flagged"
        isPending={clearMutation.isPending}
        onConfirm={() => clearMutation.mutate(clearTarget!.batchId)}
        onClose={() => setClearTarget(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Prepare a small `.xlsx` test file with columns `Staff ID, Full Name, Claim Type, Month, Year, Amount, Sub Reason` (one Marriage row for an existing staff member, one Cessation row with a Sub Reason), upload it at `/claims/import`, and confirm: preview table renders, import succeeds, matched count is correct, and the new claims appear at `/claims` with status `Approved`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/claims/import"
git commit -m "feat(web): add Claims legacy-import page"
```

---

## Task 13: Frontend — manual Claim create form

**Files:**
- Create: `apps/web/src/app/(dashboard)/claims/new/page.tsx`
- Create: `apps/web/src/app/(dashboard)/claims/new/create-claim-client.tsx`
- Modify: `apps/web/src/lib/form-schemas.ts`

**Interfaces:**
- Consumes: `createClaim`, `getStaffClaimBalance` (Task 9); `searchStaff` (existing).

- [ ] **Step 1: Add the zod schema**

Edit `apps/web/src/lib/form-schemas.ts` — add near `contributionSchema`:
```typescript
export const claimSchema = z.object({
  staffId:   z.string().min(24, 'Select a staff member'),
  claimType: z.string().min(1, 'Required'),
  subReason: z.string().optional(),
  month:     z.coerce.number().min(1).max(12),
  year:      z.coerce.number().min(2000),
  amount:    z.coerce.number().min(1, 'Amount must be > 0'),
}).refine(
  (v) => v.claimType !== 'Cessation' || !!v.subReason,
  { message: 'Sub Reason is required for Cessation claims', path: ['subReason'] },
);

export type ClaimFormValues = z.infer<typeof claimSchema>;
```

- [ ] **Step 2: Write the page shell**

`apps/web/src/app/(dashboard)/claims/new/page.tsx`:
```typescript
import { Suspense } from 'react';
import CreateClaimClient from './create-claim-client';

export const metadata = { title: 'New Claim - Welfare Department' };

export default function NewClaimPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <a href="/claims" className="text-sm text-gray-500 hover:text-gray-700">← Claims</a>
        <h1 className="text-2xl font-semibold text-gray-900">New Welfare Claim</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading...</div>}>
        <CreateClaimClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Write the create-form client**

`apps/web/src/app/(dashboard)/claims/new/create-claim-client.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClaimType, CessationReason } from '@welfare/shared';
import type { IStaff } from '@welfare/shared';
import { createClaim, getStaffClaimBalance } from '@/lib/claims';
import { searchStaff } from '@/lib/staff';
import { claimSchema, type ClaimFormValues } from '@/lib/form-schemas';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function CreateClaimClient() {
  const router = useRouter();
  const now = new Date();
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<IStaff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<IStaff | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear() },
  });

  const watchClaimType = watch('claimType');
  const watchAmount = watch('amount');
  const watchStaffId = watch('staffId');

  const { data: balanceData } = useQuery({
    queryKey: ['claim-balance', watchStaffId],
    queryFn: () => getStaffClaimBalance(watchStaffId),
    enabled: !!watchStaffId && watchStaffId.length === 24,
  });

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 2) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data);
  }

  function selectStaff(staff: IStaff) {
    setSelectedStaff(staff);
    setValue('staffId', staff._id);
    setStaffSearch(staff.fullName);
    setStaffOptions([]);
  }

  const mutation = useMutation({
    mutationFn: (values: ClaimFormValues) => createClaim({
      staffId: values.staffId,
      claimType: values.claimType as ClaimType,
      subReason: values.subReason as CessationReason | undefined,
      month: values.month,
      year: values.year,
      amount: values.amount,
    }),
    onSuccess: () => {
      toast.success('Claim submitted for approval');
      router.push('/claims');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Submission failed'),
  });

  const balance = balanceData?.balance ?? null;
  const exceedsBalance = balance !== null && watchAmount > balance;

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardHeader title="Record Welfare Claim" />
        <CardBody>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="relative space-y-1.5">
              <label className="text-base font-medium text-neutral-700">Staff Member <span className="text-danger-500">*</span></label>
              <div className="relative">
                <Input placeholder="Search by name or staff ID…" value={staffSearch} onChange={(e) => handleStaffSearch(e.target.value)} />
                {staffOptions.length > 0 && (
                  <ul className="absolute z-10 w-full border border-neutral-200 bg-white rounded-sm shadow-floating max-h-48 overflow-y-auto mt-1">
                    {staffOptions.map((s) => (
                      <li key={s._id}>
                        <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 transition-colors" onClick={() => selectStaff(s)}>
                          <span className="font-medium text-neutral-900">{s.fullName}</span>
                          <span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <input type="hidden" {...register('staffId')} />
              {errors.staffId && <p className="text-sm text-danger-700">{errors.staffId.message}</p>}
              {selectedStaff && balance !== null && (
                <p className="text-xs text-neutral-500">
                  Selected: {selectedStaff.fullName} ({selectedStaff.staffId}) — Available balance: <strong className="font-mono">{fmtGHS(balance)}</strong>
                </p>
              )}
            </div>

            <Field label="Claim Type" required error={errors.claimType?.message}>
              <Select
                {...register('claimType')}
                options={[{ value: '', label: 'Select type…' }, ...Object.values(ClaimType).map((t) => ({ value: t, label: t }))]}
              />
            </Field>

            {watchClaimType === ClaimType.Cessation && (
              <Field label="Sub Reason" required error={errors.subReason?.message}>
                <Select
                  {...register('subReason')}
                  options={[{ value: '', label: 'Select reason…' }, ...Object.values(CessationReason).map((r) => ({ value: r, label: r }))]}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Month" required>
                <Select {...register('month')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
              </Field>
              <Field label="Year" required>
                <Input {...register('year')} type="number" />
              </Field>
            </div>

            <Field label="Amount" required error={errors.amount?.message}>
              <Input {...register('amount')} type="number" min="1" prefix="₵" error={!!errors.amount} />
            </Field>

            {exceedsBalance && (
              <div className="bg-danger-50 border border-danger-200 rounded-sm p-3 text-sm text-danger-700">
                This amount exceeds the staff member&apos;s available balance of {fmtGHS(balance!)}. The claim cannot be submitted.
              </div>
            )}

            <Button type="submit" variant="primary" loading={isSubmitting || mutation.isPending} disabled={exceedsBalance}>
              Submit Claim
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser**

At `/claims/new`, select a staff member with a positive contribution balance, submit a Marriage claim below balance — confirm success toast and redirect to `/claims` with the new claim showing status `Pending`. Then try an amount exceeding balance and confirm the submit button disables with the warning shown. Then select claim type Cessation and confirm the Sub Reason field appears and is required.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/claims/new" apps/web/src/lib/form-schemas.ts
git commit -m "feat(web): add manual Claim creation form with balance guard"
```

---

## Task 14: Frontend — contribution statement claims table

**Files:**
- Modify: `apps/web/src/lib/reports.ts`
- Modify: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

**Interfaces:**
- Consumes: `claimYears` and `kpis.totalClaims` now returned by `GET /reports/contributions/staff-statement` (Task 7).

- [ ] **Step 1: Extend the `StaffStatement` type in `lib/reports.ts`**

Edit `apps/web/src/lib/reports.ts` — add a new interface and extend `StaffStatement`:
```typescript
export interface StaffStatementClaimYear {
  year: number;
  claims: Array<{ claimType: string; amount: number }>;
}

export interface StaffStatement {
  staff: { _id: string; fullName: string; staffId: string; email?: string };
  kpis: { totalPaid: number; totalExpected: number; missedMonths: number; totalSurplus: number; collectionRate: number; totalOffsets?: number; totalClaims?: number };
  years: number[];
  rows: StaffStatementRow[];
  claimYears?: StaffStatementClaimYear[];
}
```

- [ ] **Step 2: Render the claims table in `StaffStatementPanel`**

Edit `apps/web/src/app/(dashboard)/reports/reports-client.tsx` — inside `StaffStatementPanel`, destructure `claimYears` alongside `kpis, rows, years` (around line 525):
```typescript
  const { kpis, rows, years, claimYears } = data ?? {};
```
Add a KPI tile after the existing "Loan Deductions" tile (around line 631, right before the closing `</div>` of the `.grid` KPI block):
```tsx
            {(kpis.totalClaims ?? 0) > 0 && (
              <KpiCard
                label="Welfare Claims"
                value={fmtGHS(kpis.totalClaims ?? 0)}
                subtext="Deducted from contribution balance"
                icon={AlertCircle}
                iconKind="danger"
              />
            )}
```
Insert the claims table right after the crosstab table's closing `</div>` and before the "Status legend" block (after line 706 in the pre-edit file):
```tsx
          {claimYears && claimYears.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-primary-600 text-white">
                    <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap w-16">Year</th>
                    <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">Claim Type</th>
                    <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {claimYears.flatMap((yearRow) =>
                    yearRow.claims.map((c, i) => (
                      <tr key={`${yearRow.year}-${i}`} className="hover:bg-neutral-50">
                        {i === 0 && (
                          <td rowSpan={yearRow.claims.length} className="px-4 py-2 font-bold text-neutral-700 bg-neutral-50 align-top">
                            {yearRow.year}
                          </td>
                        )}
                        <td className="px-4 py-2 text-neutral-700">{c.claimType}</td>
                        <td className="px-4 py-2 text-right font-mono tabular text-neutral-900">{fmtGHS(c.amount)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-50 border-t-2 border-neutral-200">
                    <td colSpan={2} className="px-4 py-2 text-right font-bold text-neutral-700 text-xs uppercase tracking-wide">Total Welfare Claims</td>
                    <td className="px-4 py-2 text-right font-bold font-mono tabular text-neutral-900">{fmtGHS(kpis.totalClaims ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
```

- [ ] **Step 3: Verify in browser**

At `/reports` → Contribution Statement, select a staff member who has at least one `Approved` claim in two different years plus one year with two claim types — confirm the Year cell only appears once per year (native `rowSpan`), and the total row sums correctly against the new "Welfare Claims" KPI tile.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/reports.ts apps/web/src/app/\(dashboard\)/reports/reports-client.tsx
git commit -m "feat(web): show welfare claims table on contribution statement"
```

---

## Task 15: Frontend — fund summary claims section

**Files:**
- Modify: `apps/web/src/lib/reports.ts`
- Modify: `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx`

**Interfaces:**
- Consumes: `claims` and `claimsBreakdown` now returned by `GET /reports/fund-summary` (Task 8); `downloadFundSummaryFile('claims', ...)` needs its `sub` union type widened.

- [ ] **Step 1: Widen `downloadFundSummaryFile`'s `sub` parameter**

Edit `apps/web/src/lib/reports.ts` — change the `downloadFundSummaryFile` signature:
```typescript
export async function downloadFundSummaryFile(
  sub: 'contributions' | 'loans' | 'defaults' | 'claims',
  params: FundSummaryParams,
  format: 'csv' | 'pdf',
): Promise<void> {
```
(body unchanged — it already builds the URL generically from `sub`).

- [ ] **Step 2: Add the claims column definitions and section**

Edit `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx` — add the import and column helper near the other `IFundSummary*` imports:
```typescript
import type {
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
  IFundSummaryDefaultRow,
  IFundSummaryDiscountRow,
  IFundSummaryClaimsBreakdownRow,
} from '@welfare/shared';
```
Add a column helper alongside `colDiscount`:
```typescript
const colClaim = createColumnHelper<IFundSummaryClaimsBreakdownRow>();
const COLS_CLAIMS = [
  colClaim.accessor('claimType',   { header: 'Claim Type' }),
  colClaim.accessor('count',       { header: 'Count' }),
  colClaim.accessor('totalAmount', { header: 'Total (GHS)', cell: i => fmtGHS(i.getValue()) }),
];
```
Add a new `Section` after "Loans Breakdown" and before "Defaulted Loans Detail" (matching the existing ordering convention — contributions, loans, then this):
```tsx
            <Section
              title="Welfare Claims Breakdown"
              downloadLinks={[
                { label: 'CSV', onClick: () => downloadFundSummaryFile('claims', params, 'csv') },
                { label: 'PDF', onClick: () => downloadFundSummaryFile('claims', params, 'pdf') },
              ]}
            >
              <SummaryTable columns={COLS_CLAIMS} data={data.claimsBreakdown} />
            </Section>
```

- [ ] **Step 3: Verify in browser**

At `/reports` → Fund Summary, for a period containing at least one approved claim, confirm the "Welfare Claims Breakdown" section renders with correct counts/totals and both CSV and PDF downloads succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/reports.ts apps/web/src/app/\(dashboard\)/reports/fund-summary-panel.tsx
git commit -m "feat(web): add welfare claims breakdown to fund summary report"
```

---

## Final verification

- [ ] Run the full API test suite: `npm run test -w @welfare/api` — all suites green, including the new `claims/*` and updated `reports.service.spec.ts` suites.
- [ ] Run the shared package build: `npm run build -w @welfare/shared` — no type errors.
- [ ] Run the web build: `npm run build -w @welfare/web` — no type errors.
- [ ] Manual end-to-end pass: legacy-import a small claims file → confirm claims show as `Approved` in `/claims` and reduce the staff's balance on `/claims/new` → submit a new claim near the remaining balance and confirm the hard-block behavior at both submission and (for a second reviewer account) approval → confirm the contribution statement and fund summary reports both reflect the claims correctly, including PDF/CSV downloads.
