# Remittances, Investments, Loan Pay-Off — Part 2: Investments API + Loan Pay-Off + Forfeiture + Payment Reminder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Investments CRUD module and implement Loan Pay-Off with tier-based discounts, discount forfeiture for defaulted Tier 1 loans, the 7-day payment reminder cron job, and the backfill migration.

**Architecture:** Investments uses soft-delete + editHistory audit trail; status is computed at query time. Discounts are event-driven records created as side-effects. Forfeiture claws back the entire origination discount by recomputing `totalRepayable = principal × 1.15` on the full principal and spreading new outstanding across remaining instalments. Pay-off uses a preview-then-commit pattern.

**Tech Stack:** NestJS · Mongoose · XLSX · @nestjs/schedule · @react-email/render · Jest

**Prerequisite:** Part 1 tasks must be complete (shared enums and interfaces).

---

### Task 7: Investment Schema + Import Batch Schema

**Files:**
- Create: `apps/api/src/investments/schemas/investment.schema.ts`
- Create: `apps/api/src/investments/schemas/investment-import-batch.schema.ts`

- [ ] **Step 1: Create Investment schema**

Create `apps/api/src/investments/schemas/investment.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InvestmentDocument = HydratedDocument<Investment>;

interface EditHistoryEntry {
  editedBy: string;
  editedAt: Date;
  reason: string;
  snapshot: Record<string, unknown>;
}

@Schema({ timestamps: true, collection: 'investments' })
export class Investment {
  @Prop({ required: true }) purchaseDate!: Date;
  @Prop({ required: true }) description!: string;
  @Prop({ required: true, min: 0 }) cost!: number;
  @Prop({ required: true }) maturityDate!: Date;
  @Prop({ required: true, min: 0 }) faceValue!: number;
  @Prop({ required: true, min: 0 }) interest!: number;
  @Prop({ required: true, min: 0 }) rate!: number;
  @Prop({ required: true, enum: ['One-Time', 'Roll-Over'] }) instruction!: 'One-Time' | 'Roll-Over';
  @Prop({ required: true }) recordedBy!: string;
  @Prop() importBatchId?: string;
  @Prop({ type: [Object], default: [] }) editHistory!: EditHistoryEntry[];
  @Prop() deletedAt?: Date;
  @Prop() deletedBy?: string;
  @Prop() deletionReason?: string;
}

export const InvestmentSchema = SchemaFactory.createForClass(Investment);
InvestmentSchema.index({ deletedAt: 1 });
```

- [ ] **Step 2: Create InvestmentImportBatch schema**

Create `apps/api/src/investments/schemas/investment-import-batch.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InvestmentImportBatchDocument = HydratedDocument<InvestmentImportBatch>;

interface InvestmentFlaggedRow {
  rowNumber: number;
  description: string;
  flagReason: string;
}

@Schema({ timestamps: true, collection: 'investment_import_batches' })
export class InvestmentImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) recordedBy!: string;
  @Prop({ required: true, default: 0 }) total!: number;
  @Prop({ required: true, default: 0 }) imported!: number;
  @Prop({ required: true, default: 0 }) flagged!: number;
  @Prop({ type: [Object], default: [] }) flaggedRows!: InvestmentFlaggedRow[];
}

export const InvestmentImportBatchSchema = SchemaFactory.createForClass(InvestmentImportBatch);
```

- [ ] **Step 3: Verify API compiles**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/investments/schemas/
git commit -m "feat(investments): add Investment and InvestmentImportBatch schemas"
```

---

### Task 8: InvestmentsService

**Files:**
- Create: `apps/api/src/investments/investments.service.ts`
- Create: `apps/api/src/investments/investments.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/investments/investments.service.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { Investment } from './schemas/investment.schema';

const mockModel = {
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  updateOne: jest.fn(),
};

describe('InvestmentsService', () => {
  let service: InvestmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsService,
        { provide: getModelToken(Investment.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<InvestmentsService>(InvestmentsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('computes interest and rate before saving', async () => {
      mockModel.create.mockResolvedValue({ _id: 'inv1' });
      await service.create(
        { purchaseDate: '2025-01-01', description: 'T-Bill', cost: 10000, maturityDate: '2025-07-01', faceValue: 10500, instruction: 'One-Time' },
        'uid',
      );
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ interest: 500, rate: 5 }),
      );
    });
  });

  describe('computeStatus', () => {
    it('returns Matured when maturityDate in past', () => {
      expect(service.computeStatus(new Date('2020-01-01'))).toBe('Matured');
    });

    it('returns Active when maturityDate in future', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      expect(service.computeStatus(future)).toBe('Active');
    });
  });

  describe('update', () => {
    it('throws BadRequestException when reason is empty', async () => {
      await expect(service.update('id1', { description: 'New' }, '', 'uid')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when investment not found', async () => {
      mockModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.update('id1', { description: 'New' }, 'reason', 'uid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('throws BadRequestException when reason is empty', async () => {
      await expect(service.softDelete('id1', '', 'uid')).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx jest apps/api/src/investments/investments.service.spec.ts --no-coverage 2>&1 | head -10`
Expected: FAIL — "Cannot find module './investments.service'"

- [ ] **Step 3: Create InvestmentsService**

Create `apps/api/src/investments/investments.service.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IInvestmentRow, PaginatedResult } from '@welfare/shared';
import { Investment, InvestmentDocument } from './schemas/investment.schema';

function r2(n: number) { return Math.round(n * 100) / 100; }

export interface CreateInvestmentDto {
  purchaseDate: string;
  description: string;
  cost: number;
  maturityDate: string;
  faceValue: number;
  instruction: 'One-Time' | 'Roll-Over';
}

export interface UpdateInvestmentDto {
  purchaseDate?: string;
  description?: string;
  cost?: number;
  maturityDate?: string;
  faceValue?: number;
  instruction?: 'One-Time' | 'Roll-Over';
}

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectModel(Investment.name) private readonly model: Model<InvestmentDocument>,
  ) {}

  computeStatus(maturityDate: Date): 'Active' | 'Matured' {
    return maturityDate <= new Date() ? 'Matured' : 'Active';
  }

  private toRow(doc: InvestmentDocument): IInvestmentRow {
    return {
      id: doc._id.toString(),
      purchaseDate: doc.purchaseDate.toISOString(),
      description: doc.description,
      cost: doc.cost,
      maturityDate: doc.maturityDate.toISOString(),
      faceValue: doc.faceValue,
      interest: doc.interest,
      rate: doc.rate,
      status: this.computeStatus(doc.maturityDate),
      instruction: doc.instruction,
    };
  }

  async create(dto: CreateInvestmentDto, actorId: string): Promise<IInvestmentRow> {
    const interest = r2(dto.faceValue - dto.cost);
    const rate = r2((interest / dto.cost) * 100);
    const doc = await this.model.create({
      purchaseDate: new Date(dto.purchaseDate),
      description: dto.description,
      cost: dto.cost,
      maturityDate: new Date(dto.maturityDate),
      faceValue: dto.faceValue,
      interest,
      rate,
      instruction: dto.instruction,
      recordedBy: actorId,
    });
    return this.toRow(doc);
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedResult<IInvestmentRow>> {
    const skip = (page - 1) * limit;
    const filter = { deletedAt: { $exists: false } };
    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ purchaseDate: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return {
      data: docs.map(d => this.toRow(d)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async update(
    id: string,
    dto: UpdateInvestmentDto,
    reason: string,
    actorId: string,
  ): Promise<IInvestmentRow> {
    if (!reason?.trim()) throw new BadRequestException('reason is required for edits');

    const doc = await this.model.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
    if (!doc) throw new NotFoundException('Investment not found');

    const snapshot: Record<string, unknown> = {
      purchaseDate: doc.purchaseDate,
      description: doc.description,
      cost: doc.cost,
      maturityDate: doc.maturityDate,
      faceValue: doc.faceValue,
      interest: doc.interest,
      rate: doc.rate,
      instruction: doc.instruction,
    };

    if (dto.purchaseDate) doc.purchaseDate = new Date(dto.purchaseDate);
    if (dto.description) doc.description = dto.description;
    if (dto.cost !== undefined) doc.cost = dto.cost;
    if (dto.maturityDate) doc.maturityDate = new Date(dto.maturityDate);
    if (dto.faceValue !== undefined) doc.faceValue = dto.faceValue;
    if (dto.instruction) doc.instruction = dto.instruction;

    doc.interest = r2(doc.faceValue - doc.cost);
    doc.rate = r2((doc.interest / doc.cost) * 100);

    doc.editHistory.push({ editedBy: actorId, editedAt: new Date(), reason: reason.trim(), snapshot });
    await doc.save();
    return this.toRow(doc);
  }

  async softDelete(id: string, reason: string, actorId: string): Promise<void> {
    if (!reason?.trim()) throw new BadRequestException('reason is required for deletion');

    const doc = await this.model.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
    if (!doc) throw new NotFoundException('Investment not found');

    await this.model.updateOne(
      { _id: id },
      { deletedAt: new Date(), deletedBy: actorId, deletionReason: reason.trim() },
    );
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx jest apps/api/src/investments/investments.service.spec.ts --no-coverage`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/investments/investments.service.ts apps/api/src/investments/investments.service.spec.ts
git commit -m "feat(investments): add InvestmentsService with CRUD, soft-delete, edit history, status computation"
```

---

### Task 9: InvestmentsImportService + DTOs + Controller + Module + AppModule

**Files:**
- Create: `apps/api/src/investments/investments.import.service.ts`
- Create: `apps/api/src/investments/dto/create-investment.dto.ts`
- Create: `apps/api/src/investments/dto/update-investment.dto.ts`
- Create: `apps/api/src/investments/investments.controller.ts`
- Create: `apps/api/src/investments/investments.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create InvestmentsImportService**

Create `apps/api/src/investments/investments.import.service.ts`:
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { InvestmentImportBatch, InvestmentImportBatchDocument } from './schemas/investment-import-batch.schema';
import { InvestmentsService } from './investments.service';

interface InvestmentExcelRow {
  'Purchase Date'?: string;
  Description?: string;
  Cost?: number;
  'Maturity Date'?: string;
  'Face Value'?: number;
  Instruction?: string;
}

@Injectable()
export class InvestmentsImportService {
  constructor(
    @InjectModel(InvestmentImportBatch.name)
    private readonly batchModel: Model<InvestmentImportBatchDocument>,
    private readonly investmentsService: InvestmentsService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
  ): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<InvestmentExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      fileName,
      recordedBy: actorName,
      total: rows.length,
      imported: 0,
      flagged: 0,
      flaggedRows: [],
    });

    let imported = 0;
    const flaggedRows: Array<{ rowNumber: number; description: string; flagReason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const description = String(row.Description ?? '').trim();
      const cost = Number(row.Cost ?? 0);
      const faceValue = Number(row['Face Value'] ?? 0);
      const instruction = String(row.Instruction ?? '').trim() as 'One-Time' | 'Roll-Over';
      const purchaseDateRaw = row['Purchase Date'];
      const maturityDateRaw = row['Maturity Date'];

      if (!description) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Missing Description' });
        continue;
      }
      if (!cost || cost <= 0) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid or missing Cost' });
        continue;
      }
      if (!faceValue || faceValue <= 0) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid or missing Face Value' });
        continue;
      }
      if (!purchaseDateRaw) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Missing Purchase Date' });
        continue;
      }
      if (!maturityDateRaw) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Missing Maturity Date' });
        continue;
      }
      if (!['One-Time', 'Roll-Over'].includes(instruction)) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: `Invalid Instruction: "${instruction}" (must be One-Time or Roll-Over)` });
        continue;
      }

      try {
        const purchaseDate = purchaseDateRaw instanceof Date
          ? purchaseDateRaw.toISOString()
          : String(purchaseDateRaw);
        const maturityDate = maturityDateRaw instanceof Date
          ? maturityDateRaw.toISOString()
          : String(maturityDateRaw);

        await this.investmentsService.create(
          { purchaseDate, description, cost, maturityDate, faceValue, instruction },
          actorId,
        );
        imported++;
      } catch (err: any) {
        flaggedRows.push({ rowNumber: i + 2, description, flagReason: err?.message ?? 'Unknown error' });
      }
    }

    await this.batchModel.updateOne(
      { _id: batch._id },
      { imported, flagged: flaggedRows.length, flaggedRows },
    );

    return { batchId: batch._id.toString(), imported, flagged: flaggedRows.length, total: rows.length };
  }
}
```

- [ ] **Step 2: Create DTOs**

Create `apps/api/src/investments/dto/create-investment.dto.ts`:
```ts
import { IsIn, IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvestmentDto {
  @IsString() purchaseDate!: string;
  @IsString() description!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) cost!: number;
  @IsString() maturityDate!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) faceValue!: number;
  @IsIn(['One-Time', 'Roll-Over']) instruction!: 'One-Time' | 'Roll-Over';
}
```

Create `apps/api/src/investments/dto/update-investment.dto.ts`:
```ts
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateInvestmentDto {
  @IsOptional() @IsString() purchaseDate?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) cost?: number;
  @IsOptional() @IsString() maturityDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) faceValue?: number;
  @IsOptional() @IsIn(['One-Time', 'Roll-Over']) instruction?: 'One-Time' | 'Roll-Over';
  @IsString() reason!: string;
}
```

- [ ] **Step 3: Create InvestmentsController**

Create `apps/api/src/investments/investments.controller.ts`:
```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppModule } from '@welfare/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { InvestmentsService } from './investments.service';
import { InvestmentsImportService } from './investments.import.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { UpdateInvestmentDto } from './dto/update-investment.dto';

@Controller('investments')
export class InvestmentsController {
  constructor(
    private readonly service: InvestmentsService,
    private readonly importService: InvestmentsImportService,
  ) {}

  @Get()
  @RequirePermission(AppModule.Investments, 'readonly')
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(page ? +page : 1, limit ? +limit : 20);
  }

  @Post()
  @RequirePermission(AppModule.Investments, 'full')
  create(
    @Body() dto: CreateInvestmentDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  @RequirePermission(AppModule.Investments, 'full')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestmentDto,
    @CurrentUser() user: { sub: string },
  ) {
    const { reason, ...fields } = dto;
    return this.service.update(id, fields, reason, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Investments, 'full')
  async remove(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: { sub: string },
  ) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    await this.service.softDelete(id, reason, user.sub);
  }

  @Post('import')
  @RequirePermission(AppModule.Investments, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.processImport(file.buffer, file.originalname, user.sub, user.displayName);
  }
}
```

- [ ] **Step 4: Create InvestmentsModule**

Create `apps/api/src/investments/investments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { InvestmentsImportService } from './investments.import.service';
import { Investment, InvestmentSchema } from './schemas/investment.schema';
import { InvestmentImportBatch, InvestmentImportBatchSchema } from './schemas/investment-import-batch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Investment.name, schema: InvestmentSchema },
      { name: InvestmentImportBatch.name, schema: InvestmentImportBatchSchema },
    ]),
    MulterModule.register({}),
  ],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, InvestmentsImportService],
})
export class InvestmentsModule {}
```

- [ ] **Step 5: Register InvestmentsModule in AppModule**

In `apps/api/src/app.module.ts`, add:
```ts
import { InvestmentsModule } from './investments/investments.module';
```
Add `InvestmentsModule` to imports after `RemittancesModule`.

- [ ] **Step 6: Verify build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/investments/ apps/api/src/app.module.ts
git commit -m "feat(investments): add full CRUD module with soft-delete, edit history, XLSX import"
```

---

### Task 10: Discount Schema + Loan Schema Additions

**Files:**
- Create: `apps/api/src/loans/schemas/discount.schema.ts`
- Modify: `apps/api/src/loans/schemas/loan.schema.ts`

- [ ] **Step 1: Create Discount schema**

Create `apps/api/src/loans/schemas/discount.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DiscountDocument = HydratedDocument<Discount>;

@Schema({ timestamps: true, collection: 'discounts' })
export class Discount {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) loanId!: string;
  @Prop({ required: true, enum: ['Origination', 'PayOff'] }) discountType!: 'Origination' | 'PayOff';
  @Prop({ required: true, min: 0 }) discountRate!: number;
  @Prop({ required: true, min: 0 }) discountAmount!: number;
  @Prop({ required: true }) dateGranted!: Date;
  @Prop({ default: false }) cancelled!: boolean;
  @Prop() cancelledAt?: Date;
  @Prop() cancelledReason?: string;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);
DiscountSchema.index({ loanId: 1 });
DiscountSchema.index({ staffId: 1 });
DiscountSchema.index({ cancelled: 1, discountType: 1 });
```

- [ ] **Step 2: Add fields to Loan schema**

In `apps/api/src/loans/schemas/loan.schema.ts`, add before the closing brace of the `Loan` class (after `recoveryRanAt`):
```ts
  @Prop() forfeitedAt?: Date;
  @Prop() payOffDate?: Date;
  @Prop({ min: 0, default: 0 }) payOffAmountReceived?: number;
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/loans/schemas/discount.schema.ts apps/api/src/loans/schemas/loan.schema.ts
git commit -m "feat(loans): add Discount schema; add forfeitedAt, payOffDate, payOffAmountReceived to Loan"
```

---

### Task 11: LoansService — getPayOffPreview + processPayOff

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts`
- Modify: `apps/api/src/loans/loans.module.ts`
- Create: `apps/api/src/loans/dto/process-payoff.dto.ts`

- [ ] **Step 1: Write failing tests for getPayOffPreview**

Add `apps/api/src/loans/loans.payoff.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { LoansService } from './loans.service';
import { Loan } from './schemas/loan.schema';
import { LoanRepayment } from './schemas/loan-repayment.schema';
import { Discount } from './schemas/discount.schema';
import { StaffService } from '../staff/staff.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ContributionsService } from '../contributions/contributions.service';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';
import { LoanRepaymentStatus } from '@welfare/shared';

const mockLoanModel = { findById: jest.fn(), find: jest.fn(), create: jest.fn(), updateOne: jest.fn() };
const mockRepaymentModel = { find: jest.fn(), updateMany: jest.fn(), create: jest.fn(), insertMany: jest.fn() };
const mockDiscountModel = { create: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() };
const mockConfig = { getAll: jest.fn().mockResolvedValue({ LOAN_PAYOFF_DISCOUNT_RATE: { value: '5' } }) };
const noop = { log: jest.fn() };
const minioMock = { presignedGetObject: jest.fn(), putObject: jest.fn() };
const meiliMock = { index: jest.fn().mockReturnValue({ updateSettings: jest.fn().mockResolvedValue({}), addDocuments: jest.fn() }) };

function buildService(overrides: any = {}) {
  return Test.createTestingModule({
    providers: [
      LoansService,
      { provide: getModelToken(Loan.name), useValue: { ...mockLoanModel, ...overrides.loan } },
      { provide: getModelToken(LoanRepayment.name), useValue: { ...mockRepaymentModel, ...overrides.repayment } },
      { provide: getModelToken(Discount.name), useValue: { ...mockDiscountModel, ...overrides.discount } },
      { provide: 'StaffModel', useValue: {} },
      { provide: StaffService, useValue: { findById: jest.fn() } },
      { provide: SystemConfigService, useValue: mockConfig },
      { provide: AuditService, useValue: noop },
      { provide: ContributionsService, useValue: {} },
      { provide: 'MINIO_CLIENT', useValue: minioMock },
      { provide: LoanScheduleSenderService, useValue: { sendForLoan: jest.fn() } },
      { provide: 'MEILISEARCH_CLIENT', useValue: meiliMock },
    ],
  }).compile();
}

describe('LoansService.getPayOffPreview', () => {
  it('throws NotFoundException for unknown loan', async () => {
    const module = await buildService();
    const svc = module.get<LoansService>(LoansService);
    mockLoanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(svc.getPayOffPreview('unknown')).rejects.toThrow(NotFoundException);
  });

  it('Tier 1 loan: no discount applied', async () => {
    const module = await buildService();
    const svc = module.get<LoansService>(LoansService);

    mockLoanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'l1', principalAmount: 10000, totalRepayable: 11000, tenureMonths: 6,
        disbursedDate: new Date('2024-01-01'), interestRate: 10,
      }),
    });
    mockRepaymentModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { status: LoanRepaymentStatus.Paid, paidAmount: 1833.33, principalAmount: 1666.67, interestAmount: 166.66 },
        { status: LoanRepaymentStatus.Paid, paidAmount: 1833.33, principalAmount: 1666.67, interestAmount: 166.66 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.33 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.33 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.33 },
        { status: LoanRepaymentStatus.Pending, paidAmount: 0, principalAmount: 1666.67, interestAmount: 166.66, dueAmount: 1833.34 },
      ]),
    });

    const preview = await svc.getPayOffPreview('l1');
    expect(preview.tier).toBe(1);
    expect(preview.discountApplied).toBe(false);
    expect(preview.discountAmount).toBe(0);
  });

  it('Tier 2 within 6 months: discount applied', async () => {
    const module = await buildService();
    const svc = module.get<LoansService>(LoansService);

    const disbursed = new Date();
    disbursed.setMonth(disbursed.getMonth() - 2);

    mockLoanModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'l2', principalAmount: 10000, totalRepayable: 11500, tenureMonths: 12,
        disbursedDate: disbursed, interestRate: 15,
      }),
    });
    mockRepaymentModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { status: LoanRepaymentStatus.Paid, paidAmount: 958.33, principalAmount: 833.33, interestAmount: 125 },
        { status: LoanRepaymentStatus.Paid, paidAmount: 958.33, principalAmount: 833.33, interestAmount: 125 },
        ...Array.from({ length: 10 }, () => ({
          status: LoanRepaymentStatus.Pending, paidAmount: 0,
          principalAmount: 833.33, interestAmount: 125, dueAmount: 958.33,
        })),
      ]),
    });

    const preview = await svc.getPayOffPreview('l2');
    expect(preview.tier).toBe(2);
    expect(preview.discountApplied).toBe(true);
    expect(preview.discountRate).toBe(5);
    expect(preview.discountAmount).toBeGreaterThan(0);
    expect(preview.netPayable).toBeLessThan(preview.remainingPrincipal + preview.remainingInterest);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx jest apps/api/src/loans/loans.payoff.spec.ts --no-coverage 2>&1 | head -15`
Expected: FAIL — getPayOffPreview is not a function

- [ ] **Step 3: Create ProcessPayOffDto**

Create `apps/api/src/loans/dto/process-payoff.dto.ts`:
```ts
import { IsDateString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ProcessPayOffDto {
  @Type(() => Number) @IsNumber() @Min(0) amountReceived!: number;
  @IsDateString() paymentDate!: string;
}
```

- [ ] **Step 4: Add Discount model injection to LoansService constructor and add pay-off methods**

In `apps/api/src/loans/loans.service.ts`:

Add import at top:
```ts
import { Discount, DiscountDocument } from './schemas/discount.schema';
```

Add to constructor (after `loanScheduleSender`):
```ts
@InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
```

Add the following methods to the service class (before the last closing brace):
```ts
async getPayOffPreview(loanId: string): Promise<IPayOffPreview> {
  const loan = await this.loanModel.findById(loanId).exec();
  if (!loan) throw new NotFoundException('Loan not found');

  const repayments = await this.repaymentModel.find({ loanId }).exec();
  const config = await this.configService.getAll();
  const payOffDiscountRate = parseFloat(config[ConfigKey.LoanPayOffDiscountRate]?.value ?? '5');

  const alreadyPaid = round2(repayments.reduce((s, r) => s + r.paidAmount, 0));
  const remaining = repayments.filter(r =>
    [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue].includes(r.status),
  );

  const remainingPrincipal = round2(remaining.reduce((s, r) => s + ((r.principalAmount ?? 0) - (r.status === LoanRepaymentStatus.Partial ? r.paidAmount * ((r.principalAmount ?? 0) / r.dueAmount) : 0)), 0));
  const remainingInterest = round2(remaining.reduce((s, r) => s + (r.interestAmount ?? 0), 0));

  const tier: 1 | 2 = loan.tenureMonths <= 6 ? 1 : 2;
  const monthsElapsed = monthsBetween(loan.disbursedDate, new Date());
  const withinDiscountWindow = tier === 2 && monthsElapsed < 6;
  const discountApplied = withinDiscountWindow;

  const discountAmount = discountApplied ? round2(remainingInterest * payOffDiscountRate / 100) : 0;
  const netPayable = round2(remainingPrincipal + remainingInterest - discountAmount);

  return {
    principal: loan.principalAmount,
    totalInterest: round2(loan.totalRepayable - loan.principalAmount),
    alreadyPaid,
    remainingPrincipal,
    remainingInterest,
    discountApplied,
    discountRate: discountApplied ? payOffDiscountRate : 0,
    discountAmount,
    netPayable,
    tier,
    withinDiscountWindow,
  };
}

async processPayOff(
  loanId: string,
  dto: { amountReceived: number; paymentDate: string },
  actorId: string,
  actorName: string,
): Promise<LoanDocument> {
  const loan = await this.loanModel.findById(loanId).exec();
  if (!loan) throw new NotFoundException('Loan not found');
  if (loan.status !== LoanStatus.Active) throw new BadRequestException('Loan is not Active');

  const preview = await this.getPayOffPreview(loanId);
  const paidDate = new Date(dto.paymentDate);

  await this.repaymentModel.updateMany(
    {
      loanId,
      status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
    },
    {
      $set: {
        paidAmount: dto.amountReceived > 0 ? undefined : 0,
        paidDate,
        source: RepaymentSource.PayOff,
        status: LoanRepaymentStatus.Paid,
      },
    },
  );

  // Mark each remaining repayment as fully paid with its dueAmount
  const remaining = await this.repaymentModel.find({
    loanId,
    status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial, LoanRepaymentStatus.Overdue] },
  }).exec();
  for (const r of remaining) {
    r.paidAmount = r.dueAmount;
    r.paidDate = paidDate;
    r.source = RepaymentSource.PayOff;
    r.status = LoanRepaymentStatus.Paid;
    await r.save();
  }

  await this.loanModel.updateOne(
    { _id: loanId },
    {
      status: LoanStatus.Completed,
      settledAt: paidDate,
      payOffDate: paidDate,
      payOffAmountReceived: dto.amountReceived,
    },
  );

  if (preview.discountApplied) {
    await this.discountModel.create({
      staffId: loan.staffId,
      loanId,
      discountType: 'PayOff',
      discountRate: preview.discountRate,
      discountAmount: preview.discountAmount,
      dateGranted: paidDate,
    });
  }

  this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, undefined, {
    event: 'payoff',
    amountReceived: dto.amountReceived,
    netPayable: preview.netPayable,
    discountApplied: preview.discountApplied,
  });

  return (await this.loanModel.findById(loanId).exec())!;
}
```

Also add `IPayOffPreview` to the existing shared imports at the top of `loans.service.ts`:
```ts
import { IPayOffPreview, ... } from '@welfare/shared';
```

- [ ] **Step 5: Register Discount model in LoansModule**

In `apps/api/src/loans/loans.module.ts`, add:
```ts
import { Discount, DiscountSchema } from './schemas/discount.schema';
```
Add to `MongooseModule.forFeature([...])`:
```ts
{ name: Discount.name, schema: DiscountSchema },
```

- [ ] **Step 6: Run tests to confirm pass**

Run: `npx jest apps/api/src/loans/loans.payoff.spec.ts --no-coverage`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.module.ts apps/api/src/loans/dto/process-payoff.dto.ts apps/api/src/loans/loans.payoff.spec.ts
git commit -m "feat(loans): add getPayOffPreview and processPayOff with tier-based discount logic"
```

---

### Task 12: Origination Discount at Loan Creation

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts`

- [ ] **Step 1: Add origination discount side-effect in createLoan**

In `apps/api/src/loans/loans.service.ts`, in the `create` method, after `void this.loanScheduleSender.sendForLoan(loan)...` line (just before `return loan;`):

```ts
    // Record origination discount for Tier 1 loans (tenureMonths ≤ 6, rate 10% vs 15%)
    if (dto.tenureMonths <= 6) {
      const discountAmount = round2(dto.principalAmount * 0.05);
      void this.discountModel.create({
        staffId: dto.staffId,
        loanId,
        discountType: 'Origination',
        discountRate: 5,
        discountAmount,
        dateGranted: disbursedDate,
      }).catch(err => this.logger.warn(`Failed to create origination discount: ${err.message}`));
    }
```

- [ ] **Step 2: Verify build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/loans/loans.service.ts
git commit -m "feat(loans): record origination Discount record when Tier 1 loan is created"
```

---

### Task 13: Discount Forfeiture in OverdueDetectionJob + Forfeiture Email Template

**Files:**
- Modify: `apps/api/src/loans/jobs/overdue-detection.job.ts`
- Modify: `apps/api/src/loans/loans.module.ts`
- Create: `apps/api/src/email/templates/loan-forfeiture-notice.template.tsx`

- [ ] **Step 1: Create forfeiture email template**

Create `apps/api/src/email/templates/loan-forfeiture-notice.template.tsx`:
```tsx
import * as React from 'react';
import { render } from '@react-email/render';

interface ForfeitureNoticeProps {
  staffName: string;
  loanRef: string;
  originalTotal: number;
  revisedTotal: number;
  clawbackAmount: number;
  newOutstanding: number;
  organisationName: string;
}

function fmt(n: number) {
  return `GHS ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function LoanForfeitureNoticeEmail(props: ForfeitureNoticeProps) {
  const { staffName, loanRef, originalTotal, revisedTotal, clawbackAmount, newOutstanding, organisationName } = props;
  return (
    <html>
      <body style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#111827', margin: 0, padding: 0, backgroundColor: '#f9fafb' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ padding: '24px 0' }}>
          <tr>
            <td align="center">
              <table width="520" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <tr>
                  <td style={{ backgroundColor: '#b91c1c', padding: '20px 32px', color: '#ffffff' }}>
                    <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>{organisationName}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.9 }}>Interest Rate Adjustment Notice</p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '28px 32px' }}>
                    <p style={{ margin: '0 0 16px' }}>Dear {staffName},</p>
                    <p style={{ margin: '0 0 16px' }}>
                      Your loan (Ref: <strong>{loanRef}</strong>) was approved under a short-tenure (≤ 6 months) arrangement at a discounted rate of <strong>10%</strong>. This discount is conditional on full settlement within the agreed tenure.
                    </p>
                    <p style={{ margin: '0 0 16px' }}>
                      As your loan has exceeded the 6-month period with an outstanding balance, the preferential rate has been withdrawn and your loan has been adjusted to the standard rate of <strong>15%</strong>.
                    </p>
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ margin: '0 0 16px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px' }}>
                      <tr style={{ backgroundColor: '#f9fafb' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#374151' }}>Original Total Repayable (10%)</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(originalTotal)}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#374151' }}>Revised Total Repayable (15%)</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(revisedTotal)}</td>
                      </tr>
                      <tr style={{ backgroundColor: '#fef2f2' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#b91c1c' }}>Additional Amount Reinstated</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#b91c1c' }}>{fmt(clawbackAmount)}</td>
                      </tr>
                      <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>New Outstanding Balance</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(newOutstanding)}</td>
                      </tr>
                    </table>
                    <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#6b7280' }}>
                      Please contact us on <strong>0244779991 / 0242906159</strong> if you have any questions.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '12px 32px', backgroundColor: '#f8fafc', borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#6b7280' }}>
                    {organisationName} — Welfare Department | Generated: {new Date().toLocaleDateString('en-GB')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  );
}

export async function renderLoanForfeitureNotice(props: ForfeitureNoticeProps): Promise<string> {
  return render(<LoanForfeitureNoticeEmail {...props} />);
}
```

- [ ] **Step 2: Add forfeiture detection to OverdueDetectionJob**

In `apps/api/src/loans/jobs/overdue-detection.job.ts`:

Add imports at top:
```ts
import { AuditEntity } from '@welfare/shared';
import { EmailLogType, EmailTriggerSource, IEmailRecipient } from '@welfare/shared';
import { Discount, DiscountDocument } from '../schemas/discount.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { renderLoanForfeitureNotice } from '../../email/templates/loan-forfeiture-notice.template';
```

Add to constructor (inject new dependencies):
```ts
@InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
@InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
private readonly emailService: EmailService,
```

Add a new private method `runForfeitureCheck`:
```ts
private async runForfeitureCheck(today: Date, config: ConfigMap): Promise<void> {
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const candidates = await this.loanModel.find({
    tenureMonths: { $lte: 6 },
    status: 'Active',
    forfeitedAt: { $exists: false },
    disbursedDate: { $lte: sixMonthsAgo },
  }).exec();

  for (const loan of candidates) {
    try {
      const loanId = loan._id.toString();
      const allRepayments = await this.repaymentModel.find({ loanId }).exec();
      const alreadyPaid = round2(allRepayments.reduce((s, r) => s + r.paidAmount, 0));

      const newTotalRepayable = round2(loan.principalAmount * 1.15);
      const newOutstanding = round2(newTotalRepayable - alreadyPaid);

      const unpaid = allRepayments
        .filter(r => ['Pending', 'Partial', 'Overdue'].includes(r.status))
        .sort((a, b) => a.instalmentNumber - b.instalmentNumber);

      const N = unpaid.length;
      if (N > 0) {
        const newTotalInterest = round2(newTotalRepayable - loan.principalAmount);
        const interestPerInst = round2(newTotalInterest / loan.tenureMonths);
        const baseNewDue = round2(newOutstanding / N);

        for (let i = 0; i < N; i++) {
          const inst = unpaid[i];
          const isLast = i === N - 1;
          const dueAmount = isLast ? round2(newOutstanding - baseNewDue * (N - 1)) : baseNewDue;
          const interestAmount = isLast ? round2(newTotalInterest - interestPerInst * (loan.tenureMonths - 1)) : interestPerInst;
          const principalAmount = round2(Math.max(0, dueAmount - interestAmount));
          await this.repaymentModel.updateOne({ _id: inst._id }, { dueAmount, principalAmount, interestAmount });
        }
      }

      const newMonthlyInstalment = N > 0 ? round2(newOutstanding / N) : loan.monthlyInstalment;
      await this.loanModel.updateOne(
        { _id: loanId },
        { interestRate: 15, totalRepayable: newTotalRepayable, monthlyInstalment: newMonthlyInstalment, forfeitedAt: today },
      );

      await this.discountModel.updateOne(
        { loanId, discountType: 'Origination', cancelled: false },
        { cancelled: true, cancelledAt: today, cancelledReason: 'Discount forfeiture: loan crossed 6-month threshold with outstanding balance' },
      );

      this.auditService.log(
        'system', 'System', AuditAction.Update, AuditEntity.Loan, loanId, undefined,
        { event: 'forfeiture', originalTotal: loan.totalRepayable, revisedTotal: newTotalRepayable, clawback: round2(newTotalRepayable - loan.totalRepayable) },
      );

      const staff = await this.staffModel.findById(loan.staffId).exec();
      if (staff?.email) {
        const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';
        const loanRef = loanId.slice(-6).toUpperCase();
        const html = await renderLoanForfeitureNotice({
          staffName: staff.fullName,
          loanRef,
          originalTotal: loan.totalRepayable,
          revisedTotal: newTotalRepayable,
          clawbackAmount: round2(newTotalRepayable - loan.totalRepayable),
          newOutstanding,
          organisationName,
        });
        const recipient: IEmailRecipient = { staffId: loan.staffId, staffName: staff.fullName, email: staff.email };
        await this.emailService.send(
          recipient,
          EmailLogType.LoanForfeitureNotice,
          'Interest Rate Adjustment on Your Loan',
          html,
          EmailTriggerSource.Cron,
        );
      }

      this.logger.log(`Forfeiture applied to loan ${loanId}`);
    } catch (err) {
      this.logger.error(`Forfeiture failed for loan ${loan._id.toString()}`, err);
    }
  }
}
```

At the TOP of `detectAndProcess()`, after the `config` and `today` lines, add:
```ts
    await this.runForfeitureCheck(today, config as ConfigMap);
```

- [ ] **Step 3: Register Discount + Staff models in LoansModule**

In `apps/api/src/loans/loans.module.ts`, add `Discount` and `Staff` to `MongooseModule.forFeature` if not already present:
```ts
{ name: Discount.name, schema: DiscountSchema },  // already added in Task 11
```
(Staff model is already registered.)

- [ ] **Step 4: Verify build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/jobs/overdue-detection.job.ts apps/api/src/email/templates/loan-forfeiture-notice.template.tsx apps/api/src/loans/loans.module.ts
git commit -m "feat(loans): add discount forfeiture detection in OverdueDetectionJob with full-principal recalculation and notice email"
```

---

### Task 14: Payment Reminder Email Template + Job

**Files:**
- Create: `apps/api/src/email/templates/loan-payment-reminder.template.tsx`
- Create: `apps/api/src/loans/jobs/payment-reminder.job.ts`
- Modify: `apps/api/src/loans/loans.module.ts`

- [ ] **Step 1: Create payment reminder email template**

Create `apps/api/src/email/templates/loan-payment-reminder.template.tsx`:
```tsx
import * as React from 'react';
import { render } from '@react-email/render';

interface LoanPaymentReminderProps {
  staffName: string;
  loanRef: string;
  amountDue: number;
  dueDate: string;
  organisationName: string;
}

function fmt(n: number) {
  return `GHS ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function LoanPaymentReminderEmail(props: LoanPaymentReminderProps) {
  const { staffName, loanRef, amountDue, dueDate, organisationName } = props;
  return (
    <html>
      <body style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#111827', margin: 0, padding: 0, backgroundColor: '#f9fafb' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ padding: '24px 0' }}>
          <tr>
            <td align="center">
              <table width="520" cellPadding={0} cellSpacing={0} style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <tr>
                  <td style={{ backgroundColor: '#d97706', padding: '20px 32px', color: '#ffffff' }}>
                    <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>{organisationName}</p>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.9 }}>Loan Payment Reminder</p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '28px 32px' }}>
                    <p style={{ margin: '0 0 16px' }}>Dear {staffName},</p>
                    <p style={{ margin: '0 0 16px' }}>
                      This is a reminder that your loan instalment of <strong>{fmt(amountDue)}</strong> (Ref: <strong>{loanRef}</strong>) is due in <strong>7 days</strong> on <strong>{new Date(dueDate).toLocaleDateString('en-GB')}</strong>.
                    </p>
                    <p style={{ margin: '0 0 16px', padding: '12px 16px', backgroundColor: '#fef3c7', borderRadius: '6px', fontSize: '13px' }}>
                      Please ensure payment is made before the due date to avoid any penalties.
                    </p>
                    <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                      For enquiries, contact us on: <strong>0244779991 / 0242906159</strong>
                    </p>
                    <p style={{ margin: '0', color: '#6b7280', fontSize: '13px' }}>
                      If you have already made this payment, please disregard this notice.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '12px 32px', backgroundColor: '#f8fafc', borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#6b7280' }}>
                    {organisationName} — Welfare Department | Generated: {new Date().toLocaleDateString('en-GB')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  );
}

export async function renderLoanPaymentReminder(props: LoanPaymentReminderProps): Promise<string> {
  return render(<LoanPaymentReminderEmail {...props} />);
}
```

- [ ] **Step 2: Create PaymentReminderJob**

Create `apps/api/src/loans/jobs/payment-reminder.job.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EmailLogType,
  EmailTriggerSource,
  IEmailRecipient,
  LoanRepaymentStatus,
  LoanStatus,
} from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderLoanPaymentReminder } from '../../email/templates/loan-payment-reminder.template';

@Injectable()
export class PaymentReminderJob {
  private readonly logger = new Logger(PaymentReminderJob.name);

  constructor(
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly emailService: EmailService,
    private readonly configService: SystemConfigService,
  ) {}

  @Cron('10 0 * * *')
  async sendPaymentReminders(): Promise<void> {
    this.logger.log('Starting payment reminder job');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 7);
    const targetEnd = new Date(targetDate);
    targetEnd.setHours(23, 59, 59, 999);

    const dueRepayments = await this.repaymentModel
      .find({
        dueDate: { $gte: targetDate, $lte: targetEnd },
        status: { $in: [LoanRepaymentStatus.Pending, LoanRepaymentStatus.Partial] },
      })
      .exec();

    this.logger.log(`Found ${dueRepayments.length} repayments due in 7 days`);
    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    for (const repayment of dueRepayments) {
      try {
        const [loan, staff] = await Promise.all([
          this.loanModel.findById(repayment.loanId).exec(),
          this.staffModel.findById(repayment.staffId).exec(),
        ]);

        if (!loan || loan.status !== LoanStatus.Active) continue;
        if (!staff?.email) continue;

        const loanRef = repayment.loanId.slice(-6).toUpperCase();
        const html = await renderLoanPaymentReminder({
          staffName: staff.fullName,
          loanRef,
          amountDue: repayment.dueAmount,
          dueDate: repayment.dueDate.toISOString(),
          organisationName,
        });

        const recipient: IEmailRecipient = {
          staffId: repayment.staffId,
          staffName: staff.fullName,
          email: staff.email,
        };

        await this.emailService.send(
          recipient,
          EmailLogType.LoanPaymentReminder,
          `Loan Payment Reminder — Due ${repayment.dueDate.toLocaleDateString('en-GB')}`,
          html,
          EmailTriggerSource.Cron,
        );
      } catch (err) {
        this.logger.error(`Reminder failed for repayment ${repayment._id.toString()}`, err);
      }
    }

    this.logger.log('Payment reminder job complete');
  }
}
```

- [ ] **Step 3: Register PaymentReminderJob in LoansModule**

In `apps/api/src/loans/loans.module.ts`, add to providers:
```ts
import { PaymentReminderJob } from './jobs/payment-reminder.job';
```
Add `PaymentReminderJob` to the `providers` array.

- [ ] **Step 4: Verify build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/jobs/payment-reminder.job.ts apps/api/src/email/templates/loan-payment-reminder.template.tsx apps/api/src/loans/loans.module.ts
git commit -m "feat(loans): add 7-day payment reminder cron job and email template"
```

---

### Task 15: Pay-Off Controller Endpoints

**Files:**
- Modify: `apps/api/src/loans/loans.controller.ts`

- [ ] **Step 1: Add pay-off endpoints to LoansController**

In `apps/api/src/loans/loans.controller.ts`, add import:
```ts
import { ProcessPayOffDto } from './dto/process-payoff.dto';
```

Add these two methods to the controller (after the existing `recordPayment` handler):
```ts
  @Get(':id/payoff-preview')
  @RequirePermission(AppModule.Loans, 'readonly')
  getPayOffPreview(@Param('id') id: string) {
    return this.loansService.getPayOffPreview(id);
  }

  @Post(':id/payoff')
  @RequirePermission(AppModule.Loans, 'full')
  processPayOff(
    @Param('id') id: string,
    @Body() dto: ProcessPayOffDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.loansService.processPayOff(id, dto, user.sub, user.displayName);
  }
```

- [ ] **Step 2: Verify build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/loans/loans.controller.ts
git commit -m "feat(loans): add GET /loans/:id/payoff-preview and POST /loans/:id/payoff endpoints"
```

---

### Task 16: Backfill Migration

**Files:**
- Create: `apps/api/src/loans/migrations/backfill-origination-discounts.ts`

- [ ] **Step 1: Create migration script**

Create `apps/api/src/loans/migrations/backfill-origination-discounts.ts`:
```ts
/**
 * Backfill origination Discount records for existing Tier 1 loans
 * that were created before the discount feature was introduced.
 *
 * Usage: npx ts-node -r tsconfig-paths/register apps/api/src/loans/migrations/backfill-origination-discounts.ts
 *
 * Idempotent: safe to run multiple times.
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/welfare';

const LoanSchema = new mongoose.Schema({
  staffId: String,
  tenureMonths: Number,
  interestRate: Number,
  principalAmount: Number,
  disbursedDate: Date,
  status: String,
});

const DiscountSchema = new mongoose.Schema({
  staffId: String,
  loanId: String,
  discountType: String,
  discountRate: Number,
  discountAmount: Number,
  dateGranted: Date,
  cancelled: { type: Boolean, default: false },
});

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const LoanModel = mongoose.model('Loan', LoanSchema, 'loans');
  const DiscountModel = mongoose.model('Discount', DiscountSchema, 'discounts');

  const tier1Loans = await LoanModel.find({
    tenureMonths: { $lte: 6 },
    interestRate: { $lte: 10 },
  }).lean();

  console.log(`Found ${tier1Loans.length} Tier 1 loans to check`);

  let created = 0;
  let skipped = 0;

  for (const loan of tier1Loans) {
    const loanId = (loan._id as mongoose.Types.ObjectId).toString();
    const existing = await DiscountModel.findOne({ loanId, discountType: 'Origination' });

    if (existing) {
      skipped++;
      continue;
    }

    const discountAmount = Math.round(loan.principalAmount * 0.05 * 100) / 100;
    await DiscountModel.create({
      staffId: loan.staffId,
      loanId,
      discountType: 'Origination',
      discountRate: 5,
      discountAmount,
      dateGranted: loan.disbursedDate,
      cancelled: false,
    });
    created++;
  }

  console.log(`Backfill complete: ${created} created, ${skipped} skipped (already had record)`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/loans/migrations/
git commit -m "feat(loans): add backfill migration for origination discount records on existing Tier 1 loans"
```
