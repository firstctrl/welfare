# Phase 4 — Contributions Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record and track monthly staff contributions via Excel (payroll import) and manual/lump-sum entry, with surplus carry-forward logic and an officer-facing web UI.

**Architecture:** NestJS ContributionsModule owns two services — ContributionService (payment processing + queries) and ImportService (Excel parse + batch management). Both share a StaffService dependency (imported via StaffModule) for staff lookup. Core payment logic is a pure calculation function to simplify testing. Web uses TanStack Query for fetching, react-hook-form + zod for forms, and xlsx (SheetJS) client-side for import preview.

**Tech Stack:** NestJS 10, Mongoose, SheetJS (`xlsx`), class-validator/transformer, Next.js 14 App Router, TanStack Query v5, react-hook-form, zod, sonner.

---

## File Structure

### New — API
- `apps/api/src/contributions/schemas/contribution.schema.ts` — Mongoose schema; compound unique index (staffId, month, year)
- `apps/api/src/contributions/schemas/import-batch.schema.ts` — Mongoose schema; stores flaggedEntries subdocument array
- `apps/api/src/contributions/dto/manual-entry.dto.ts` — POST /contributions/manual body
- `apps/api/src/contributions/dto/resolve-flagged.dto.ts` — PATCH /contributions/import/:id/resolve body
- `apps/api/src/contributions/dto/contribution-query.dto.ts` — GET /contributions filter params
- `apps/api/src/contributions/contributions.service.ts` — processPayment, processLumpSum, queries, summary
- `apps/api/src/contributions/contributions.service.spec.ts` — unit tests
- `apps/api/src/contributions/import.service.ts` — xlsx parse, importBatch CRUD
- `apps/api/src/contributions/contributions.controller.ts` — all HTTP routes
- `apps/api/src/contributions/contributions.module.ts` — module wiring

### Modified — API
- `apps/api/src/staff/staff.service.ts` — add `findByStaffId(staffId: string)` method
- `apps/api/src/staff/staff.service.spec.ts` — add test for `findByStaffId`
- `apps/api/src/app.module.ts` — import ContributionsModule

### New — Web
- `apps/web/src/lib/contributions.ts` — typed API client functions
- `apps/web/src/app/(dashboard)/contributions/page.tsx` — stub landing page for /contributions
- `apps/web/src/app/(dashboard)/contributions/import/page.tsx` — server shell
- `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx` — dropzone, preview, results, flagged table
- `apps/web/src/app/(dashboard)/contributions/manual/page.tsx` — server shell
- `apps/web/src/app/(dashboard)/contributions/manual/manual-entry-client.tsx` — staff picker, amount form, preview

### Modified — Web
- `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx` — populate Contributions tab with ledger table

---

## Contribution Processing Logic

**Core formula** (pure, no I/O):
```
totalCovered  = totalPaid + prevSurplus
status        = totalCovered >= expectedAmount ? Paid : Partial
surplusCF     = max(0, totalCovered - expectedAmount)
```

**Lump sum split algorithm** (iterates forward from earliest unpaid month):
```
remaining = amount
prevSurplus = DB surplus from month before firstMonth
for each month in [firstMonth, firstMonth+1, ...]:
  netNeeded      = max(0, expectedAmount - prevSurplus)
  paidThisMonth  = min(remaining, netNeeded)
  totalCovered   = paidThisMonth + prevSurplus
  status         = totalCovered >= expectedAmount ? Paid : Partial
  surplusCF      = max(0, totalCovered - expectedAmount)
  save { paidAmount: paidThisMonth, surplusCarriedForward: surplusCF, status }
  remaining     -= paidThisMonth
  prevSurplus    = surplusCF
  if remaining == 0: break
```

---

## Task 1: Install Dependencies

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install xlsx on API**

```bash
cd apps/api && npm install xlsx
```

- [ ] **Step 2: Install xlsx on Web**

```bash
cd apps/web && npm install xlsx
```

- [ ] **Step 3: Verify installations**

```bash
node -e "require('xlsx'); console.log('api xlsx ok')" && cd apps/web && node -e "const x = require('xlsx'); console.log('web xlsx ok')"
```
Expected: `api xlsx ok` and `web xlsx ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/web/package.json apps/web/package-lock.json
git commit -m "chore: install xlsx (SheetJS) for API and web"
```

---

## Task 2: Schemas

**Files:**
- Create: `apps/api/src/contributions/schemas/contribution.schema.ts`
- Create: `apps/api/src/contributions/schemas/import-batch.schema.ts`

- [ ] **Step 1: Create contribution.schema.ts**

```typescript
// apps/api/src/contributions/schemas/contribution.schema.ts
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
  @Prop() importBatchId?: string;
  @Prop({ required: true }) recordedBy!: string;
}

export const ContributionSchema = SchemaFactory.createForClass(Contribution);
ContributionSchema.index({ staffId: 1, month: 1, year: 1 }, { unique: true });
ContributionSchema.index({ status: 1 });
ContributionSchema.index({ month: 1, year: 1 });
```

- [ ] **Step 2: Create import-batch.schema.ts**

```typescript
// apps/api/src/contributions/schemas/import-batch.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ImportBatchStatus } from '@welfare/shared';

export type ImportBatchDocument = HydratedDocument<ImportBatch>;

@Schema({ _id: false })
class FlaggedEntry {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) employeeName!: string;
  @Prop({ required: true }) amount!: number;
  @Prop({ required: true }) reason!: string;
}

@Schema({ timestamps: true, collection: 'import_batches' })
export class ImportBatch {
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) uploadedBy!: string;
  @Prop({ required: true, min: 0 }) totalRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) matchedRows!: number;
  @Prop({ required: true, min: 0, default: 0 }) flaggedRows!: number;
  @Prop({ type: [FlaggedEntry], default: [] }) flaggedEntries!: FlaggedEntry[];
  @Prop({ required: true, enum: ImportBatchStatus, default: ImportBatchStatus.Pending })
  status!: ImportBatchStatus;
}

export const ImportBatchSchema = SchemaFactory.createForClass(ImportBatch);
ImportBatchSchema.index({ status: 1 });
ImportBatchSchema.index({ month: 1, year: 1 });
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/contributions/schemas/
git commit -m "feat(api): contribution and import-batch Mongoose schemas"
```

---

## Task 3: API DTOs

**Files:**
- Create: `apps/api/src/contributions/dto/manual-entry.dto.ts`
- Create: `apps/api/src/contributions/dto/resolve-flagged.dto.ts`
- Create: `apps/api/src/contributions/dto/contribution-query.dto.ts`

- [ ] **Step 1: Create manual-entry.dto.ts**

```typescript
// apps/api/src/contributions/dto/manual-entry.dto.ts
import { IsMongoId, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ManualEntryDto {
  @IsMongoId() staffId!: string;
  @IsNumber() @Min(0) @Type(() => Number) amount!: number;
  @IsNumber() @Min(1) @Max(12) @Type(() => Number) month!: number;
  @IsNumber() @Min(2000) @Type(() => Number) year!: number;
  @IsString() @IsOptional() note?: string;
}
```

- [ ] **Step 2: Create resolve-flagged.dto.ts**

```typescript
// apps/api/src/contributions/dto/resolve-flagged.dto.ts
import { IsMongoId, IsString } from 'class-validator';

export class ResolveFlaggedDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedStaffMongoId!: string;
}
```

- [ ] **Step 3: Create contribution-query.dto.ts**

```typescript
// apps/api/src/contributions/dto/contribution-query.dto.ts
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContributionStatus } from '@welfare/shared';

export class ContributionQueryDto {
  @IsOptional() @IsString() staffId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(2000) year?: number;
  @IsOptional() @IsEnum(ContributionStatus) status?: ContributionStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) limit?: number = 20;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/contributions/dto/
git commit -m "feat(api): contribution DTOs (manual entry, resolve-flagged, query)"
```

---

## Task 4: StaffService.findByStaffId + test

**Files:**
- Modify: `apps/api/src/staff/staff.service.ts`
- Modify: `apps/api/src/staff/staff.service.spec.ts`

- [ ] **Step 1: Add findByStaffId test (write failing test first)**

Open `apps/api/src/staff/staff.service.spec.ts`. Add this test inside the `describe('StaffService', ...)` block after the existing tests:

```typescript
  describe('findByStaffId', () => {
    it('returns staff document when staffId field matches', async () => {
      mockStaffModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(baseStaff) });
      const result = await service.findByStaffId('STF001');
      expect(result).toBe(baseStaff);
      expect(mockStaffModel.findOne).toHaveBeenCalledWith({ staffId: 'STF001' });
    });

    it('returns null when staffId field not found', async () => {
      mockStaffModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const result = await service.findByStaffId('NOTEXIST');
      expect(result).toBeNull();
    });
  });
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
cd apps/api && npx jest staff.service.spec.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|findByStaffId"
```
Expected: `TypeError: service.findByStaffId is not a function`.

- [ ] **Step 3: Add findByStaffId to staff.service.ts**

Open `apps/api/src/staff/staff.service.ts`. Add this method after `findById`:

```typescript
  async findByStaffId(staffId: string): Promise<StaffDocument | null> {
    return this.staffModel.findOne({ staffId }).exec();
  }
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
cd apps/api && npx jest staff.service.spec.ts --no-coverage 2>&1 | tail -6
```
Expected: `Tests: 14 passed, 14 total`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/staff/staff.service.ts apps/api/src/staff/staff.service.spec.ts
git commit -m "feat(api): StaffService.findByStaffId for import lookup"
```

---

## Task 5: ContributionService + Tests

**Files:**
- Create: `apps/api/src/contributions/contributions.service.spec.ts`
- Create: `apps/api/src/contributions/contributions.service.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/contributions/contributions.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ContributionsService } from './contributions.service';
import { Contribution } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionStatus, ContributionSource } from '@welfare/shared';

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockFind = jest.fn();
const mockCountDocuments = jest.fn();
const mockAggregate = jest.fn();

const mockContributionModel = {
  findOne: mockFindOne,
  findOneAndUpdate: mockFindOneAndUpdate,
  find: mockFind,
  countDocuments: mockCountDocuments,
  aggregate: mockAggregate,
};

const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({
    MONTHLY_CONTRIBUTION_AMOUNT: { value: '3000' },
    PENALTY_TYPE: { value: 'Percentage' },
    PENALTY_VALUE: { value: '5' },
  }),
};

const mockAuditService = { log: jest.fn() };

describe('ContributionsService', () => {
  let service: ContributionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionsService,
        { provide: getModelToken(Contribution.name), useValue: mockContributionModel },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get<ContributionsService>(ContributionsService);
    jest.clearAllMocks();
    mockConfigService.getAll.mockResolvedValue({
      MONTHLY_CONTRIBUTION_AMOUNT: { value: '3000' },
      PENALTY_TYPE: { value: 'Percentage' },
      PENALTY_VALUE: { value: '5' },
    });
  });

  describe('calculatePaymentResult (pure logic)', () => {
    it('marks Paid when totalCovered >= expectedAmount', () => {
      // Access via service — it's a public helper
      const result = service.calculatePaymentResult(0, 3000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('marks Partial when totalCovered < expectedAmount', () => {
      const result = service.calculatePaymentResult(0, 1000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Partial);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('calculates surplus when overpaid', () => {
      const result = service.calculatePaymentResult(0, 5000, 0, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(2000);
    });

    it('uses prevSurplus to reduce amount needed', () => {
      // prevSurplus=500, expected=3000 → need 2500 more
      const result = service.calculatePaymentResult(0, 2500, 500, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(0);
    });

    it('prevSurplus alone can cover full expected (no cash needed)', () => {
      // prevSurplus=3500 >= expected=3000 → Paid with surplus even without payment
      const result = service.calculatePaymentResult(0, 0, 3500, 3000);
      expect(result.status).toBe(ContributionStatus.Paid);
      expect(result.surplusCarriedForward).toBe(500);
    });
  });

  describe('processPayment', () => {
    it('uses prevSurplus from previous month record', async () => {
      mockFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }) // no existing for current month
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ surplusCarriedForward: 500 }) }); // prev month has 500 surplus
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      const result = await service.processPayment(
        'staff-mongo-id', 3, 2025, 2500, ContributionSource.PayrollImport, 'actor-id', 'Actor',
      );
      expect(result).toBe(savedDoc);
      // With prevSurplus=500 and payment=2500: totalCovered=3000=expectedAmount → Paid, surplus=0
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { staffId: 'staff-mongo-id', month: 3, year: 2025 },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ContributionStatus.Paid,
            surplusCarriedForward: 0,
          }),
        }),
        expect.anything(),
      );
    });

    it('marks Partial when payment is insufficient', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      await service.processPayment('s1', 1, 2025, 1000, ContributionSource.ManualEntry, 'uid', 'U');
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: ContributionStatus.Partial }),
        }),
        expect.anything(),
      );
    });
  });

  describe('processLumpSum', () => {
    it('processes single month when amount covers only one month', async () => {
      // prevSurplus = 0, amount = 2500 < 3000
      mockFindOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([]) }) // find partial/missed → empty
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }); // prevSurplus lookup
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      const savedDoc = { _id: { toString: () => 'c-id' }, surplusCarriedForward: 0, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });

      const results = await service.processLumpSum('s1', 2500, 3, 2025, 'uid', 'U');
      expect(results).toHaveLength(1);
    });

    it('splits across multiple months when amount is large', async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { month: 1, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
          { month: 2, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
        ]),
      });
      // prevSurplus for month 1 = 0
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      // Each month saves and returns surplus = 0 (exact payment)
      mockFindOneAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ surplusCarriedForward: 0, toObject: jest.fn(() => ({})) }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ surplusCarriedForward: 0, toObject: jest.fn(() => ({})) }) });

      const results = await service.processLumpSum('s1', 6000, 1, 2025, 'uid', 'U');
      expect(results).toHaveLength(2);
      expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/api && npx jest contributions.service.spec.ts --no-coverage 2>&1 | grep -E "PASS|FAIL|error"
```
Expected: `Cannot find module './contributions.service'`.

- [ ] **Step 3: Create contributions.service.ts**

```typescript
// apps/api/src/contributions/contributions.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity, ContributionSource, ContributionStatus, PaginatedResult } from '@welfare/shared';
import { Contribution, ContributionDocument } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionQueryDto } from './dto/contribution-query.dto';

type ConfigMap = Record<string, { value: string }>;

function getPrevMonthYear(month: number, year: number): { month: number; year: number } {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

function getNextMonthYear(month: number, year: number): { month: number; year: number } {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
}

@Injectable()
export class ContributionsService {
  constructor(
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
  ) {}

  calculatePaymentResult(
    existingPaid: number,
    newPayment: number,
    prevSurplus: number,
    expectedAmount: number,
  ): { totalPaid: number; surplusCarriedForward: number; status: ContributionStatus } {
    const totalPaid = existingPaid + newPayment;
    const totalCovered = totalPaid + prevSurplus;
    const status = totalCovered >= expectedAmount ? ContributionStatus.Paid : ContributionStatus.Partial;
    const surplusCarriedForward = Math.max(0, totalCovered - expectedAmount);
    return { totalPaid, surplusCarriedForward, status };
  }

  private async getExpectedAmount(config: ConfigMap): Promise<number> {
    return parseFloat(config['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? '0');
  }

  private async getPrevSurplus(staffId: string, month: number, year: number): Promise<number> {
    const { month: pm, year: py } = getPrevMonthYear(month, year);
    const prev = await this.contributionModel.findOne({ staffId, month: pm, year: py }).exec();
    return prev?.surplusCarriedForward ?? 0;
  }

  async processPayment(
    staffId: string,
    month: number,
    year: number,
    newPayment: number,
    source: ContributionSource,
    actorId: string,
    actorName: string,
    importBatchId?: string,
  ): Promise<ContributionDocument> {
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const expectedAmount = await this.getExpectedAmount(config);
    const existing = await this.contributionModel.findOne({ staffId, month, year }).exec();
    const existingPaid = existing?.paidAmount ?? 0;
    const prevSurplus = await this.getPrevSurplus(staffId, month, year);
    const { totalPaid, surplusCarriedForward, status } = this.calculatePaymentResult(
      existingPaid, newPayment, prevSurplus, expectedAmount,
    );

    const result = await this.contributionModel
      .findOneAndUpdate(
        { staffId, month, year },
        { $set: { expectedAmount, paidAmount: totalPaid, surplusCarriedForward, status, source, recordedBy: actorName, importBatchId } },
        { new: true, upsert: true, runValidators: true },
      )
      .exec();

    if (!result) throw new NotFoundException('Failed to upsert contribution');
    this.auditService.log(
      actorId, actorName, AuditAction.RecordPayment, AuditEntity.Contribution,
      result._id.toString(), existing?.toObject() as unknown as Record<string, unknown>,
      result.toObject() as unknown as Record<string, unknown>,
    );
    return result;
  }

  async processLumpSum(
    staffId: string,
    amount: number,
    startMonth: number,
    startYear: number,
    actorId: string,
    actorName: string,
  ): Promise<ContributionDocument[]> {
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const expectedAmount = await this.getExpectedAmount(config);

    const unpaidMonths = await this.contributionModel
      .find({ staffId, status: { $in: [ContributionStatus.Missed, ContributionStatus.Partial] } })
      .sort({ year: 1, month: 1 })
      .exec();

    const monthsToProcess: { month: number; year: number; existingPaid: number }[] =
      unpaidMonths.length > 0
        ? unpaidMonths.map((c) => ({ month: c.month, year: c.year, existingPaid: c.paidAmount }))
        : [{ month: startMonth, year: startYear, existingPaid: 0 }];

    let remaining = amount;
    let prevSurplus = await this.getPrevSurplus(staffId, monthsToProcess[0].month, monthsToProcess[0].year);
    const results: ContributionDocument[] = [];

    for (const target of monthsToProcess) {
      if (remaining <= 0) break;
      const netNeeded = Math.max(0, expectedAmount - prevSurplus);
      const paidThisMonth = Math.min(remaining, netNeeded);
      const { surplusCarriedForward, status } = this.calculatePaymentResult(
        0, paidThisMonth, prevSurplus, expectedAmount,
      );

      const result = await this.contributionModel
        .findOneAndUpdate(
          { staffId, month: target.month, year: target.year },
          { $set: { expectedAmount, paidAmount: paidThisMonth, surplusCarriedForward, status, source: ContributionSource.LumpSum, recordedBy: actorName } },
          { new: true, upsert: true, runValidators: true },
        )
        .exec();

      if (result) {
        results.push(result);
        this.auditService.log(
          actorId, actorName, AuditAction.RecordPayment, AuditEntity.Contribution,
          result._id.toString(), undefined, result.toObject() as unknown as Record<string, unknown>,
        );
      }
      remaining -= paidThisMonth;
      prevSurplus = surplusCarriedForward;
    }
    return results;
  }

  async findAll(query: ContributionQueryDto): Promise<PaginatedResult<ContributionDocument>> {
    const { page = 1, limit = 20, staffId, month, year, status } = query;
    const filter: Record<string, unknown> = {};
    if (staffId) filter.staffId = staffId;
    if (month) filter.month = month;
    if (year) filter.year = year;
    if (status) filter.status = status;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.contributionModel.find(filter).sort({ year: -1, month: -1 }).skip(skip).limit(limit).exec(),
      this.contributionModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByStaff(staffId: string): Promise<ContributionDocument[]> {
    return this.contributionModel.find({ staffId }).sort({ year: -1, month: -1 }).exec();
  }

  async getSummary(month: number, year: number): Promise<{
    totalExpected: number;
    totalPaid: number;
    totalSurplus: number;
    countPaid: number;
    countPartial: number;
    countMissed: number;
  }> {
    const [agg] = await this.contributionModel.aggregate([
      { $match: { month, year } },
      {
        $group: {
          _id: null,
          totalExpected: { $sum: '$expectedAmount' },
          totalPaid:     { $sum: '$paidAmount' },
          totalSurplus:  { $sum: '$surplusCarriedForward' },
          countPaid:     { $sum: { $cond: [{ $eq: ['$status', ContributionStatus.Paid] }, 1, 0] } },
          countPartial:  { $sum: { $cond: [{ $eq: ['$status', ContributionStatus.Partial] }, 1, 0] } },
          countMissed:   { $sum: { $cond: [{ $eq: ['$status', ContributionStatus.Missed] }, 1, 0] } },
        },
      },
    ]).exec();
    return agg ?? { totalExpected: 0, totalPaid: 0, totalSurplus: 0, countPaid: 0, countPartial: 0, countMissed: 0 };
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/api && npx jest contributions.service.spec.ts --no-coverage 2>&1 | tail -8
```
Expected: all tests pass (some mocking adjustments may be needed — if a test fails, check mock `.exec()` chain is consistent with the service's method chain).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contributions/contributions.service.ts apps/api/src/contributions/contributions.service.spec.ts
git commit -m "feat(api): ContributionsService — processPayment, processLumpSum, queries"
```

---

## Task 6: ImportService

**Files:**
- Create: `apps/api/src/contributions/import.service.ts`

- [ ] **Step 1: Create import.service.ts**

```typescript
// apps/api/src/contributions/import.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, ContributionSource, ImportBatchStatus, PaginatedResult } from '@welfare/shared';
import { ImportBatch, ImportBatchDocument } from './schemas/import-batch.schema';
import { ContributionsService } from './contributions.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';

interface ExcelRow {
  'Staff ID'?: string;
  'Employee Name'?: string;
  Month?: number;
  Year?: number;
  Amount?: number;
}

@Injectable()
export class ImportService {
  constructor(
    @InjectModel(ImportBatch.name) private readonly batchModel: Model<ImportBatchDocument>,
    private readonly contributionsService: ContributionsService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    monthOverride: number | undefined,
    yearOverride: number | undefined,
    actorId: string,
    actorName: string,
  ): Promise<{ batchId: string; matched: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const firstRow = rows[0];
    const month = monthOverride ?? Number(firstRow.Month);
    const year = yearOverride ?? Number(firstRow.Year);
    if (!month || month < 1 || month > 12) throw new BadRequestException('Invalid or missing Month');
    if (!year || year < 2000) throw new BadRequestException('Invalid or missing Year');

    const batch = await this.batchModel.create({
      month, year, fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    let matched = 0;
    const flaggedEntries: { staffId: string; employeeName: string; amount: number; reason: string }[] = [];

    for (const row of rows) {
      const rawStaffId = String(row['Staff ID'] ?? '').trim();
      const employeeName = String(row['Employee Name'] ?? '').trim();
      const amount = Number(row.Amount ?? 0);

      if (!rawStaffId) {
        flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Missing Staff ID' });
        continue;
      }

      const staff = await this.staffService.findByStaffId(rawStaffId);
      if (!staff) {
        flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Staff ID not found' });
        continue;
      }

      await this.contributionsService.processPayment(
        staff._id.toString(), month, year, amount,
        ContributionSource.PayrollImport, actorId, actorName, batchId,
      );
      matched++;
    }

    const status = flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await this.batchModel.findByIdAndUpdate(batchId, {
      $set: { matchedRows: matched, flaggedRows: flaggedEntries.length, flaggedEntries, status },
    }).exec();

    this.auditService.log(
      actorId, actorName, AuditAction.Import, AuditEntity.ImportBatch, batchId,
    );

    return { batchId, matched, flagged: flaggedEntries.length, total: rows.length };
  }

  async getBatch(batchId: string): Promise<ImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<ImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async resolveFlagged(
    batchId: string,
    originalStaffId: string,
    resolvedStaffMongoId: string,
    actorId: string,
    actorName: string,
  ): Promise<ImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    const entryIndex = batch.flaggedEntries.findIndex((e) => e.staffId === originalStaffId);
    if (entryIndex === -1) throw new NotFoundException(`Flagged entry ${originalStaffId} not found`);

    const entry = batch.flaggedEntries[entryIndex];
    await this.contributionsService.processPayment(
      resolvedStaffMongoId, batch.month, batch.year, entry.amount,
      ContributionSource.PayrollImport, actorId, actorName, batchId,
    );

    batch.flaggedEntries.splice(entryIndex, 1);
    batch.matchedRows += 1;
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();

    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }
}
```

- [ ] **Step 2: Build check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/contributions/import.service.ts
git commit -m "feat(api): ImportService — Excel parse, batch management, resolve-flagged"
```

---

## Task 7: ContributionController + Module + AppModule

**Files:**
- Create: `apps/api/src/contributions/contributions.controller.ts`
- Create: `apps/api/src/contributions/contributions.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create contributions.controller.ts**

```typescript
// apps/api/src/contributions/contributions.controller.ts
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ContributionsService } from './contributions.service';
import { ImportService } from './import.service';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { ResolveFlaggedDto } from './dto/resolve-flagged.dto';
import { ContributionQueryDto } from './dto/contribution-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('contributions')
export class ContributionsController {
  constructor(
    private readonly contributionsService: ContributionsService,
    private readonly importService: ImportService,
  ) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('month') month?: string,
    @Body('year') year?: string,
    @CurrentUser() user?: { sub: string; displayName: string },
    @Req() _req?: Request,
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.importService.processImport(
      file.buffer,
      file.originalname,
      month ? parseInt(month, 10) : undefined,
      year ? parseInt(year, 10) : undefined,
      user?.sub ?? 'system',
      user?.displayName ?? 'system',
    );
  }

  @Get('import')
  listBatches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listBatches(Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('import/:batchId')
  getBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/resolve')
  resolveFlagged(
    @Param('batchId') batchId: string,
    @Body() dto: ResolveFlaggedDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveFlagged(
      batchId, dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName,
    );
  }

  @Post('manual')
  async manualEntry(
    @Body() dto: ManualEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.contributionsService.processLumpSum(
      dto.staffId, dto.amount, dto.month, dto.year, user.sub, user.displayName,
    );
  }

  @Get()
  findAll(@Query() query: ContributionQueryDto) {
    return this.contributionsService.findAll(query);
  }

  @Get('summary')
  getSummary(@Query('month') month: string, @Query('year') year: string) {
    return this.contributionsService.getSummary(parseInt(month, 10), parseInt(year, 10));
  }

  @Get('staff/:staffId')
  getByStaff(@Param('staffId') staffId: string) {
    return this.contributionsService.findByStaff(staffId);
  }
}
```

- [ ] **Step 2: Create contributions.module.ts**

```typescript
// apps/api/src/contributions/contributions.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { ImportService } from './import.service';
import { Contribution, ContributionSchema } from './schemas/contribution.schema';
import { ImportBatch, ImportBatchSchema } from './schemas/import-batch.schema';
import { SystemConfigModule } from '../system-config/system-config.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contribution.name, schema: ContributionSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema },
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

- [ ] **Step 3: Register in app.module.ts**

Open `apps/api/src/app.module.ts`. Add:

```typescript
import { ContributionsModule } from './contributions/contributions.module';
```

And add `ContributionsModule` to the `imports` array after `StaffModule`.

- [ ] **Step 4: Build + test**

```bash
cd apps/api && npx tsc --noEmit && npx jest --no-coverage 2>&1 | tail -8
```
Expected: no TypeScript errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contributions/ apps/api/src/app.module.ts
git commit -m "feat(api): ContributionsController, Module, registered in AppModule"
```

---

## Task 8: Web lib/contributions.ts

**Files:**
- Create: `apps/web/src/lib/contributions.ts`

- [ ] **Step 1: Create contributions.ts**

```typescript
// apps/web/src/lib/contributions.ts
import { apiClient } from './api-client';
import type { IContribution, IImportBatch, PaginatedResult } from '@welfare/shared';

export interface ContributionFilters {
  staffId?: string;
  month?: number;
  year?: number;
  status?: string;
  page?: number;
  limit?: number;
}

export interface ContributionSummary {
  totalExpected: number;
  totalPaid: number;
  totalSurplus: number;
  countPaid: number;
  countPartial: number;
  countMissed: number;
}

export interface ImportResult {
  batchId: string;
  matched: number;
  flagged: number;
  total: number;
}

export async function listContributions(
  filters: ContributionFilters = {},
): Promise<PaginatedResult<IContribution>> {
  const { data } = await apiClient.get('/contributions', { params: filters });
  return data;
}

export async function getContributionsByStaff(staffId: string): Promise<IContribution[]> {
  const { data } = await apiClient.get(`/contributions/staff/${staffId}`);
  return data;
}

export async function getContributionSummary(
  month: number,
  year: number,
): Promise<ContributionSummary> {
  const { data } = await apiClient.get('/contributions/summary', { params: { month, year } });
  return data;
}

export async function importContributions(
  file: File,
  month?: number,
  year?: number,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (month) form.append('month', String(month));
  if (year) form.append('year', String(year));
  const { data } = await apiClient.post('/contributions/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listImportBatches(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<IImportBatch>> {
  const { data } = await apiClient.get('/contributions/import', { params: { page, limit } });
  return data;
}

export async function getImportBatch(batchId: string): Promise<IImportBatch> {
  const { data } = await apiClient.get(`/contributions/import/${batchId}`);
  return data;
}

export async function resolveFlaggedEntry(
  batchId: string,
  originalStaffId: string,
  resolvedStaffMongoId: string,
): Promise<IImportBatch> {
  const { data } = await apiClient.patch(`/contributions/import/${batchId}/resolve`, {
    originalStaffId,
    resolvedStaffMongoId,
  });
  return data;
}

export async function manualContribution(payload: {
  staffId: string;
  amount: number;
  month: number;
  year: number;
  note?: string;
}): Promise<IContribution[]> {
  const { data } = await apiClient.post('/contributions/manual', payload);
  return data;
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/contributions.ts
git commit -m "feat(web): contributions API client lib"
```

---

## Task 9: Web Import Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/contributions/page.tsx`
- Create: `apps/web/src/app/(dashboard)/contributions/import/page.tsx`
- Create: `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx`

- [ ] **Step 1: Create contributions landing page**

```tsx
// apps/web/src/app/(dashboard)/contributions/page.tsx
import Link from 'next/link';

export const metadata = { title: 'Contributions' };

export default function ContributionsPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Contributions</h1>
      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <Link
          href="/contributions/import"
          className="block p-6 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <p className="font-medium text-gray-900">Payroll Import</p>
          <p className="text-sm text-gray-500 mt-1">Upload Excel file from payroll</p>
        </Link>
        <Link
          href="/contributions/manual"
          className="block p-6 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <p className="font-medium text-gray-900">Manual Entry</p>
          <p className="text-sm text-gray-500 mt-1">Record a single or lump-sum payment</p>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create import/page.tsx**

```tsx
// apps/web/src/app/(dashboard)/contributions/import/page.tsx
import { Suspense } from 'react';
import ImportClient from './import-client';

export const metadata = { title: 'Import Contributions' };

export default function ImportPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <a href="/contributions" className="text-sm text-gray-500 hover:text-gray-700">
          ← Contributions
        </a>
        <h1 className="text-2xl font-semibold text-gray-900">Payroll Import</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading...</div>}>
        <ImportClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Create import-client.tsx**

```tsx
// apps/web/src/app/(dashboard)/contributions/import/import-client.tsx
'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { ImportBatchStatus } from '@welfare/shared';
import type { IImportBatch } from '@welfare/shared';
import { importContributions, listImportBatches, resolveFlaggedEntry } from '@/lib/contributions';
import { searchStaff } from '@/lib/staff';

const STATUS_BADGE: Record<ImportBatchStatus, string> = {
  [ImportBatchStatus.Pending]:   'bg-yellow-100 text-yellow-800',
  [ImportBatchStatus.Resolved]:  'bg-blue-100 text-blue-700',
  [ImportBatchStatus.Completed]: 'bg-green-100 text-green-800',
};

interface PreviewRow {
  staffId: string;
  employeeName: string;
  month: number;
  year: number;
  amount: number;
}

export default function ImportClient() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [monthOverride, setMonthOverride] = useState('');
  const [yearOverride, setYearOverride] = useState('');
  const [result, setResult] = useState<{ batchId: string; matched: number; flagged: number; total: number } | null>(null);
  const [activeBatch, setActiveBatch] = useState<IImportBatch | null>(null);

  // Resolve flagged state
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<{ _id: string; fullName: string; staffId: string }[]>([]);

  const { data: batchHistory } = useQuery({
    queryKey: ['import-batches'],
    queryFn: () => listImportBatches(),
  });

  const importMutation = useMutation({
    mutationFn: () => importContributions(
      file!,
      monthOverride ? parseInt(monthOverride, 10) : undefined,
      yearOverride ? parseInt(yearOverride, 10) : undefined,
    ),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['import-batches'] });
      toast.success(`Imported: ${data.matched} matched, ${data.flagged} flagged`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Import failed');
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ originalId, resolvedId }: { originalId: string; resolvedId: string }) =>
      resolveFlaggedEntry(activeBatch!._id, originalId, resolvedId),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      setResolveTarget(null);
      setStaffSearch('');
      setStaffOptions([]);
      toast.success('Entry resolved');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Resolve failed');
    },
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
        staffId:      String(r['Staff ID'] ?? ''),
        employeeName: String(r['Employee Name'] ?? ''),
        month:        Number(r['Month'] ?? 0),
        year:         Number(r['Year'] ?? 0),
        amount:       Number(r['Amount'] ?? 0),
      })));
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleStaffSearch(q: string) {
    setStaffSearch(q);
    if (q.length < 2) { setStaffOptions([]); return; }
    const res = await searchStaff(q);
    setStaffOptions(res.data.map((s) => ({ _id: s._id, fullName: s.fullName, staffId: s.staffId })));
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Upload section */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="font-medium text-gray-900">Upload Excel File</h2>
        <p className="text-sm text-gray-500">
          Expected columns: <code className="bg-gray-100 px-1 rounded">Staff ID</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Employee Name</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Month</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Year</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">Amount</code>
        </p>

        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f); }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
          />
          {file ? (
            <p className="text-sm text-gray-700">{file.name} — {preview.length} rows parsed</p>
          ) : (
            <p className="text-sm text-gray-400">Drop .xlsx file here or click to browse</p>
          )}
        </div>

        {/* Month/year override */}
        <div className="flex gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Month override (optional)</label>
            <input
              type="number" min="1" max="12" value={monthOverride}
              onChange={(e) => setMonthOverride(e.target.value)}
              placeholder="From sheet"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Year override (optional)</label>
            <input
              type="number" min="2000" value={yearOverride}
              onChange={(e) => setYearOverride(e.target.value)}
              placeholder="From sheet"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Preview table */}
        {preview.length > 0 && (
          <div className="overflow-x-auto rounded border border-gray-200 max-h-64">
            <table className="min-w-full text-xs divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['Staff ID', 'Employee Name', 'Month', 'Year', 'Amount'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {preview.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-gray-700">{row.staffId}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.employeeName}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.month}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.year}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.amount.toLocaleString()}</td>
                  </tr>
                ))}
                {preview.length > 50 && (
                  <tr><td colSpan={5} className="px-3 py-2 text-center text-gray-400">...and {preview.length - 50} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <button
          disabled={!file || importMutation.isPending}
          onClick={() => importMutation.mutate()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {importMutation.isPending ? 'Importing...' : 'Import'}
        </button>
      </div>

      {/* Result summary */}
      {result && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-2">
          <h2 className="font-medium text-gray-900">Import Result</h2>
          <div className="flex gap-6 text-sm">
            <span className="text-green-700">✓ {result.matched} matched</span>
            {result.flagged > 0 && <span className="text-yellow-700">⚠ {result.flagged} flagged</span>}
            <span className="text-gray-500">{result.total} total rows</span>
          </div>
        </div>
      )}

      {/* Flagged entries (from active batch) */}
      {activeBatch && activeBatch.flaggedEntries.length > 0 && (
        <div className="bg-white border border-yellow-200 rounded-xl p-6 space-y-4">
          <h2 className="font-medium text-yellow-800">Flagged Entries — {activeBatch.flaggedEntries.length} remaining</h2>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Staff ID', 'Employee Name', 'Amount', 'Reason', 'Action'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeBatch.flaggedEntries.map((entry) => (
                  <tr key={entry.staffId}>
                    <td className="px-3 py-2 text-gray-700">{entry.staffId}</td>
                    <td className="px-3 py-2 text-gray-700">{entry.employeeName}</td>
                    <td className="px-3 py-2 text-gray-700">{Number(entry.amount).toLocaleString()}</td>
                    <td className="px-3 py-2 text-red-600 text-xs">{entry.reason}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setResolveTarget(entry.staffId)}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Map to Staff
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Staff picker for resolve */}
          {resolveTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
                <h3 className="font-semibold text-gray-900">Map "{resolveTarget}" to Staff</h3>
                <input
                  placeholder="Search staff name or ID..."
                  value={staffSearch}
                  onChange={(e) => handleStaffSearch(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                {staffOptions.length > 0 && (
                  <ul className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {staffOptions.map((s) => (
                      <li key={s._id}>
                        <button
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                          onClick={() => resolveMutation.mutate({ originalId: resolveTarget, resolvedId: s._id })}
                        >
                          {s.fullName} <span className="text-gray-400 text-xs">{s.staffId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex justify-end">
                  <button onClick={() => setResolveTarget(null)} className="text-sm text-gray-500 hover:text-gray-700">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import history */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
        <h2 className="font-medium text-gray-900">Import History</h2>
        {batchHistory?.data.length === 0 ? (
          <p className="text-sm text-gray-400">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['File', 'Period', 'Matched', 'Flagged', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batchHistory?.data.map((batch) => (
                  <tr key={batch._id}>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-xs">{batch.fileName}</td>
                    <td className="px-3 py-2 text-gray-700">{batch.month}/{batch.year}</td>
                    <td className="px-3 py-2 text-green-700">{batch.matchedRows}</td>
                    <td className="px-3 py-2 text-yellow-700">{batch.flaggedRows}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[batch.status]}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {batch.flaggedRows > 0 && (
                        <button
                          onClick={() => setActiveBatch(batch)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/contributions/
git commit -m "feat(web): contributions import page with Excel preview, flagged resolution"
```

---

## Task 10: Web Manual Entry Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/contributions/manual/page.tsx`
- Create: `apps/web/src/app/(dashboard)/contributions/manual/manual-entry-client.tsx`

- [ ] **Step 1: Create manual/page.tsx**

```tsx
// apps/web/src/app/(dashboard)/contributions/manual/page.tsx
import { Suspense } from 'react';
import ManualEntryClient from './manual-entry-client';

export const metadata = { title: 'Manual Contribution Entry' };

export default function ManualEntryPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <a href="/contributions" className="text-sm text-gray-500 hover:text-gray-700">
          ← Contributions
        </a>
        <h1 className="text-2xl font-semibold text-gray-900">Manual / Lump-Sum Entry</h1>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading...</div>}>
        <ManualEntryClient />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Create manual-entry-client.tsx**

```tsx
// apps/web/src/app/(dashboard)/contributions/manual/manual-entry-client.tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ContributionStatus } from '@welfare/shared';
import type { IContribution, IStaff } from '@welfare/shared';
import { manualContribution, getContributionSummary } from '@/lib/contributions';
import { searchStaff } from '@/lib/staff';

const schema = z.object({
  staffId:    z.string().min(24, 'Select a staff member'),
  amount:     z.coerce.number().min(1, 'Amount must be > 0'),
  month:      z.coerce.number().min(1).max(12),
  year:       z.coerce.number().min(2000),
  note:       z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLOR: Record<ContributionStatus, string> = {
  [ContributionStatus.Paid]:          'text-green-700',
  [ContributionStatus.Partial]:       'text-yellow-700',
  [ContributionStatus.Missed]:        'text-red-700',
  [ContributionStatus.CarriedForward]:'text-blue-700',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const inputClass = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ManualEntryClient() {
  const qc = useQueryClient();
  const now = new Date();
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<IStaff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<IStaff | null>(null);
  const [submittedResults, setSubmittedResults] = useState<IContribution[] | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear() },
  });

  const watchMonth = watch('month');
  const watchYear = watch('year');
  const watchAmount = watch('amount');
  const watchStaffId = watch('staffId');

  const { data: summary } = useQuery({
    queryKey: ['contribution-summary', watchMonth, watchYear],
    queryFn: () => getContributionSummary(watchMonth, watchYear),
    enabled: !!watchMonth && !!watchYear,
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
    mutationFn: (values: FormValues) => manualContribution(values),
    onSuccess: (data) => {
      setSubmittedResults(data);
      qc.invalidateQueries({ queryKey: ['contribution-summary'] });
      toast.success(`Recorded ${data.length} month(s)`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Entry failed');
    },
  });

  const expectedAmount = summary?.totalExpected ? summary.totalExpected / (summary.countPaid + summary.countPartial + summary.countMissed || 1) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">

        {/* Staff picker */}
        <div className="space-y-1 relative">
          <label className="text-sm font-medium text-gray-700">Staff Member *</label>
          <input
            placeholder="Search by name or staff ID..."
            value={staffSearch}
            onChange={(e) => handleStaffSearch(e.target.value)}
            className={inputClass}
          />
          <input type="hidden" {...register('staffId')} />
          {staffOptions.length > 0 && (
            <ul className="absolute z-10 w-full border border-gray-200 bg-white rounded-md shadow-lg max-h-48 overflow-y-auto">
              {staffOptions.map((s) => (
                <li key={s._id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                    onClick={() => selectStaff(s)}
                  >
                    {s.fullName} <span className="text-gray-400 text-xs">{s.staffId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.staffId && <p className="text-xs text-red-600">{errors.staffId.message}</p>}
          {selectedStaff && (
            <p className="text-xs text-gray-500">Selected: {selectedStaff.fullName} ({selectedStaff.staffId})</p>
          )}
        </div>

        {/* Month / Year */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Month *</label>
            <select {...register('month')} className={inputClass}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Year *</label>
            <input {...register('year')} type="number" className={inputClass} />
          </div>
        </div>

        {/* Amount */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Amount *</label>
          <input {...register('amount')} type="number" min="1" className={inputClass} />
          {errors.amount && <p className="text-xs text-red-600">{errors.amount.message}</p>}
        </div>

        {/* Note */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">Note</label>
          <input {...register('note')} type="text" className={inputClass} />
        </div>

        {/* Preview panel */}
        {watchAmount > 0 && watchStaffId && (
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
            <p className="font-medium text-gray-700">Preview</p>
            <p className="text-gray-600">Amount entered: <strong>{Number(watchAmount).toLocaleString()}</strong></p>
            {expectedAmount && (
              <p className="text-gray-600">Expected/month (config): <strong>{expectedAmount.toLocaleString()}</strong></p>
            )}
            {expectedAmount && watchAmount >= expectedAmount && (
              <p className="text-blue-700 font-medium">
                Lump sum — will split across ~{Math.ceil(watchAmount / expectedAmount)} month(s)
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-60"
        >
          {isSubmitting ? 'Saving...' : 'Record Payment'}
        </button>
      </form>

      {/* Results */}
      {submittedResults && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
          <h2 className="font-medium text-gray-900">Payment Recorded</h2>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Month', 'Year', 'Paid', 'Expected', 'Surplus C/F', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {submittedResults.map((c) => (
                  <tr key={c._id}>
                    <td className="px-3 py-2">{MONTHS[c.month - 1]}</td>
                    <td className="px-3 py-2">{c.year}</td>
                    <td className="px-3 py-2">{c.paidAmount.toLocaleString()}</td>
                    <td className="px-3 py-2">{c.expectedAmount.toLocaleString()}</td>
                    <td className="px-3 py-2">{c.surplusCarriedForward.toLocaleString()}</td>
                    <td className={`px-3 py-2 font-medium ${STATUS_COLOR[c.status]}`}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/contributions/manual/
git commit -m "feat(web): manual/lump-sum contribution entry page"
```

---

## Task 11: Staff Detail Contributions Tab

**Files:**
- Modify: `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx`

- [ ] **Step 1: Add contributions query and import**

Open `apps/web/src/app/(dashboard)/staff/[id]/staff-detail-client.tsx`.

At the top, add after existing imports:
```typescript
import { getContributionsByStaff } from '@/lib/contributions';
import type { IContribution } from '@welfare/shared';
import { ContributionStatus } from '@welfare/shared';
```

Add this query inside the component, after the existing `useQuery` for staff:
```typescript
  const { data: contributions, isLoading: contribLoading } = useQuery({
    queryKey: ['contributions', 'staff', id],
    queryFn: () => getContributionsByStaff(id),
    enabled: activeTab === 'Contributions',
  });
```

- [ ] **Step 2: Replace contributions tab stub with ledger table**

Find and replace the Contributions tab placeholder:
```tsx
      {activeTab === 'Contributions' && (
        <div className="text-sm text-gray-400 py-8 text-center">
          Contributions ledger — available in Phase 4.
        </div>
      )}
```

Replace with:
```tsx
      {activeTab === 'Contributions' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-gray-700">Contribution Ledger</h3>
            <a
              href="/contributions/manual"
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              + Add Manual Entry
            </a>
          </div>
          {contribLoading ? (
            <div className="text-sm text-gray-400 py-4">Loading...</div>
          ) : !contributions?.length ? (
            <div className="text-sm text-gray-400 py-8 text-center">No contributions recorded yet.</div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Month', 'Year', 'Expected', 'Paid', 'Surplus C/F', 'Status', 'Source', 'Recorded By'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {contributions.map((c: IContribution) => (
                      <tr key={c._id}>
                        <td className="px-3 py-2">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][c.month - 1]}</td>
                        <td className="px-3 py-2">{c.year}</td>
                        <td className="px-3 py-2 text-right">{c.expectedAmount.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{c.paidAmount.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{c.surplusCarriedForward.toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            c.status === ContributionStatus.Paid ? 'bg-green-100 text-green-800' :
                            c.status === ContributionStatus.Partial ? 'bg-yellow-100 text-yellow-800' :
                            c.status === ContributionStatus.Missed ? 'bg-red-100 text-red-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-500">{c.source}</td>
                        <td className="px-3 py-2 text-gray-500">{c.recordedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-xs font-medium text-gray-600">Totals</td>
                      <td className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                        {contributions.reduce((s, c) => s + c.expectedAmount, 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                        {contributions.reduce((s, c) => s + c.paidAmount, 0).toLocaleString()}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 3: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 4: Run all API tests**

```bash
cd apps/api && npx jest --no-coverage 2>&1 | tail -8
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/\[id\]/staff-detail-client.tsx
git commit -m "feat(web): staff detail contributions ledger tab"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| POST /contributions/import — xlsx parse, flag unmatched | Task 6 (ImportService) |
| GET /contributions/import/:batchId | Task 6 |
| PATCH /contributions/import/:batchId/resolve | Task 6 |
| GET /contributions/import — list batches paginated | Task 6 |
| POST /contributions/manual with lump-sum split | Task 5 + 7 (controller) |
| Surplus carry-forward logic | Task 5 (calculatePaymentResult) |
| Status: Paid / Partial determination | Task 5 |
| Penalty for Missed (config-driven) | ⚠ Gap — see note below |
| GET /contributions filtered ledger | Task 5 + 7 |
| GET /contributions/summary | Task 5 + 7 |
| GET /staff/:id/contributions (embedded in detail tab) | Task 7 + 11 |
| Import page — dropzone, preview, results, flagged table | Task 9 |
| Map to Staff search picker | Task 9 |
| Import history table | Task 9 |
| Manual entry page — staff picker, amount, preview | Task 10 |
| Staff detail Contributions tab — ledger table | Task 11 |

### Gap: Penalty for Missed

The spec mentions applying a penalty if configured when a month is Missed. This is not implemented in Task 5 above. Penalty would apply in a nightly/scheduled job (Phase 6 tooling) or when an officer explicitly marks a month as Missed via a PATCH endpoint. **Defer to Phase 6** — the config keys `PENALTY_TYPE` and `PENALTY_VALUE` are already in the DB, and the ContributionsService can add `applyPenalty(staffId, month, year)` then. Adding it now would require a scheduled job or a separate PATCH endpoint that is not in the Phase 4 spec.

### Type Consistency
- `ContributionsService.processPayment(staffId: string, ...)` → staffId = Staff MongoDB `_id` string. ImportService passes `staff._id.toString()`. ✓
- `ManualEntryDto.staffId` annotated `@IsMongoId()` → web form sends staff `_id`. ✓
- `calculatePaymentResult` is public → tests call it directly. ✓
- `getContributionsByStaff(id)` → lib calls `/contributions/staff/${id}` → controller `GET /contributions/staff/:staffId`. ✓

### Placeholder Scan
No TBD or "similar to" references found. All code blocks are complete.
