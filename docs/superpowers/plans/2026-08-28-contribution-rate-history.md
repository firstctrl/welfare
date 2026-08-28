# Contribution Rate History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single flat `MONTHLY_CONTRIBUTION_AMOUNT` Settings value with an admin-editable rate schedule (amount + effective-from month/year), so every contribution write resolves the rate that applied to its target month/year instead of today's rate.

**Architecture:** New `contribution_rates` Mongoose collection owned by the `contributions` module, queried by a new `ContributionRatesService`. `ContributionsService.processPayment`/`processLumpSum` swap their `SystemConfigService` lookup for a month/year-aware `ContributionRatesService.getRateFor(month, year)` call. A migration seeds one rate entry from the current config value on first boot so nothing that works today breaks. New REST routes on the existing `ContributionsController`. The Settings page's single-input Contributions section becomes a small immediate-commit rate-schedule table.

**Tech Stack:** NestJS, Mongoose, class-validator, Next.js/React, TanStack Query, Jest.

**Spec:** `docs/superpowers/specs/2026-08-28-contribution-rate-history-design.md`

## Global Constraints

- One rate per `(year, month)` — unique index, no edit path (delete + recreate to change one).
- `getRateFor` throws `BadRequestException` when no rate covers the target period — never silently falls back to the nearest available rate.
- The schedule can never go fully empty — deleting the sole remaining entry is blocked both client- and server-side.
- Migration seed amount: current `MONTHLY_CONTRIBUTION_AMOUNT` config value if present, else `100` (matches `SystemConfigService`'s own seed default — no dependency on module init order between the two services).
- Migration seed effective-from: earliest `(month, year)` across existing `contributions` documents, else the current month/year.
- No automated frontend test runner in this repo — frontend tasks verify via `npx tsc --noEmit` in `apps/web`, not Jest.

---

## Task 1: Shared `IContributionRate` interface

**Files:**
- Create: `packages/shared/src/interfaces/contribution-rate.interface.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `IContributionRate { _id: string; month: number; year: number; amount: number; createdBy: string; createdAt: string }` — consumed by the frontend lib/UI tasks (7, 8).

- [ ] **Step 1: Create the interface file**

```ts
export interface IContributionRate {
  _id: string;
  month: number;
  year: number;
  amount: number;
  createdBy: string;
  createdAt: string;
}
```

- [ ] **Step 2: Export it from the shared barrel**

In `packages/shared/src/index.ts`, add this line next to the other import-batch interface exports (after the `IRemittanceFlaggedRow, IRemittanceImportBatch` line):

```ts
export type { IContributionRate } from './interfaces/contribution-rate.interface';
```

- [ ] **Step 3: Verify the shared package compiles**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/interfaces/contribution-rate.interface.ts packages/shared/src/index.ts
git commit -m "feat(shared): add IContributionRate interface"
```

---

## Task 2: `ContributionRate` schema + module registration

**Files:**
- Create: `apps/api/src/contributions/schemas/contribution-rate.schema.ts`
- Modify: `apps/api/src/contributions/contributions.module.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ContributionRate` class, `ContributionRateDocument` type, `ContributionRateSchema` — consumed by Task 3 (`ContributionRatesService`) and Task 6 (test module wiring).

- [ ] **Step 1: Create the schema**

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'contribution_rates' })
export class ContributionRate {
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0.01 }) amount!: number;
  @Prop({ required: true }) effectiveKey!: number;
  @Prop({ required: true }) createdBy!: string;
}

export type ContributionRateDocument = HydratedDocument<ContributionRate>;
export const ContributionRateSchema = SchemaFactory.createForClass(ContributionRate);

ContributionRateSchema.index({ year: 1, month: 1 }, { unique: true });
ContributionRateSchema.index({ effectiveKey: -1 });
```

`effectiveKey` is `year * 12 + month`, computed and stored at write time so lookups can do an indexed `{ effectiveKey: { $lte: target } }` sort instead of comparing two fields.

- [ ] **Step 2: Register the schema in the contributions module**

In `apps/api/src/contributions/contributions.module.ts`, add the import and register it in `MongooseModule.forFeature`:

```ts
import { ContributionRate, ContributionRateSchema } from './schemas/contribution-rate.schema';
```

```ts
MongooseModule.forFeature([
  { name: Contribution.name, schema: ContributionSchema },
  { name: ImportBatch.name, schema: ImportBatchSchema },
  { name: Loan.name, schema: LoanSchema },
  { name: ContributionRate.name, schema: ContributionRateSchema },
]),
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/contributions/schemas/contribution-rate.schema.ts apps/api/src/contributions/contributions.module.ts
git commit -m "feat(api): add ContributionRate schema"
```

---

## Task 3: `ContributionRatesService`

**Files:**
- Create: `apps/api/src/contributions/contribution-rates.service.ts`
- Create: `apps/api/src/contributions/contribution-rates.service.spec.ts`
- Modify: `apps/api/src/contributions/contributions.module.ts`

**Interfaces:**
- Consumes: `ContributionRate`/`ContributionRateDocument` (Task 2), `Contribution` schema (existing, for migration lookup), `SystemConfigService.getAll()` (existing), `AuditService.log(...)` (existing).
- Produces:
  - `getRateFor(month: number, year: number): Promise<number>`
  - `list(): Promise<ContributionRateDocument[]>`
  - `create(dto: { month: number; year: number; amount: number }, actorId: string, actorName: string): Promise<ContributionRateDocument>`
  - `delete(id: string, actorId: string, actorName: string): Promise<void>`
  - `onModuleInit(): Promise<void>` (migration seed)

  These are consumed by Task 5 (controller) and Task 6 (`ContributionsService` wiring).

- [ ] **Step 1: Write the failing test file**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ContributionRatesService } from './contribution-rates.service';
import { ContributionRate } from './schemas/contribution-rate.schema';
import { Contribution } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';

const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockCountDocuments = jest.fn();
const mockCreate = jest.fn();
const mockFindByIdAndDelete = jest.fn();
const mockRateModel = {
  findOne: mockFindOne,
  find: mockFind,
  countDocuments: mockCountDocuments,
  create: mockCreate,
  findByIdAndDelete: mockFindByIdAndDelete,
};

const mockContribFind = jest.fn();
const mockContributionModel = { find: mockContribFind };

const mockConfigService = { getAll: jest.fn() };
const mockAuditService = { log: jest.fn() };

describe('ContributionRatesService', () => {
  let service: ContributionRatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionRatesService,
        { provide: getModelToken(ContributionRate.name), useValue: mockRateModel },
        { provide: getModelToken(Contribution.name), useValue: mockContributionModel },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get(ContributionRatesService);
    jest.clearAllMocks();
  });

  describe('getRateFor', () => {
    it('returns the amount of the latest rate at or before the target period', async () => {
      mockFindOne.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ amount: 3500 }),
      });

      const amount = await service.getRateFor(6, 2024);

      expect(amount).toBe(3500);
      expect(mockFindOne).toHaveBeenCalledWith({ effectiveKey: { $lte: 2024 * 12 + 6 } });
    });

    it('throws BadRequestException when no rate covers the period', async () => {
      mockFindOne.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getRateFor(1, 2019)).rejects.toThrow('No contribution rate defined for 1/2019');
    });
  });

  describe('create', () => {
    it('creates a rate with a computed effectiveKey', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const created = { _id: { toString: () => 'r1' }, month: 7, year: 2024, amount: 3500 };
      mockCreate.mockResolvedValue(created);

      const result = await service.create({ month: 7, year: 2024, amount: 3500 }, 'actor-1', 'Actor');

      expect(result).toBe(created);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ month: 7, year: 2024, amount: 3500, effectiveKey: 2024 * 12 + 7, createdBy: 'Actor' }),
      );
    });

    it('throws ConflictException when a rate already exists for that period', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'existing' }) });

      await expect(service.create({ month: 7, year: 2024, amount: 3500 }, 'actor-1', 'Actor'))
        .rejects.toThrow('A rate already exists for 7/2024');
    });
  });

  describe('delete', () => {
    it('deletes when more than one rate remains', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });
      mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'r1', toObject: () => ({}) }) });

      await expect(service.delete('r1', 'actor-1', 'Actor')).resolves.toBeUndefined();
    });

    it('throws ConflictException when deleting the only remaining rate', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      await expect(service.delete('r1', 'actor-1', 'Actor')).rejects.toThrow('Cannot delete the only remaining contribution rate');
    });

    it('throws NotFoundException when the rate does not exist', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });
      mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.delete('missing', 'actor-1', 'Actor')).rejects.toThrow('Contribution rate missing not found');
    });
  });

  describe('list', () => {
    it('returns rates sorted newest-first', async () => {
      mockFind.mockReturnValue({ sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([{ month: 7, year: 2024 }]) });

      const result = await service.list();

      expect(result).toEqual([{ month: 7, year: 2024 }]);
    });
  });

  describe('onModuleInit (migration seed)', () => {
    it('seeds from the current config value and the earliest contribution period when the collection is empty', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      mockConfigService.getAll.mockResolvedValue({ MONTHLY_CONTRIBUTION_AMOUNT: { value: '3000' } });
      mockContribFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([{ month: 3, year: 2022 }]),
      });
      mockCreate.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ month: 3, year: 2022, amount: 3000, effectiveKey: 2022 * 12 + 3, createdBy: 'system-migration' }),
      );
    });

    it('falls back to amount 100 and the current month/year when config and contributions are both empty', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
      mockConfigService.getAll.mockResolvedValue({});
      mockContribFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      mockCreate.mockResolvedValue({});

      await service.onModuleInit();

      const now = new Date();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100, month: now.getMonth() + 1, year: now.getFullYear(), createdBy: 'system-migration' }),
      );
    });

    it('does nothing when the collection already has entries', async () => {
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      await service.onModuleInit();

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd apps/api && npx jest contribution-rates.service -v`
Expected: FAIL — `Cannot find module './contribution-rates.service'`.

- [ ] **Step 3: Implement the service**

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity } from '@welfare/shared';
import { ContributionRate, ContributionRateDocument } from './schemas/contribution-rate.schema';
import { Contribution, ContributionDocument } from './schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ContributionRatesService implements OnModuleInit {
  constructor(
    @InjectModel(ContributionRate.name) private readonly rateModel: Model<ContributionRateDocument>,
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    private readonly configService: SystemConfigService,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.rateModel.countDocuments().exec();
    if (count > 0) return;

    const config = await this.configService.getAll() as unknown as Record<string, { value: string }>;
    const amount = parseFloat(config['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? '100');

    const earliest = await this.contributionModel.find().sort({ year: 1, month: 1 }).limit(1).exec();
    const now = new Date();
    const { month, year } = earliest.length > 0
      ? { month: earliest[0].month, year: earliest[0].year }
      : { month: now.getMonth() + 1, year: now.getFullYear() };

    await this.rateModel.create({
      month, year, amount,
      effectiveKey: year * 12 + month,
      createdBy: 'system-migration',
    });
  }

  async getRateFor(month: number, year: number): Promise<number> {
    const targetKey = year * 12 + month;
    const rate = await this.rateModel
      .findOne({ effectiveKey: { $lte: targetKey } })
      .sort({ effectiveKey: -1 })
      .exec();
    if (!rate) {
      throw new BadRequestException(
        `No contribution rate defined for ${month}/${year} — add one in Settings before importing or resolving this period.`,
      );
    }
    return rate.amount;
  }

  async list(): Promise<ContributionRateDocument[]> {
    return this.rateModel.find().sort({ effectiveKey: -1 }).exec();
  }

  async create(
    dto: { month: number; year: number; amount: number },
    actorId: string,
    actorName: string,
  ): Promise<ContributionRateDocument> {
    const existing = await this.rateModel.findOne({ month: dto.month, year: dto.year }).exec();
    if (existing) {
      throw new ConflictException(
        `A rate already exists for ${dto.month}/${dto.year} — delete it first to change it.`,
      );
    }
    const rate = await this.rateModel.create({
      month: dto.month, year: dto.year, amount: dto.amount,
      effectiveKey: dto.year * 12 + dto.month,
      createdBy: actorName,
    });
    this.auditService.log(
      actorId, actorName, AuditAction.Create, AuditEntity.Config, rate._id.toString(),
      undefined, { month: dto.month, year: dto.year, amount: dto.amount },
    );
    return rate;
  }

  async delete(id: string, actorId: string, actorName: string): Promise<void> {
    const count = await this.rateModel.countDocuments().exec();
    if (count <= 1) {
      throw new ConflictException('Cannot delete the only remaining contribution rate — at least one must always be defined.');
    }
    const result = await this.rateModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException(`Contribution rate ${id} not found`);
    this.auditService.log(
      actorId, actorName, AuditAction.Delete, AuditEntity.Config, id,
      result.toObject() as unknown as Record<string, unknown>, undefined,
    );
  }
}
```

- [ ] **Step 4: Register the service as a provider**

In `apps/api/src/contributions/contributions.module.ts`:

```ts
import { ContributionRatesService } from './contribution-rates.service';
```

```ts
providers: [ContributionsService, ImportService, ContributionRatesService],
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd apps/api && npx jest contribution-rates.service -v`
Expected: PASS, all 11 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/contributions/contribution-rates.service.ts apps/api/src/contributions/contribution-rates.service.spec.ts apps/api/src/contributions/contributions.module.ts
git commit -m "feat(api): add ContributionRatesService with migration seed"
```

---

## Task 4: `CreateContributionRateDto`

**Files:**
- Create: `apps/api/src/contributions/dto/create-contribution-rate.dto.ts`

**Interfaces:**
- Produces: `CreateContributionRateDto { month: number; year: number; amount: number }` — consumed by Task 5 (controller).

- [ ] **Step 1: Create the DTO**

```ts
import { IsInt, IsNumber, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateContributionRateDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @Type(() => Number) @IsInt() @Min(2000) year!: number;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/contributions/dto/create-contribution-rate.dto.ts
git commit -m "feat(api): add CreateContributionRateDto"
```

---

## Task 5: Rate schedule routes on `ContributionsController`

**Files:**
- Modify: `apps/api/src/contributions/contributions.controller.ts`

**Interfaces:**
- Consumes: `ContributionRatesService.list/create/delete` (Task 3), `CreateContributionRateDto` (Task 4).
- Produces: `GET /contributions/rates`, `POST /contributions/rates`, `DELETE /contributions/rates/:id` — consumed by Task 7 (frontend lib).

No controller spec exists in this codebase for `ContributionsController` (only services get unit tests here) — this task is implement-and-verify, not TDD.

- [ ] **Step 1: Inject the service and import the DTO**

At the top of `apps/api/src/contributions/contributions.controller.ts`, add:

```ts
import { ContributionRatesService } from './contribution-rates.service';
import { CreateContributionRateDto } from './dto/create-contribution-rate.dto';
```

Change the constructor to:

```ts
constructor(
  private readonly contributionsService: ContributionsService,
  private readonly importService: ImportService,
  private readonly ratesService: ContributionRatesService,
) {}
```

- [ ] **Step 2: Add the three routes**

Insert this block immediately after the existing `clearFlaggedEntries` method (after its closing `}`) and before `@Post('manual')`:

```ts
  @Get('rates')
  @RequirePermission(AppModule.Settings, 'readonly')
  listRates() {
    return this.ratesService.list();
  }

  @Post('rates')
  @RequirePermission(AppModule.Settings, 'full')
  createRate(
    @Body() dto: CreateContributionRateDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.ratesService.create(dto, user.sub, user.displayName);
  }

  @Delete('rates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Settings, 'full')
  async deleteRate(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    await this.ratesService.delete(id, user.sub, user.displayName);
  }
```

`rates/:id` must be declared before the existing `@Delete(':id')` route further down the class (contribution record deletion) — Nest matches routes in declaration order, and this insertion point is well above it, so no change needed there.

- [ ] **Step 3: Verify it compiles and the full API suite still passes**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

Run: `cd apps/api && npx jest`
Expected: all suites still pass (no behavioral change to existing routes).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/contributions/contributions.controller.ts
git commit -m "feat(api): add contribution rate schedule routes"
```

---

## Task 6: Wire `ContributionsService` to `ContributionRatesService`

**Files:**
- Modify: `apps/api/src/contributions/contributions.service.ts`
- Modify: `apps/api/src/contributions/contributions.service.spec.ts`
- Modify: `apps/api/src/contributions/contributions.module.ts`

**Interfaces:**
- Consumes: `ContributionRatesService.getRateFor(month, year)` (Task 3).
- Produces: `getExpectedAmount` becomes month/year-aware (private, no external consumers change).

This is the task that actually fixes the reported bug — `getExpectedAmount()` stops reading "now" and starts reading the target period's rate.

- [ ] **Step 1: Update the failing/changing tests first**

In `apps/api/src/contributions/contributions.service.spec.ts`, replace the `SystemConfigService` import and mock with `ContributionRatesService`:

```ts
import { ContributionRatesService } from './contribution-rates.service';
```

Remove the `SystemConfigService` import line and replace the `mockConfigService` block with:

```ts
const mockRatesService = { getRateFor: jest.fn().mockResolvedValue(3000) };
```

In the `beforeEach`, replace:

```ts
{ provide: SystemConfigService, useValue: mockConfigService },
```

with:

```ts
{ provide: ContributionRatesService, useValue: mockRatesService },
```

And replace the `mockConfigService.getAll.mockResolvedValue(...)` reset line with:

```ts
mockRatesService.getRateFor.mockResolvedValue(3000);
```

Then add one new test inside the `describe('processPayment', ...)` block proving the month/year is actually passed through:

```ts
    it('resolves the rate for the target month/year, not a fixed default', async () => {
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const savedDoc = { _id: { toString: () => 'c-id' }, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(savedDoc) });
      mockRatesService.getRateFor.mockResolvedValue(2500);

      await service.processPayment('s1', 3, 2022, 2500, ContributionSource.PayrollImport, 'uid', 'U');

      expect(mockRatesService.getRateFor).toHaveBeenCalledWith(3, 2022);
    });
```

And add one new test inside `describe('processLumpSum', ...)` proving the loop looks up the rate per-month:

```ts
    it('looks up the rate for each month in the backfill loop', async () => {
      mockFind.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { month: 1, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
          { month: 2, year: 2025, paidAmount: 0, surplusCarriedForward: 0 },
        ]),
      });
      mockFindOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      const mockSaved = { _id: { toString: () => 'c-id' }, surplusCarriedForward: 0, toObject: jest.fn(() => ({})) };
      mockFindOneAndUpdate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(mockSaved) });

      await service.processLumpSum('s1', 6000, 1, 2025, 'uid', 'U');

      expect(mockRatesService.getRateFor).toHaveBeenCalledWith(1, 2025);
      expect(mockRatesService.getRateFor).toHaveBeenCalledWith(2, 2025);
    });
```

- [ ] **Step 2: Run the suite to confirm it fails**

Run: `cd apps/api && npx jest contributions.service -v`
Expected: FAIL — compile error (`ContributionRatesService` not found in `contributions.service.ts` yet) or the two new assertions failing against the current `configService`-only implementation.

- [ ] **Step 3: Update the service implementation**

In `apps/api/src/contributions/contributions.service.ts`:

Replace the import:

```ts
import { SystemConfigService } from '../system-config/system-config.service';
```

with:

```ts
import { ContributionRatesService } from './contribution-rates.service';
```

Replace the constructor parameter:

```ts
private readonly configService: SystemConfigService,
```

with:

```ts
private readonly ratesService: ContributionRatesService,
```

Replace the private helper:

```ts
  private async getExpectedAmount(config: ConfigMap): Promise<number> {
    return parseFloat(config['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? '0');
  }
```

with:

```ts
  private async getExpectedAmount(month: number, year: number): Promise<number> {
    return this.ratesService.getRateFor(month, year);
  }
```

Remove the now-unused `ConfigMap` type alias (`type ConfigMap = Record<string, { value: string }>;`) — nothing else in the file uses it after this change.

In `processPayment`, replace:

```ts
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const expectedAmount = await this.getExpectedAmount(config);
```

with:

```ts
    const expectedAmount = await this.getExpectedAmount(month, year);
```

In `processLumpSum`, replace:

```ts
    const config = await this.configService.getAll() as unknown as ConfigMap;
    const expectedAmount = await this.getExpectedAmount(config);
```

with nothing (delete those two lines entirely — the rate is now looked up per-month inside the loop, not once upfront).

Inside `processLumpSum`'s `for` loop, immediately after the `for (let i = 0; remaining > 0 && i < 120; i++) {` line, add:

```ts
      const expectedAmount = await this.getExpectedAmount(current.month, current.year);
```

- [ ] **Step 4: Update the module providers**

In `apps/api/src/contributions/contributions.module.ts`, `ContributionsService` now needs `ContributionRatesService` available — it already will be, since Task 3 added it to the same module's `providers` array. No further change needed here (both services live in the same module).

- [ ] **Step 5: Run the suite to confirm it passes**

Run: `cd apps/api && npx jest contributions.service -v`
Expected: PASS, all tests green including the two new ones.

- [ ] **Step 6: Run the full API suite**

Run: `cd apps/api && npx jest`
Expected: all suites pass — this confirms `import.service.spec.ts` (contributions) still passes unchanged, since `resolveOneEntry` already forwarded `batch.month`/`batch.year` into `processPayment` and needs no code change.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/contributions/contributions.service.ts apps/api/src/contributions/contributions.service.spec.ts
git commit -m "fix(api): resolve contribution rate by target month/year, not current date"
```

---

## Task 7: Frontend lib functions

**Files:**
- Modify: `apps/web/src/lib/contributions.ts`

**Interfaces:**
- Consumes: `GET/POST/DELETE /contributions/rates*` (Task 5), `IContributionRate` (Task 1).
- Produces: `listContributionRates()`, `createContributionRate(payload)`, `deleteContributionRate(id)` — consumed by Task 8.

- [ ] **Step 1: Add the type import**

At the top of `apps/web/src/lib/contributions.ts`, change:

```ts
import type { IContribution, IImportBatch, PaginatedResult } from '@welfare/shared';
```

to:

```ts
import type { IContribution, IContributionRate, IImportBatch, PaginatedResult } from '@welfare/shared';
```

- [ ] **Step 2: Add the three functions**

Append at the end of the file:

```ts
export async function listContributionRates(): Promise<IContributionRate[]> {
  const { data } = await apiClient.get('/contributions/rates');
  return data;
}

export async function createContributionRate(payload: { month: number; year: number; amount: number }): Promise<IContributionRate> {
  const { data } = await apiClient.post('/contributions/rates', payload);
  return data;
}

export async function deleteContributionRate(id: string): Promise<void> {
  await apiClient.delete(`/contributions/rates/${id}`);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/contributions.ts
git commit -m "feat(web): add contribution rate schedule API functions"
```

---

## Task 8: Rewrite the Settings → Contributions section

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/settings-client.tsx`

**Interfaces:**
- Consumes: `listContributionRates`, `createContributionRate`, `deleteContributionRate` (Task 7), `IContributionRate` (Task 1), `ConfirmModal` (existing, `apps/web/src/components/ui/confirm-modal.tsx`).

- [ ] **Step 1: Replace imports**

At the top of `apps/web/src/app/(dashboard)/settings/settings-client.tsx`, add:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listContributionRates, createContributionRate, deleteContributionRate } from '../../../lib/contributions';
import type { IContributionRate } from '@welfare/shared';
import { ConfirmModal } from '@/components/ui/confirm-modal';
```

- [ ] **Step 2: Replace the `ContributionsSection` component**

Replace the entire existing `ContributionsSection` function (from `const CONTRIBUTION_KEYS = ...` through its closing `}`) with:

```tsx
function ContributionsSection({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [amount, setAmount] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<IContributionRate | null>(null);

  const { data: rates } = useQuery({
    queryKey: ['contribution-rates'],
    queryFn: () => listContributionRates(),
  });

  const createMutation = useMutation({
    mutationFn: () => createContributionRate({ month: parseInt(month, 10), year: parseInt(year, 10), amount: parseFloat(amount) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contribution-rates'] });
      setMonth(''); setYear(''); setAmount('');
      toast.success('Rate added');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to add rate');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteContributionRate(id),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['contribution-rates'] });
      toast.success('Rate deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to delete rate');
    },
  });

  function addRate() {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const a = parseFloat(amount);
    if (!(m >= 1 && m <= 12)) { toast.error('Month must be between 1 and 12'); return; }
    if (!(y >= 2000)) { toast.error('Year must be 2000 or later'); return; }
    if (!(a > 0)) { toast.error('Amount must be greater than 0'); return; }
    createMutation.mutate();
  }

  const canDelete = (rates?.length ?? 0) > 1;

  return (
    <Card>
      <CardHeader
        title="Contributions"
        subtitle="Monthly contribution rate schedule — each entry applies from its month/year onward, until the next entry takes over."
      />
      <CardBody className="space-y-4">
        {!rates?.length ? (
          <p className="text-sm text-neutral-400">No rates defined yet.</p>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded-sm">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-neutral-50">
                <tr>
                  {['Effective From', 'Amount', 'Added By', 'Date', ''].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rates.map((r) => (
                  <tr key={r._id}>
                    <td className="px-3 py-2 font-mono text-xs">{r.month}/{r.year}</td>
                    <td className="px-3 py-2 font-mono tabular">₵{r.amount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-neutral-500 text-xs">{r.createdBy}</td>
                    <td className="px-3 py-2 text-neutral-500 text-xs font-mono">{fmt(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      {canEdit && (
                        <button
                          onClick={() => setDeleteTarget(r)}
                          disabled={!canDelete}
                          title={canDelete ? undefined : 'At least one rate must always be defined'}
                          className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium disabled:opacity-40 disabled:hover:no-underline disabled:cursor-not-allowed"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canEdit && (
          <div className="flex items-end gap-3">
            <Field label="Month">
              <Input type="number" min={1} max={12} step={1} value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 90 }} />
            </Field>
            <Field label="Year">
              <Input type="number" min={2000} step={1} value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 110 }} />
            </Field>
            <Field label="Amount">
              <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} prefix="₵" style={{ width: 140 }} />
            </Field>
            <Button
              type="button"
              variant="primary"
              onClick={addRate}
              disabled={createMutation.isPending || !month || !year || !amount}
              loading={createMutation.isPending}
            >
              Add
            </Button>
          </div>
        )}
      </CardBody>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this rate?"
        body={`This removes the ${deleteTarget?.month}/${deleteTarget?.year} rate (₵${deleteTarget?.amount.toFixed(2)}) from the schedule. Contributions already recorded are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!._id)}
        onClose={() => setDeleteTarget(null)}
      />
    </Card>
  );
}
```

- [ ] **Step 3: Update the call site**

The root `SettingsClient` component currently renders:

```tsx
<ContributionsSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('contributions')} canEdit={canEdit} />
```

Change it to:

```tsx
<ContributionsSection canEdit={canEdit} />
```

The section no longer participates in the page's dirty/save tracking (it commits immediately), so it's fine that `makeDirtyHandler('contributions')` is no longer called for it — the other sections still register their own dirty state independently.

- [ ] **Step 4: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Start the dev server and open Settings:
1. Confirm the Contributions section shows a table (seeded with the migrated rate) instead of a single input.
2. Add a new rate for a future month — confirm it appears in the table immediately, no page reload needed.
3. Confirm the Delete button is disabled when only one rate remains, and enabled once a second exists.
4. Delete the newly-added rate, confirm the modal, confirm it disappears from the table.
5. Go to Contributions → Import, resolve a flagged entry for a month covered by the schedule — confirm it succeeds. (A month with no covering rate would show a toast naming the missing period; this only matters if the seeded rate's effective-from date is later than some existing data, which shouldn't happen given the migration's earliest-contribution seeding — no action needed unless observed.)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/settings/settings-client.tsx"
git commit -m "feat(web): replace single contribution amount input with rate schedule table"
```

---

## Task 9: Remove `MonthlyContributionAmount` from the generic config system

**Files:**
- Modify: `packages/shared/src/enums/config-key.enum.ts`
- Modify: `apps/api/src/system-config/system-config.service.ts`

This is last on purpose — everything now reads/writes contribution rates through the new dedicated system, so the old generic config key is dead code. Removing it earlier would have broken compilation in files fixed by later tasks.

- [ ] **Step 1: Remove the enum member**

In `packages/shared/src/enums/config-key.enum.ts`, delete the line:

```ts
  MonthlyContributionAmount = 'MONTHLY_CONTRIBUTION_AMOUNT',
```

- [ ] **Step 2: Remove the seed default**

In `apps/api/src/system-config/system-config.service.ts`, delete this line from `SEED_DEFAULTS`:

```ts
  { key: ConfigKey.MonthlyContributionAmount, value: '100' },
```

- [ ] **Step 3: Remove the validation case**

In the same file's `validateUpdates` switch, delete this case:

```ts
        case ConfigKey.MonthlyContributionAmount:
          if (!(parseFloat(value) > 0))
            throw new UnprocessableEntityException(`MonthlyContributionAmount must be > 0`);
          break;
```

- [ ] **Step 4: Verify everything still compiles and passes**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors — confirms nothing still references the removed enum member (Task 6 already removed the only production usage; Task 8 already removed the Settings UI usage).

Run: `cd apps/api && npx jest`
Expected: all suites pass.

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enums/config-key.enum.ts apps/api/src/system-config/system-config.service.ts
git commit -m "chore: remove MONTHLY_CONTRIBUTION_AMOUNT from generic config system"
```

---

## Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd apps/api && npx jest`
Expected: all suites pass, including the 11 new `contribution-rates.service.spec.ts` tests and the updated `contributions.service.spec.ts`.

- [ ] **Step 2: Typecheck both apps**

Run: `cd apps/api && npx tsc --noEmit`
Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors in either.

- [ ] **Step 3: Build the web app**

Run: `cd apps/web && npx next build`
Expected: build succeeds (catches anything `tsc --noEmit` alone might miss, e.g. a server/client component boundary issue).

- [ ] **Step 4: Report completion**

Summarize: bug fixed (rate lookups are now month/year-aware), migration seeds automatically on first boot, Settings UI replaced, old config key removed. No further steps — hand off to the finishing-a-development-branch skill.
