# Remittances, Investments, Loan Pay-Off — Part 1: Shared Foundations + Remittances API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend shared enums/interfaces and build the Remittances API module (schema, service, import, controller, module registration).

**Architecture:** Remittances is a standalone NestJS module that snapshots gross contribution amounts at record time. The XLSX import flags duplicate periods rather than silently skipping them. Export helpers (CSV + PDF) are implemented directly in the controller following the same pattern as ReportsController.

**Tech Stack:** NestJS · Mongoose · XLSX · json2csv · Puppeteer · Jest · class-validator

---

### Task 1: Extend Shared Enums

**Files:**
- Modify: `packages/shared/src/enums/app-module.enum.ts`
- Modify: `packages/shared/src/enums/config-key.enum.ts`
- Modify: `packages/shared/src/enums/email-log-type.enum.ts`
- Modify: `packages/shared/src/enums/repayment-source.enum.ts`

- [ ] **Step 1: Add Remittances and Investments to AppModule**

Replace the contents of `packages/shared/src/enums/app-module.enum.ts`:
```ts
export enum AppModule {
  Contributions  = 'contributions',
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

- [ ] **Step 2: Add two ConfigKey values**

Replace contents of `packages/shared/src/enums/config-key.enum.ts`:
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
  RemittanceChargeRate = 'REMITTANCE_CHARGE_RATE',
  LoanPayOffDiscountRate = 'LOAN_PAYOFF_DISCOUNT_RATE',
}
```

- [ ] **Step 3: Add two EmailLogType values**

Replace contents of `packages/shared/src/enums/email-log-type.enum.ts`:
```ts
export enum EmailLogType {
  ContributionStatement = 'ContributionStatement',
  LoanSchedule = 'LoanSchedule',
  PaymentReminder = 'PaymentReminder',
  LoanPaymentReminder = 'LoanPaymentReminder',
  LoanForfeitureNotice = 'LoanForfeitureNotice',
}
```

- [ ] **Step 4: Add PayOff to RepaymentSource**

Replace contents of `packages/shared/src/enums/repayment-source.enum.ts`:
```ts
export enum RepaymentSource {
  DirectPayment = 'DirectPayment',
  Import = 'Import',
  GuarantorOffset = 'GuarantorOffset',
  ExitDeduction = 'ExitDeduction',
  PayOff = 'PayOff',
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc -p packages/shared/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/enums/
git commit -m "feat(shared): add Remittances, Investments, PayOff, LoanPaymentReminder, LoanForfeitureNotice enums"
```

---

### Task 2: Add Shared Interfaces

**Files:**
- Modify: `packages/shared/src/interfaces/report.interface.ts`

- [ ] **Step 1: Append new interfaces after existing content**

At the bottom of `packages/shared/src/interfaces/report.interface.ts`, append:
```ts
export interface IRemittanceReportRow {
  period: string;
  receiptDate: string;
  grossAmount: number;
  charges: number;
  netPayable: number;
}

export interface IRemittanceReport {
  rows: IRemittanceReportRow[];
  totalGross: number;
  totalCharges: number;
  totalNet: number;
}

export interface IInvestmentRow {
  id: string;
  purchaseDate: string;
  description: string;
  cost: number;
  maturityDate: string;
  faceValue: number;
  interest: number;
  rate: number;
  status: 'Active' | 'Matured';
  instruction: 'One-Time' | 'Roll-Over';
}

export interface IPayOffPreview {
  principal: number;
  totalInterest: number;
  alreadyPaid: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discountApplied: boolean;
  discountRate: number;
  discountAmount: number;
  netPayable: number;
  tier: 1 | 2;
  withinDiscountWindow: boolean;
}

export interface IDiscountRecord {
  id: string;
  staffId: string;
  staffName: string;
  loanId: string;
  discountType: 'Origination' | 'PayOff';
  discountRate: number;
  discountAmount: number;
  dateGranted: string;
  cancelled: boolean;
}

export interface IFundSummaryDiscountRow {
  staffName: string;
  loanReference: string;
  discountType: 'Origination' | 'PayOff';
  rate: number;
  amount: number;
  dateGranted: string;
}
```

- [ ] **Step 2: Update IFundSummaryReport to add discount fields**

In `packages/shared/src/interfaces/report.interface.ts`, replace the `IFundSummaryReport` interface:
```ts
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
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -p packages/shared/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/interfaces/report.interface.ts
git commit -m "feat(shared): add remittance, investment, pay-off, discount interfaces; extend IFundSummaryReport"
```

---

### Task 3: Remittance + Import Batch Schemas

**Files:**
- Create: `apps/api/src/remittances/schemas/remittance.schema.ts`
- Create: `apps/api/src/remittances/schemas/remittance-import-batch.schema.ts`

- [ ] **Step 1: Create Remittance schema**

Create `apps/api/src/remittances/schemas/remittance.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RemittanceDocument = HydratedDocument<Remittance>;

@Schema({ timestamps: true, collection: 'remittances' })
export class Remittance {
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 2000 }) year!: number;
  @Prop({ required: true, min: 0 }) grossAmount!: number;
  @Prop({ required: true, min: 0 }) chargeRate!: number;
  @Prop({ required: true, min: 0 }) charges!: number;
  @Prop({ required: true, min: 0 }) netPayable!: number;
  @Prop({ required: true }) receiptDate!: Date;
  @Prop({ required: true }) recordedBy!: string;
  @Prop() importBatchId?: string;
}

export const RemittanceSchema = SchemaFactory.createForClass(Remittance);
RemittanceSchema.index({ month: 1, year: 1 }, { unique: true });
```

- [ ] **Step 2: Create RemittanceImportBatch schema**

Create `apps/api/src/remittances/schemas/remittance-import-batch.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RemittanceImportBatchDocument = HydratedDocument<RemittanceImportBatch>;

interface RemittanceFlaggedRow {
  rowNumber: number;
  month: number;
  year: number;
  flagReason: string;
}

@Schema({ timestamps: true, collection: 'remittance_import_batches' })
export class RemittanceImportBatch {
  @Prop({ required: true }) fileName!: string;
  @Prop({ required: true }) recordedBy!: string;
  @Prop({ required: true, default: 0 }) total!: number;
  @Prop({ required: true, default: 0 }) imported!: number;
  @Prop({ required: true, default: 0 }) flagged!: number;
  @Prop({ type: [Object], default: [] }) flaggedRows!: RemittanceFlaggedRow[];
}

export const RemittanceImportBatchSchema = SchemaFactory.createForClass(RemittanceImportBatch);
```

- [ ] **Step 3: Verify API builds**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/remittances/schemas/
git commit -m "feat(remittances): add Remittance and RemittanceImportBatch schemas"
```

---

### Task 4: RemittancesService

**Files:**
- Create: `apps/api/src/remittances/remittances.service.ts`
- Create: `apps/api/src/remittances/remittances.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/remittances/remittances.service.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException } from '@nestjs/common';
import { RemittancesService } from './remittances.service';
import { Remittance } from './schemas/remittance.schema';
import { Contribution } from '../contributions/schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';

const mockRemittanceModel = {
  findOne: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};
const mockContribModel = { aggregate: jest.fn() };
const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({ REMITTANCE_CHARGE_RATE: { value: '3' } }),
};

describe('RemittancesService', () => {
  let service: RemittancesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesService,
        { provide: getModelToken(Remittance.name), useValue: mockRemittanceModel },
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: SystemConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<RemittancesService>(RemittancesService);
    jest.clearAllMocks();
    mockConfigService.getAll.mockResolvedValue({ REMITTANCE_CHARGE_RATE: { value: '3' } });
  });

  describe('getGrossForPeriod', () => {
    it('returns 0 when no contributions', async () => {
      mockContribModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      expect(await service.getGrossForPeriod(1, 2025)).toBe(0);
    });

    it('sums paidAmount from aggregate', async () => {
      mockContribModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ total: 12000 }]) });
      expect(await service.getGrossForPeriod(1, 2025)).toBe(12000);
    });
  });

  describe('getGrossPreview', () => {
    it('computes 3% charges and netPayable', async () => {
      jest.spyOn(service, 'getGrossForPeriod').mockResolvedValue(10000);
      const result = await service.getGrossPreview(1, 2025);
      expect(result).toEqual({ grossAmount: 10000, charges: 300, netPayable: 9700 });
    });
  });

  describe('create', () => {
    it('throws ConflictException when period already recorded', async () => {
      mockRemittanceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ month: 1, year: 2025 }) });
      await expect(service.create({ month: 1, year: 2025, receiptDate: '2025-01-31' }, 'uid')).rejects.toThrow(ConflictException);
    });

    it('creates record with snapshotted values', async () => {
      mockRemittanceModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      jest.spyOn(service, 'getGrossForPeriod').mockResolvedValue(10000);
      mockRemittanceModel.create.mockResolvedValue({ _id: 'r1', month: 1, year: 2025 });
      await service.create({ month: 1, year: 2025, receiptDate: '2025-01-31' }, 'uid');
      expect(mockRemittanceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ grossAmount: 10000, charges: 300, netPayable: 9700, chargeRate: 3 }),
      );
    });
  });

  describe('getReport', () => {
    it('returns totals summed from rows', async () => {
      const records = [
        { month: 1, year: 2025, receiptDate: new Date('2025-01-31'), grossAmount: 10000, charges: 300, netPayable: 9700 },
        { month: 2, year: 2025, receiptDate: new Date('2025-02-28'), grossAmount: 8000, charges: 240, netPayable: 7760 },
      ];
      mockRemittanceModel.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(records) }) });
      const result = await service.getReport(1, 2025, 2, 2025);
      expect(result.totalGross).toBe(18000);
      expect(result.totalCharges).toBe(540);
      expect(result.totalNet).toBe(17460);
      expect(result.rows).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx jest apps/api/src/remittances/remittances.service.spec.ts --no-coverage 2>&1 | head -20`
Expected: FAIL — "Cannot find module './remittances.service'"

- [ ] **Step 3: Create RemittancesService**

Create `apps/api/src/remittances/remittances.service.ts`:
```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigKey, IRemittanceReport, IRemittanceReportRow, PaginatedResult } from '@welfare/shared';
import { Remittance, RemittanceDocument } from './schemas/remittance.schema';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { SystemConfigService } from '../system-config/system-config.service';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function r2(n: number) { return Math.round(n * 100) / 100; }

export interface CreateRemittanceDto {
  month: number;
  year: number;
  receiptDate: string;
}

@Injectable()
export class RemittancesService {
  constructor(
    @InjectModel(Remittance.name) private readonly remittanceModel: Model<RemittanceDocument>,
    @InjectModel(Contribution.name) private readonly contribModel: Model<ContributionDocument>,
    private readonly configService: SystemConfigService,
  ) {}

  async getGrossForPeriod(month: number, year: number): Promise<number> {
    const res = await this.contribModel
      .aggregate([
        { $match: { month, year, isDebit: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } },
      ])
      .exec();
    return res[0]?.total ?? 0;
  }

  async getGrossPreview(
    month: number,
    year: number,
  ): Promise<{ grossAmount: number; charges: number; netPayable: number }> {
    const config = await this.configService.getAll();
    const chargeRate = parseFloat((config as any)[ConfigKey.RemittanceChargeRate]?.value ?? '3');
    const grossAmount = await this.getGrossForPeriod(month, year);
    const charges = r2(grossAmount * chargeRate / 100);
    const netPayable = r2(grossAmount - charges);
    return { grossAmount, charges, netPayable };
  }

  async create(dto: CreateRemittanceDto, actorId: string): Promise<RemittanceDocument> {
    const existing = await this.remittanceModel.findOne({ month: dto.month, year: dto.year }).exec();
    if (existing) throw new ConflictException(`Remittance for ${dto.month}/${dto.year} already exists`);

    const config = await this.configService.getAll();
    const chargeRate = parseFloat((config as any)[ConfigKey.RemittanceChargeRate]?.value ?? '3');
    const grossAmount = await this.getGrossForPeriod(dto.month, dto.year);
    const charges = r2(grossAmount * chargeRate / 100);
    const netPayable = r2(grossAmount - charges);

    return this.remittanceModel.create({
      month: dto.month,
      year: dto.year,
      grossAmount,
      chargeRate,
      charges,
      netPayable,
      receiptDate: new Date(dto.receiptDate),
      recordedBy: actorId,
    });
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedResult<RemittanceDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.remittanceModel.find().sort({ year: -1, month: -1 }).skip(skip).limit(limit).exec(),
      this.remittanceModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getReport(
    fromMonth: number,
    fromYear: number,
    toMonth: number,
    toYear: number,
  ): Promise<IRemittanceReport> {
    const periods: { month: number; year: number }[] = [];
    let m = fromMonth, y = fromYear;
    while (y < toYear || (y === toYear && m <= toMonth)) {
      periods.push({ month: m, year: y });
      if (++m > 12) { m = 1; y++; }
    }

    const records = await this.remittanceModel
      .find({ $or: periods })
      .sort({ year: 1, month: 1 })
      .exec();

    const rows: IRemittanceReportRow[] = records.map(r => ({
      period: `${MONTHS[r.month - 1]} ${r.year}`,
      receiptDate: r.receiptDate.toLocaleDateString('en-GB'),
      grossAmount: r.grossAmount,
      charges: r.charges,
      netPayable: r.netPayable,
    }));

    return {
      rows,
      totalGross: r2(rows.reduce((s, r) => s + r.grossAmount, 0)),
      totalCharges: r2(rows.reduce((s, r) => s + r.charges, 0)),
      totalNet: r2(rows.reduce((s, r) => s + r.netPayable, 0)),
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx jest apps/api/src/remittances/remittances.service.spec.ts --no-coverage`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/remittances/remittances.service.ts apps/api/src/remittances/remittances.service.spec.ts
git commit -m "feat(remittances): add RemittancesService with getGrossPreview, create, findAll, getReport"
```

---

### Task 5: RemittancesImportService

**Files:**
- Create: `apps/api/src/remittances/remittances.import.service.ts`
- Create: `apps/api/src/remittances/remittances.import.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/remittances/remittances.import.service.spec.ts`:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { RemittancesImportService } from './remittances.import.service';
import { RemittanceImportBatch } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';

function makeBuffer(rows: object[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const mockBatchModel = {
  create: jest.fn().mockResolvedValue({ _id: 'batch1' }),
  updateOne: jest.fn().mockResolvedValue({}),
};
const mockRemittancesService = {
  create: jest.fn(),
};

describe('RemittancesImportService', () => {
  let service: RemittancesImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesImportService,
        { provide: getModelToken(RemittanceImportBatch.name), useValue: mockBatchModel },
        { provide: RemittancesService, useValue: mockRemittancesService },
      ],
    }).compile();
    service = module.get<RemittancesImportService>(RemittancesImportService);
    jest.clearAllMocks();
    mockBatchModel.create.mockResolvedValue({ _id: 'batch1' });
    mockBatchModel.updateOne.mockResolvedValue({});
  });

  it('throws BadRequestException on empty file', async () => {
    const buf = makeBuffer([]);
    await expect(service.processImport(buf, 'test.xlsx', 'uid', 'User')).rejects.toThrow(BadRequestException);
  });

  it('flags duplicate period (ConflictException from service)', async () => {
    mockRemittancesService.create.mockRejectedValue({ status: 409, message: 'already exists' });
    const buf = makeBuffer([{ Month: 1, Year: 2025, 'Receipt Date': '31/01/2025' }]);
    const result = await service.processImport(buf, 'test.xlsx', 'uid', 'User');
    expect(result.flagged).toBe(1);
    expect(result.imported).toBe(0);
    expect(mockBatchModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ flagged: 1 }),
    );
  });

  it('imports valid rows and counts correctly', async () => {
    mockRemittancesService.create.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const rows = [
      { Month: 1, Year: 2025, 'Receipt Date': '31/01/2025' },
      { Month: 2, Year: 2025, 'Receipt Date': '28/02/2025' },
    ];
    const result = await service.processImport(makeBuffer(rows), 'test.xlsx', 'uid', 'User');
    expect(result.imported).toBe(2);
    expect(result.flagged).toBe(0);
  });

  it('flags rows with invalid Month', async () => {
    const buf = makeBuffer([{ Month: 13, Year: 2025, 'Receipt Date': '31/01/2025' }]);
    const result = await service.processImport(buf, 'test.xlsx', 'uid', 'User');
    expect(result.flagged).toBe(1);
    expect(mockRemittancesService.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx jest apps/api/src/remittances/remittances.import.service.spec.ts --no-coverage 2>&1 | head -10`
Expected: FAIL — "Cannot find module './remittances.import.service'"

- [ ] **Step 3: Create RemittancesImportService**

Create `apps/api/src/remittances/remittances.import.service.ts`:
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import { RemittanceImportBatch, RemittanceImportBatchDocument } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';

interface RemittanceExcelRow {
  Month?: number;
  Year?: number;
  'Receipt Date'?: string;
}

@Injectable()
export class RemittancesImportService {
  constructor(
    @InjectModel(RemittanceImportBatch.name)
    private readonly batchModel: Model<RemittanceImportBatchDocument>,
    private readonly remittancesService: RemittancesService,
  ) {}

  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
  ): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<RemittanceExcelRow>(sheet);

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
    const flaggedRows: Array<{ rowNumber: number; month: number; year: number; flagReason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const month = Number(row.Month ?? 0);
      const year = Number(row.Year ?? 0);
      const receiptDate = String(row['Receipt Date'] ?? '').trim();

      if (!month || month < 1 || month > 12) {
        flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Invalid or missing Month (must be 1–12)' });
        continue;
      }
      if (!year || year < 2000) {
        flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Invalid or missing Year (must be ≥ 2000)' });
        continue;
      }
      if (!receiptDate) {
        flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Missing Receipt Date' });
        continue;
      }

      try {
        await this.remittancesService.create({ month, year, receiptDate }, actorId);
        imported++;
      } catch (err: any) {
        const isDuplicate = err?.status === 409 || err?.message?.includes('already exists');
        flaggedRows.push({
          rowNumber: i + 2,
          month,
          year,
          flagReason: isDuplicate ? 'Duplicate period' : (err?.message ?? 'Unknown error'),
        });
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

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx jest apps/api/src/remittances/remittances.import.service.spec.ts --no-coverage`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/remittances/remittances.import.service.ts apps/api/src/remittances/remittances.import.service.spec.ts
git commit -m "feat(remittances): add RemittancesImportService with XLSX processing and duplicate detection"
```

---

### Task 6: DTOs + Controller + Module + AppModule Registration

**Files:**
- Create: `apps/api/src/remittances/dto/create-remittance.dto.ts`
- Create: `apps/api/src/remittances/dto/remittance-query.dto.ts`
- Create: `apps/api/src/remittances/remittances.controller.ts`
- Create: `apps/api/src/remittances/remittances.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

Create `apps/api/src/remittances/dto/create-remittance.dto.ts`:
```ts
import { IsInt, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRemittanceDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @Type(() => Number) @IsInt() @Min(2000) year!: number;
  @IsString() receiptDate!: string;
}
```

Create `apps/api/src/remittances/dto/remittance-query.dto.ts`:
```ts
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class RemittanceQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() fromMonth?: number;
  @IsOptional() @Type(() => Number) @IsInt() fromYear?: number;
  @IsOptional() @Type(() => Number) @IsInt() toMonth?: number;
  @IsOptional() @Type(() => Number) @IsInt() toYear?: number;
  @IsOptional() @IsString() format?: 'csv' | 'pdf';
}
```

- [ ] **Step 2: Create RemittancesController**

Create `apps/api/src/remittances/remittances.controller.ts`:
```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { parse as toCsv } from 'json2csv';
import puppeteer from 'puppeteer';
import { AppModule } from '@welfare/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RemittancesService } from './remittances.service';
import { RemittancesImportService } from './remittances.import.service';
import { CreateRemittanceDto } from './dto/create-remittance.dto';
import { RemittanceQueryDto } from './dto/remittance-query.dto';

const CSV_COLUMNS = [
  { header: 'Period',           field: 'period' },
  { header: 'Receipt Date',     field: 'receiptDate' },
  { header: 'Gross Amt (GHS)',  field: 'grossAmount' },
  { header: 'Charges (GHS)',    field: 'charges' },
  { header: 'Net Payable (GHS)',field: 'netPayable' },
];

@Controller('remittances')
export class RemittancesController {
  constructor(
    private readonly service: RemittancesService,
    private readonly importService: RemittancesImportService,
  ) {}

  @Get('gross')
  @RequirePermission(AppModule.Remittances, 'readonly')
  getGross(@Query('month') month: string, @Query('year') year: string) {
    if (!month || !year) throw new BadRequestException('month and year are required');
    return this.service.getGrossPreview(+month, +year);
  }

  @Get()
  @RequirePermission(AppModule.Remittances, 'readonly')
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(page ? +page : 1, limit ? +limit : 20);
  }

  @Post()
  @RequirePermission(AppModule.Remittances, 'full')
  create(
    @Body() dto: CreateRemittanceDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.create(dto, user.sub);
  }

  @Post('import')
  @RequirePermission(AppModule.Remittances, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.processImport(file.buffer, file.originalname, user.sub, user.displayName);
  }

  @Get('report')
  @RequirePermission(AppModule.Remittances, 'readonly')
  async getReport(
    @Query() q: RemittanceQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fm = q.fromMonth ?? 1;
    const fy = q.fromYear ?? new Date().getFullYear();
    const tm = q.toMonth ?? 12;
    const ty = q.toYear ?? new Date().getFullYear();

    if (ty < fy || (ty === fy && (tm ?? 12) < (fm ?? 1))) {
      throw new BadRequestException('To period must not precede From period');
    }

    const report = await this.service.getReport(fm, fy, tm, ty);

    if (q.format === 'csv') {
      const fields = CSV_COLUMNS.map(c => c.field);
      const csv = toCsv(report.rows, { fields });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="remittances-${fy}-${fm}-to-${ty}-${tm}.csv"`);
      res.send(csv);
      return;
    }

    if (q.format === 'pdf') {
      const logoPath = path.join(__dirname, '..', 'reports', 'assets', 'ncc-logo.png');
      const logoBase64 = fs.existsSync(logoPath)
        ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
        : '';

      const headers = CSV_COLUMNS.map(c => `<th>${c.header}</th>`).join('');
      const bodyRows = report.rows
        .map(row => `<tr>${CSV_COLUMNS.map(c => `<td>${(row as any)[c.field] ?? ''}</td>`).join('')}</tr>`)
        .join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:20px}
  h1{font-size:18px;margin-bottom:4px}
  .meta{color:#666;font-size:11px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}
  th{background:#bc4680;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px}
  tr:nth-child(even) td{background:#f9fafb}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;height:320px;background-image:url('${logoBase64}');background-size:contain;background-repeat:no-repeat;background-position:center;opacity:0.05;z-index:0;pointer-events:none}
</style></head><body>
${logoBase64 ? '<div class="watermark"></div>' : ''}
<h1>Remittances Report</h1>
<div class="meta">Period: ${fm}/${fy} – ${tm}/${ty} | Generated: ${new Date().toLocaleString('en-GB')}</div>
<table><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`;

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', right: '10mm', bottom: '16mm', left: '10mm' } });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="remittances-report.pdf"`);
        res.end(Buffer.from(pdf));
      } finally {
        await browser.close();
      }
      return;
    }

    return report;
  }
}
```

- [ ] **Step 3: Create RemittancesModule**

Create `apps/api/src/remittances/remittances.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { RemittancesController } from './remittances.controller';
import { RemittancesService } from './remittances.service';
import { RemittancesImportService } from './remittances.import.service';
import { Remittance, RemittanceSchema } from './schemas/remittance.schema';
import { RemittanceImportBatch, RemittanceImportBatchSchema } from './schemas/remittance-import-batch.schema';
import { Contribution, ContributionSchema } from '../contributions/schemas/contribution.schema';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Remittance.name, schema: RemittanceSchema },
      { name: RemittanceImportBatch.name, schema: RemittanceImportBatchSchema },
      { name: Contribution.name, schema: ContributionSchema },
    ]),
    MulterModule.register({}),
    SystemConfigModule,
  ],
  controllers: [RemittancesController],
  providers: [RemittancesService, RemittancesImportService],
})
export class RemittancesModule {}
```

- [ ] **Step 4: Register RemittancesModule in AppModule**

In `apps/api/src/app.module.ts`, add import at top:
```ts
import { RemittancesModule } from './remittances/remittances.module';
```

Add `RemittancesModule` to the `imports` array after `LoansModule`.

- [ ] **Step 5: Verify API compiles**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/remittances/ apps/api/src/app.module.ts
git commit -m "feat(remittances): add controller, module, DTOs; register in AppModule"
```
