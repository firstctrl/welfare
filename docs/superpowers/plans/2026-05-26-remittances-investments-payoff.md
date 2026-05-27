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
# Remittances, Investments, Loan Pay-Off — Part 3: Reports API + All Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend getFundSummary with discount data, build all frontend pages (remittances list/manual/import, investments list/import, loan pay-off modal), add the Remittances report panel to Reports, and add discount KPIs + breakdown to Fund Summary.

**Architecture:** API lib functions follow the existing `apiClient.get/post` pattern. Pages are Next.js 14 server components wrapping `*-client.tsx` client components. The pay-off modal uses the preview-then-commit UX pattern identical to existing payment modals.

**Tech Stack:** Next.js 14 · React · @tanstack/react-query · react-hook-form · zod · lucide-react · sonner

**Prerequisite:** Parts 1 and 2 must be complete.

---

### Task 18: ReportsService getFundSummary Discount Additions + ReportsModule

**Files:**
- Modify: `apps/api/src/reports/reports.service.ts`
- Modify: `apps/api/src/reports/reports.module.ts`

- [ ] **Step 1: Register Discount model in ReportsModule**

In `apps/api/src/reports/reports.module.ts`:

Add imports:
```ts
import { Discount, DiscountSchema } from '../loans/schemas/discount.schema';
```

Add to `MongooseModule.forFeature([...])`:
```ts
{ name: Discount.name, schema: DiscountSchema },
```

Export `ReportsService` so other modules can use `generatePdf`/`generateCsv`:
```ts
exports: [ReportsService],
```

- [ ] **Step 2: Add Discount model injection to ReportsService**

In `apps/api/src/reports/reports.service.ts`:

Add imports:
```ts
import { Discount, DiscountDocument } from '../loans/schemas/discount.schema';
```

Add to constructor after `batchModel`:
```ts
@InjectModel(Discount.name) private readonly discountModel: Model<DiscountDocument>,
```

- [ ] **Step 3: Add discount queries to getFundSummary**

In `apps/api/src/reports/reports.service.ts`, in `getFundSummary`, add two queries to the existing `Promise.all` array (after the `defaultRows` query):

```ts
      // 7. All-time total discounts given
      this.discountModel.aggregate([
        { $match: { cancelled: false } },
        { $group: { _id: null, total: { $sum: '$discountAmount' } } },
      ]).exec(),

      // 8. Period discount breakdown with staff name
      this.discountModel.aggregate([
        {
          $match: {
            cancelled: false,
            dateGranted: { $gte: periodStart, $lte: periodEnd },
          },
        },
        {
          $lookup: {
            from: 'staff',
            let: { sid: '$staffId' },
            pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } }],
            as: 'staffDoc',
          },
        },
        { $unwind: { path: '$staffDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            staffName: { $ifNull: ['$staffDoc.fullName', 'Unknown'] },
            loanReference: { $substr: ['$loanId', { $subtract: [{ $strLenCP: '$loanId' }, 6] }, 6] },
            discountType: 1,
            rate: '$discountRate',
            amount: '$discountAmount',
            dateGranted: 1,
          },
        },
        { $sort: { dateGranted: -1 } },
      ]).exec(),
```

- [ ] **Step 4: Destructure new values and include in return**

In `getFundSummary`, update the destructured result of `Promise.all` to include:
```ts
    const [
      contribRows,
      loanGroups,
      recoveryGroups,
      allTimeContribs,
      allTimeLoans,
      activeStaff,
      joiners,
      exits,
      defaultRows,
      allTimeDiscountsAgg,
      periodDiscounts,
    ] = await Promise.all([...]);
```

Add to the return value:
```ts
      totalDiscountsGiven: Math.round((allTimeDiscountsAgg[0]?.total ?? 0) * 100) / 100,
      discountBreakdown: periodDiscounts.map((d: any) => ({
        staffName: d.staffName,
        loanReference: String(d.loanReference).toUpperCase(),
        discountType: d.discountType,
        rate: d.rate,
        amount: d.amount,
        dateGranted: d.dateGranted instanceof Date ? d.dateGranted.toISOString() : d.dateGranted,
      })),
```

- [ ] **Step 5: Verify API build**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports/reports.service.ts apps/api/src/reports/reports.module.ts
git commit -m "feat(reports): add totalDiscountsGiven and discountBreakdown to getFundSummary"
```

---

### Task 19: Frontend API Lib Files

**Files:**
- Create: `apps/web/src/lib/remittances.ts`
- Create: `apps/web/src/lib/investments.ts`
- Modify: `apps/web/src/lib/loans.ts`

- [ ] **Step 1: Create lib/remittances.ts**

Create `apps/web/src/lib/remittances.ts`:
```ts
import { apiClient } from './api-client';
import type { IRemittanceReport } from '@welfare/shared';

export interface RemittanceRecord {
  _id: string;
  month: number;
  year: number;
  grossAmount: number;
  chargeRate: number;
  charges: number;
  netPayable: number;
  receiptDate: string;
  recordedBy: string;
  createdAt: string;
}

export interface RemittanceGrossPreview {
  grossAmount: number;
  charges: number;
  netPayable: number;
}

export interface PaginatedRemittances {
  data: RemittanceRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RemittanceReportParams {
  fromMonth?: number;
  fromYear?: number;
  toMonth?: number;
  toYear?: number;
}

export async function getRemittanceGrossPreview(month: number, year: number): Promise<RemittanceGrossPreview> {
  const { data } = await apiClient.get('/remittances/gross', { params: { month, year } });
  return data;
}

export async function listRemittances(page = 1, limit = 20): Promise<PaginatedRemittances> {
  const { data } = await apiClient.get('/remittances', { params: { page, limit } });
  return data;
}

export async function createRemittance(payload: { month: number; year: number; receiptDate: string }): Promise<RemittanceRecord> {
  const { data } = await apiClient.post('/remittances', payload);
  return data;
}

export async function importRemittances(file: File): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/remittances/import', form);
  return data;
}

export async function getRemittancesReport(params: RemittanceReportParams): Promise<IRemittanceReport> {
  const { data } = await apiClient.get('/remittances/report', { params });
  return data;
}

export function buildRemittancesReportDownloadUrl(params: RemittanceReportParams & { format: 'csv' | 'pdf' }): string {
  const base = apiClient.defaults.baseURL ?? '';
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
  ).toString();
  return `${base}/remittances/report?${q}`;
}
```

- [ ] **Step 2: Create lib/investments.ts**

Create `apps/web/src/lib/investments.ts`:
```ts
import { apiClient } from './api-client';
import type { IInvestmentRow } from '@welfare/shared';

export interface PaginatedInvestments {
  data: IInvestmentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateInvestmentPayload {
  purchaseDate: string;
  description: string;
  cost: number;
  maturityDate: string;
  faceValue: number;
  instruction: 'One-Time' | 'Roll-Over';
}

export interface UpdateInvestmentPayload extends Partial<CreateInvestmentPayload> {
  reason: string;
}

export async function listInvestments(page = 1, limit = 20): Promise<PaginatedInvestments> {
  const { data } = await apiClient.get('/investments', { params: { page, limit } });
  return data;
}

export async function createInvestment(payload: CreateInvestmentPayload): Promise<IInvestmentRow> {
  const { data } = await apiClient.post('/investments', payload);
  return data;
}

export async function updateInvestment(id: string, payload: UpdateInvestmentPayload): Promise<IInvestmentRow> {
  const { data } = await apiClient.patch(`/investments/${id}`, payload);
  return data;
}

export async function deleteInvestment(id: string, reason: string): Promise<void> {
  await apiClient.delete(`/investments/${id}`, { data: { reason } });
}

export async function importInvestments(file: File): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/investments/import', form);
  return data;
}
```

- [ ] **Step 3: Add pay-off functions to lib/loans.ts**

Append to `apps/web/src/lib/loans.ts`:
```ts
import type { IPayOffPreview } from '@welfare/shared';

export async function getPayOffPreview(loanId: string): Promise<IPayOffPreview> {
  const { data } = await apiClient.get(`/loans/${loanId}/payoff-preview`);
  return data;
}

export async function processPayOff(
  loanId: string,
  payload: { amountReceived: number; paymentDate: string },
): Promise<unknown> {
  const { data } = await apiClient.post(`/loans/${loanId}/payoff`, payload);
  return data;
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/remittances.ts apps/web/src/lib/investments.ts apps/web/src/lib/loans.ts
git commit -m "feat(web): add lib/remittances.ts, lib/investments.ts, and payoff helpers to lib/loans.ts"
```

---

### Task 20: Sidebar Nav Additions

**Files:**
- Modify: `apps/web/src/components/nav/sidebar.tsx`

- [ ] **Step 1: Add Remittances and Investments nav items**

In `apps/web/src/components/nav/sidebar.tsx`:

Add `Receipt` and `TrendingUp` to the lucide-react import:
```ts
import {
  LayoutDashboard,
  Users,
  UserCog,
  Landmark,
  FileBarChart2,
  Settings,
  ScrollText,
  Mail,
  Coins,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
```

In the `navItems` array, add after the Loans entry and before Reports:
```ts
  { href: '/remittances', label: 'Remittances', icon: Receipt,    matchPrefix: true, module: AppModule.Remittances },
  { href: '/investments', label: 'Investments', icon: TrendingUp, matchPrefix: true, module: AppModule.Investments },
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/nav/sidebar.tsx
git commit -m "feat(web): add Remittances and Investments nav items to sidebar"
```

---

### Task 21: Remittances List + Manual Entry Pages

**Files:**
- Create: `apps/web/src/app/(dashboard)/remittances/page.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/remittances-list-client.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/manual/page.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/manual/manual-entry-client.tsx`

- [ ] **Step 1: Create remittances list page**

Create `apps/web/src/app/(dashboard)/remittances/page.tsx`:
```tsx
import { RemittancesListClient } from './remittances-list-client';

export default function RemittancesPage() {
  return <RemittancesListClient />;
}
```

- [ ] **Step 2: Create RemittancesListClient**

Create `apps/web/src/app/(dashboard)/remittances/remittances-list-client.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import { fmtGHS, fmtDate } from '@/lib/format';
import { listRemittances } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function RemittancesListClient() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['remittances', page],
    queryFn: () => listRemittances(page, 20),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Remittances</h1>
        <div className="flex gap-2">
          <Button as={Link} href="/remittances/import" variant="secondary" Icon={Upload}>Bulk Import</Button>
          <Button as={Link} href="/remittances/manual" Icon={Plus}>Add Remittance</Button>
        </div>
      </div>

      <Card>
        <CardHeader title="Remittance Records" />
        <CardBody>
          {isLoading ? (
            <p className="text-sm text-neutral-400 py-8 text-center">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Period','Receipt Date','Gross Amount','Charges','Net Payable'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(data?.data ?? []).length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">No remittances recorded yet</td></tr>
                  ) : (
                    (data?.data ?? []).map(r => (
                      <tr key={r._id} className="hover:bg-neutral-50">
                        <td className="px-4 py-2.5 font-medium">{MONTHS[r.month - 1]} {r.year}</td>
                        <td className="px-4 py-2.5 text-neutral-600">{fmtDate(r.receiptDate)}</td>
                        <td className="px-4 py-2.5 text-neutral-700">{fmtGHS(r.grossAmount)}</td>
                        <td className="px-4 py-2.5 text-neutral-600">{fmtGHS(r.charges)}</td>
                        <td className="px-4 py-2.5 font-semibold text-neutral-900">{fmtGHS(r.netPayable)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4">
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <span className="text-sm text-neutral-500">Page {page} of {data.totalPages}</span>
              <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create manual entry server page**

Create `apps/web/src/app/(dashboard)/remittances/manual/page.tsx`:
```tsx
import { ManualEntryClient } from './manual-entry-client';

export default function ManualRemittancePage() {
  return <ManualEntryClient />;
}
```

- [ ] **Step 4: Create ManualEntryClient**

Create `apps/web/src/app/(dashboard)/remittances/manual/manual-entry-client.tsx`:
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { createRemittance, getRemittanceGrossPreview } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS } from '@/lib/format';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const now = new Date();

const schema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2000),
  receiptDate: z.string().min(1, 'Required'),
});
type Form = z.infer<typeof schema>;

export function ManualEntryClient() {
  const router = useRouter();
  const [preview, setPreview] = useState<{ grossAmount: number; charges: number; netPayable: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear(), receiptDate: '' },
  });

  const { month, year } = form.watch();

  useEffect(() => {
    if (!month || !year || year < 2000) return;
    setLoadingPreview(true);
    getRemittanceGrossPreview(month, year)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setLoadingPreview(false));
  }, [month, year]);

  const mutation = useMutation({
    mutationFn: (values: Form) => createRemittance(values),
    onSuccess: () => {
      toast.success('Remittance recorded successfully');
      router.push('/remittances');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to record remittance');
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Record Remittance</h1>
      </div>

      <Card>
        <CardHeader title="Remittance Details" />
        <CardBody>
          <form onSubmit={form.handleSubmit(v => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Month" error={form.formState.errors.month?.message}>
                <Select {...form.register('month')} value={String(month)}>
                  {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Year" error={form.formState.errors.year?.message}>
                <Input type="number" {...form.register('year')} />
              </Field>
            </div>

            {loadingPreview && <p className="text-sm text-neutral-400">Computing gross amount…</p>}
            {preview && (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-neutral-500">Gross Amount</span><span className="font-medium">{fmtGHS(preview.grossAmount)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Charges ({((preview.charges / (preview.grossAmount || 1)) * 100).toFixed(0)}%)</span><span>{fmtGHS(preview.charges)}</span></div>
                <div className="flex justify-between border-t border-neutral-200 pt-1.5"><span className="font-semibold">Net Payable</span><span className="font-semibold text-primary-700">{fmtGHS(preview.netPayable)}</span></div>
              </div>
            )}

            <Field label="Receipt Date" error={form.formState.errors.receiptDate?.message}>
              <Input type="date" {...form.register('receiptDate')} />
            </Field>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={mutation.isPending || !preview}>
                {mutation.isPending ? 'Saving…' : 'Record Remittance'}
              </Button>
              <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/remittances/
git commit -m "feat(web): add Remittances list page and manual entry form"
```

---

### Task 22: Remittances Import Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/remittances/import/page.tsx`
- Create: `apps/web/src/app/(dashboard)/remittances/import/import-client.tsx`

- [ ] **Step 1: Create import server page**

Create `apps/web/src/app/(dashboard)/remittances/import/page.tsx`:
```tsx
import { RemittancesImportClient } from './import-client';

export default function RemittancesImportPage() {
  return <RemittancesImportClient />;
}
```

- [ ] **Step 2: Create RemittancesImportClient**

Create `apps/web/src/app/(dashboard)/remittances/import/import-client.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { importRemittances } from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function RemittancesImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ batchId: string; imported: number; flagged: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: () => importRemittances(file!),
    onSuccess: (data) => {
      setResult(data);
      if (data.flagged === 0) toast.success(`${data.imported} remittances imported successfully`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Import failed');
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Bulk Import Remittances</h1>
      </div>

      <Card>
        <CardHeader title="XLSX Template" />
        <CardBody>
          <p className="text-sm text-neutral-500 mb-3">Required columns: <strong>Month</strong> (1–12), <strong>Year</strong>, <strong>Receipt Date</strong> (dd/mm/yyyy)</p>
          <p className="text-sm text-neutral-500">Gross amount, charges, and net payable are computed automatically from contribution records.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Upload File" />
        <CardBody className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          <div
            className="border-2 border-dashed border-neutral-200 rounded-md p-8 text-center cursor-pointer hover:border-primary-300 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={24} className="mx-auto text-neutral-400 mb-2" />
            <p className="text-sm text-neutral-500">{file ? file.name : 'Click to select an XLSX file'}</p>
          </div>

          {file && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} Icon={Upload}>
              {mutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}

          {result && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle size={16} className="text-success-600" />
                <span><strong>{result.imported}</strong> imported of {result.total} rows</span>
              </div>
              {result.flagged > 0 && (
                <div className="flex items-center gap-2 text-sm text-warning-700">
                  <AlertTriangle size={16} />
                  <span><strong>{result.flagged}</strong> rows flagged (duplicate period or validation errors)</span>
                </div>
              )}
              <Button variant="secondary" size="sm" onClick={() => router.push('/remittances')}>
                View Remittances
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/remittances/import/
git commit -m "feat(web): add Remittances bulk import page"
```

---

### Task 23: Investments List Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/investments/page.tsx`
- Create: `apps/web/src/app/(dashboard)/investments/investments-list-client.tsx`

- [ ] **Step 1: Create investments list server page**

Create `apps/web/src/app/(dashboard)/investments/page.tsx`:
```tsx
import { InvestmentsListClient } from './investments-list-client';

export default function InvestmentsPage() {
  return <InvestmentsListClient />;
}
```

- [ ] **Step 2: Create InvestmentsListClient**

Create `apps/web/src/app/(dashboard)/investments/investments-list-client.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Upload, Pencil, Trash2 } from 'lucide-react';
import type { IInvestmentRow } from '@welfare/shared';
import { listInvestments, createInvestment, updateInvestment, deleteInvestment } from '@/lib/investments';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { fmtGHS, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const investmentSchema = z.object({
  purchaseDate: z.string().min(1, 'Required'),
  description: z.string().min(1, 'Required'),
  cost: z.coerce.number().min(0.01, 'Must be > 0'),
  maturityDate: z.string().min(1, 'Required'),
  faceValue: z.coerce.number().min(0.01, 'Must be > 0'),
  instruction: z.enum(['One-Time', 'Roll-Over']),
});
type InvestmentForm = z.infer<typeof investmentSchema>;

const reasonSchema = z.object({ reason: z.string().min(1, 'Reason is required') });
type ReasonForm = z.infer<typeof reasonSchema>;

function InvestmentStatusBadge({ status }: { status: 'Active' | 'Matured' }) {
  return (
    <span className={cn(
      'inline-flex px-2 py-0.5 rounded text-xs font-medium',
      status === 'Active' ? 'bg-info-50 text-info-700' : 'bg-neutral-100 text-neutral-500',
    )}>
      {status}
    </span>
  );
}

export function InvestmentsListClient() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<IInvestmentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IInvestmentRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['investments', page],
    queryFn: () => listInvestments(page, 20),
  });

  const createForm = useForm<InvestmentForm>({ resolver: zodResolver(investmentSchema) });
  const editForm = useForm<InvestmentForm & { reason: string }>({
    resolver: zodResolver(investmentSchema.extend({ reason: z.string().min(1, 'Required') })),
  });
  const deleteForm = useForm<ReasonForm>({ resolver: zodResolver(reasonSchema) });

  const createMut = useMutation({
    mutationFn: (v: InvestmentForm) => createInvestment(v),
    onSuccess: () => { toast.success('Investment recorded'); qc.invalidateQueries({ queryKey: ['investments'] }); setShowCreate(false); createForm.reset(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const editMut = useMutation({
    mutationFn: (v: InvestmentForm & { reason: string }) => updateInvestment(editTarget!.id, v),
    onSuccess: () => { toast.success('Investment updated'); qc.invalidateQueries({ queryKey: ['investments'] }); setEditTarget(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (v: ReasonForm) => deleteInvestment(deleteTarget!.id, v.reason),
    onSuccess: () => { toast.success('Investment deleted'); qc.invalidateQueries({ queryKey: ['investments'] }); setDeleteTarget(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const openEdit = (inv: IInvestmentRow) => {
    editForm.reset({
      purchaseDate: inv.purchaseDate.split('T')[0],
      description: inv.description,
      cost: inv.cost,
      maturityDate: inv.maturityDate.split('T')[0],
      faceValue: inv.faceValue,
      instruction: inv.instruction,
      reason: '',
    });
    setEditTarget(inv);
  };

  const COLS = ['Purchase Date','Description','Cost','Face Value','Interest','Rate (%)','Maturity Date','Status','Instruction',''];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Investments</h1>
        <div className="flex gap-2">
          <Button as={Link} href="/investments/import" variant="secondary" Icon={Upload}>Bulk Import</Button>
          <Button onClick={() => setShowCreate(true)} Icon={Plus}>Add Investment</Button>
        </div>
      </div>

      <Card>
        <CardHeader title="Investment Records" />
        <CardBody>
          {isLoading ? (
            <p className="text-sm text-neutral-400 py-8 text-center">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {COLS.map(h => <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(data?.data ?? []).length === 0 ? (
                    <tr><td colSpan={COLS.length} className="px-4 py-8 text-center text-neutral-400">No investments recorded yet</td></tr>
                  ) : (
                    (data?.data ?? []).map(inv => (
                      <tr key={inv.id} className="hover:bg-neutral-50">
                        <td className="px-3 py-2.5">{fmtDate(inv.purchaseDate)}</td>
                        <td className="px-3 py-2.5 max-w-[200px] truncate" title={inv.description}>{inv.description}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.cost)}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.faceValue)}</td>
                        <td className="px-3 py-2.5">{fmtGHS(inv.interest)}</td>
                        <td className="px-3 py-2.5">{inv.rate.toFixed(2)}%</td>
                        <td className="px-3 py-2.5">{fmtDate(inv.maturityDate)}</td>
                        <td className="px-3 py-2.5"><InvestmentStatusBadge status={inv.status} /></td>
                        <td className="px-3 py-2.5">{inv.instruction}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            <button onClick={() => openEdit(inv)} className="p-1 text-neutral-400 hover:text-primary-600 rounded" title="Edit"><Pencil size={14} /></button>
                            <button onClick={() => { setDeleteTarget(inv); deleteForm.reset(); }} className="p-1 text-neutral-400 hover:text-danger-600 rounded" title="Delete"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          {data && data.totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4">
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <span className="text-sm text-neutral-500">Page {page} of {data.totalPages}</span>
              <Button variant="secondary" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages}>Next</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Investment">
        <form onSubmit={createForm.handleSubmit(v => createMut.mutate(v))} className="space-y-4 p-4">
          <Field label="Purchase Date" error={createForm.formState.errors.purchaseDate?.message}><Input type="date" {...createForm.register('purchaseDate')} /></Field>
          <Field label="Description" error={createForm.formState.errors.description?.message}><Input {...createForm.register('description')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost (GHS)" error={createForm.formState.errors.cost?.message}><Input type="number" step="0.01" {...createForm.register('cost')} /></Field>
            <Field label="Face Value (GHS)" error={createForm.formState.errors.faceValue?.message}><Input type="number" step="0.01" {...createForm.register('faceValue')} /></Field>
          </div>
          <Field label="Maturity Date" error={createForm.formState.errors.maturityDate?.message}><Input type="date" {...createForm.register('maturityDate')} /></Field>
          <Field label="Instruction"><Select {...createForm.register('instruction')}><option value="One-Time">One-Time</option><option value="Roll-Over">Roll-Over</option></Select></Field>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Saving…' : 'Save'}</Button>
            <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      {editTarget && (
        <Modal open onClose={() => setEditTarget(null)} title="Edit Investment">
          <form onSubmit={editForm.handleSubmit(v => editMut.mutate(v))} className="space-y-4 p-4">
            <Field label="Purchase Date"><Input type="date" {...editForm.register('purchaseDate')} /></Field>
            <Field label="Description"><Input {...editForm.register('description')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost (GHS)"><Input type="number" step="0.01" {...editForm.register('cost')} /></Field>
              <Field label="Face Value (GHS)"><Input type="number" step="0.01" {...editForm.register('faceValue')} /></Field>
            </div>
            <Field label="Maturity Date"><Input type="date" {...editForm.register('maturityDate')} /></Field>
            <Field label="Instruction"><Select {...editForm.register('instruction')}><option value="One-Time">One-Time</option><option value="Roll-Over">Roll-Over</option></Select></Field>
            <Field label="Reason for edit (required)" error={editForm.formState.errors.reason?.message}><Input {...editForm.register('reason')} placeholder="Describe the change" /></Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={editMut.isPending}>{editMut.isPending ? 'Saving…' : 'Save Changes'}</Button>
              <Button variant="secondary" type="button" onClick={() => setEditTarget(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <Modal open onClose={() => setDeleteTarget(null)} title="Delete Investment">
          <form onSubmit={deleteForm.handleSubmit(v => deleteMut.mutate(v))} className="space-y-4 p-4">
            <p className="text-sm text-neutral-600">
              Delete <strong>{deleteTarget.description}</strong>? This action is irreversible in the UI; the record is archived for audit.
            </p>
            <Field label="Reason for deletion (required)" error={deleteForm.formState.errors.reason?.message}><Input {...deleteForm.register('reason')} placeholder="State reason" /></Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="danger" disabled={deleteMut.isPending}>{deleteMut.isPending ? 'Deleting…' : 'Delete'}</Button>
              <Button variant="secondary" type="button" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/investments/
git commit -m "feat(web): add Investments list page with create/edit/delete modals"
```

---

### Task 24: Investments Import Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/investments/import/page.tsx`
- Create: `apps/web/src/app/(dashboard)/investments/import/import-client.tsx`

- [ ] **Step 1: Create investments import server page**

Create `apps/web/src/app/(dashboard)/investments/import/page.tsx`:
```tsx
import { InvestmentsImportClient } from './import-client';

export default function InvestmentsImportPage() {
  return <InvestmentsImportClient />;
}
```

- [ ] **Step 2: Create InvestmentsImportClient**

Create `apps/web/src/app/(dashboard)/investments/import/import-client.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import { importInvestments } from '@/lib/investments';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function InvestmentsImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ batchId: string; imported: number; flagged: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: () => importInvestments(file!),
    onSuccess: (data) => {
      setResult(data);
      if (data.flagged === 0) toast.success(`${data.imported} investments imported`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Import failed'),
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => router.back()} size="sm">← Back</Button>
        <h1 className="text-xl font-semibold">Bulk Import Investments</h1>
      </div>

      <Card>
        <CardHeader title="XLSX Template" />
        <CardBody>
          <p className="text-sm text-neutral-500">Required columns: <strong>Purchase Date</strong>, <strong>Description</strong>, <strong>Cost</strong>, <strong>Maturity Date</strong>, <strong>Face Value</strong>, <strong>Instruction</strong> (One-Time or Roll-Over)</p>
          <p className="text-sm text-neutral-400 mt-2">Interest and rate are computed automatically from Cost and Face Value.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Upload File" />
        <CardBody className="space-y-4">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div
            className="border-2 border-dashed border-neutral-200 rounded-md p-8 text-center cursor-pointer hover:border-primary-300 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={24} className="mx-auto text-neutral-400 mb-2" />
            <p className="text-sm text-neutral-500">{file ? file.name : 'Click to select an XLSX file'}</p>
          </div>

          {file && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} Icon={Upload}>
              {mutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}

          {result && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm"><CheckCircle size={16} className="text-success-600" /><span><strong>{result.imported}</strong> imported of {result.total}</span></div>
              {result.flagged > 0 && (
                <div className="flex items-center gap-2 text-sm text-warning-700"><AlertTriangle size={16} /><span><strong>{result.flagged}</strong> rows flagged</span></div>
              )}
              <Button variant="secondary" size="sm" onClick={() => router.push('/investments')}>View Investments</Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/investments/import/
git commit -m "feat(web): add Investments bulk import page"
```

---

### Task 25: Loan Detail Pay-Off Modal

**Files:**
- Modify: `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`

- [ ] **Step 1: Add pay-off state, query, and mutation to LoanDetailClient**

In `apps/web/src/app/(dashboard)/loans/[id]/loan-detail-client.tsx`:

Add import:
```ts
import { getPayOffPreview, processPayOff } from '@/lib/loans';
import type { IPayOffPreview } from '@welfare/shared';
```

Add to existing imports from lucide-react: `Banknote`

Add state variables inside the component (near other `useState` declarations):
```ts
const [showPayOff, setShowPayOff] = useState(false);
const [payOffDate, setPayOffDate] = useState(today());
const [amountReceived, setAmountReceived] = useState('');
```

Add pay-off preview query (near other `useQuery` calls):
```ts
const { data: payOffPreview, isLoading: previewLoading } = useQuery({
  queryKey: ['payoff-preview', loanId],
  queryFn: () => getPayOffPreview(loanId),
  enabled: showPayOff,
});
```

Add when `payOffPreview` loads, pre-fill amountReceived:
```ts
useEffect(() => {
  if (payOffPreview) setAmountReceived(String(payOffPreview.netPayable));
}, [payOffPreview]);
```

Add pay-off mutation (near other `useMutation` declarations):
```ts
const payOffMut = useMutation({
  mutationFn: () =>
    processPayOff(loanId, { amountReceived: parseFloat(amountReceived), paymentDate: payOffDate }),
  onSuccess: () => {
    toast.success('Loan settled successfully');
    setShowPayOff(false);
    queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
    queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
  },
  onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Pay-off failed'),
});
```

- [ ] **Step 2: Add "Settle Loan" button and modal JSX**

In the JSX, locate where the existing action buttons are rendered (near `CreditCard` / record payment button). Add a "Settle Loan" button visible only when `loan.status === LoanStatus.Active` and `permission === 'full'`:

```tsx
{loan.status === LoanStatus.Active && permission === 'full' && (
  <Button onClick={() => setShowPayOff(true)} Icon={Banknote} variant="secondary">
    Settle Loan
  </Button>
)}
```

Add the pay-off modal (near other modals, before the closing `</div>`):
```tsx
{showPayOff && (
  <Modal open onClose={() => setShowPayOff(false)} title="Settle Loan (Early Pay-Off)">
    <div className="p-4 space-y-4">
      {previewLoading && <p className="text-sm text-neutral-400">Computing pay-off amount…</p>}
      {payOffPreview && (
        <>
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-neutral-500">Remaining Principal</span><span>{fmtGHS(payOffPreview.remainingPrincipal)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Remaining Interest</span><span>{fmtGHS(payOffPreview.remainingInterest)}</span></div>
            {payOffPreview.discountApplied && (
              <div className="flex justify-between text-success-700">
                <span>Pay-Off Discount ({payOffPreview.discountRate}%)</span>
                <span>−{fmtGHS(payOffPreview.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-neutral-200 pt-2">
              <span>Net Payable</span>
              <span className="text-primary-700">{fmtGHS(payOffPreview.netPayable)}</span>
            </div>
            {!payOffPreview.discountApplied && payOffPreview.tier === 2 && (
              <p className="text-xs text-neutral-400 pt-1">No pay-off discount — loan is past the 6-month early settlement window.</p>
            )}
            {payOffPreview.tier === 1 && (
              <p className="text-xs text-neutral-400 pt-1">Tier 1 loan — origination discount already applied at disbursement.</p>
            )}
          </div>
          <Field label="Amount Received (GHS)">
            <Input type="number" step="0.01" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} />
          </Field>
          <Field label="Payment Date">
            <Input type="date" value={payOffDate} onChange={e => setPayOffDate(e.target.value)} max={today()} />
          </Field>
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => payOffMut.mutate()}
              disabled={payOffMut.isPending || !amountReceived || !payOffDate}
            >
              {payOffMut.isPending ? 'Processing…' : 'Confirm Settlement'}
            </Button>
            <Button variant="secondary" onClick={() => setShowPayOff(false)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  </Modal>
)}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/loans/
git commit -m "feat(web): add Settle Loan pay-off modal to loan detail page"
```

---

### Task 26: Remittances Report Panel in Reports

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`

- [ ] **Step 1: Add RemittancesReportPanel component and section**

In `apps/web/src/app/(dashboard)/reports/reports-client.tsx`:

Add import:
```ts
import { getRemittancesReport, buildRemittancesReportDownloadUrl } from '@/lib/remittances';
import type { IRemittanceReport, IRemittanceReportRow } from '@welfare/shared';
```

Add `RemittancesReportPanel` component (near other panel components, before `SECTIONS`):
```tsx
function RemittancesReportPanel() {
  const now = new Date();
  const [fromMonth, setFromMonth] = useState(1);
  const [fromYear, setFromYear]   = useState(now.getFullYear());
  const [toMonth, setToMonth]     = useState(now.getMonth() + 1);
  const [toYear, setToYear]       = useState(now.getFullYear());
  const [params, setParams]       = useState<{ fromMonth: number; fromYear: number; toMonth: number; toYear: number } | null>(null);
  const [rangeError, setRangeError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['remittances-report', params],
    queryFn: () => getRemittancesReport(params!),
    enabled: params !== null,
  });

  const colRem = createColumnHelper<IRemittanceReportRow>();
  const COLS = [
    colRem.accessor('period', { header: 'Period' }),
    colRem.accessor('receiptDate', { header: 'Receipt Date' }),
    colRem.accessor('grossAmount', { header: 'Gross Amt (GHS)', cell: i => fmtGHS(i.getValue()) }),
    colRem.accessor('charges', { header: 'Charges (GHS)', cell: i => fmtGHS(i.getValue()) }),
    colRem.accessor('netPayable', { header: 'Net Payable (GHS)', cell: i => fmtGHS(i.getValue()) }),
  ];

  const table = useReactTable({ data: data?.rows ?? [], columns: COLS, getCoreRowModel: getCoreRowModel() });

  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

  const handleRun = () => {
    if (toYear < fromYear || (toYear === fromYear && toMonth < fromMonth)) {
      setRangeError('To period must not be before From period');
      return;
    }
    setRangeError('');
    setParams({ fromMonth, fromYear, toMonth, toYear });
  };

  const downloadUrl = (format: 'csv' | 'pdf') =>
    params ? buildRemittancesReportDownloadUrl({ ...params, format }) : '#';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 p-4 bg-neutral-50 border border-neutral-200 rounded-md">
        <Field label="From Month">
          <Select value={String(fromMonth)} onChange={e => setFromMonth(+e.target.value)}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="From Year">
          <Input type="number" value={fromYear} onChange={e => setFromYear(+e.target.value)} style={{ width: 90 }} />
        </Field>
        <Field label="To Month">
          <Select value={String(toMonth)} onChange={e => setToMonth(+e.target.value)}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="To Year">
          <Input type="number" value={toYear} onChange={e => setToYear(+e.target.value)} style={{ width: 90 }} />
        </Field>
        <Button onClick={handleRun} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Run Report'}
        </Button>
      </div>
      {rangeError && <p className="text-sm text-danger-600">{rangeError}</p>}

      {data && (
        <>
          <div className="flex gap-2">
            <a href={downloadUrl('csv')} download>
              <Button variant="secondary" size="sm" Icon={Download}>CSV</Button>
            </a>
            <a href={downloadUrl('pdf')} download>
              <Button variant="secondary" size="sm" Icon={Download}>PDF</Button>
            </a>
          </div>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Gross</p><p className="font-semibold">{fmtGHS(data.totalGross)}</p></div>
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Charges</p><p className="font-semibold">{fmtGHS(data.totalCharges)}</p></div>
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Net Payable</p><p className="font-semibold text-primary-700">{fmtGHS(data.totalNet)}</p></div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                {table.getHeaderGroups().map(hg => (
                  <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
                    {hg.headers.map(h => (
                      <th key={h.id} className="px-3 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {table.getRowModel().rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">No remittance records in this period</td></tr>
                ) : (
                  table.getRowModel().rows.map(row => (
                    <tr key={row.id} className="hover:bg-neutral-50">
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-3 py-2.5 text-neutral-700 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !isLoading && params === null && (
        <p className="text-sm text-neutral-400 text-center py-8">Select a period and click Run Report.</p>
      )}
    </div>
  );
}
```

Add to `SECTIONS` array (after `exit-clearance`):
```ts
  { id: 'remittances', label: 'Remittances' },
```

Add to the panel switch block (after `exit-clearance` panel):
```tsx
{active === 'remittances' && <RemittancesReportPanel />}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/reports/reports-client.tsx
git commit -m "feat(web): add Remittances report panel to Reports with filter-first + CSV/PDF download"
```

---

### Task 27: Fund Summary Discount KPI + Breakdown Table

**Files:**
- Modify: `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx`

- [ ] **Step 1: Add IFundSummaryDiscountRow import**

In `apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx`, add to imports from `@welfare/shared`:
```ts
import type {
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
  IFundSummaryDefaultRow,
  IFundSummaryDiscountRow,
} from '@welfare/shared';
```

- [ ] **Step 2: Add discount column definitions**

After the existing `COLS_DEFAULTS` definition, add:
```ts
const colDiscount = createColumnHelper<IFundSummaryDiscountRow>();
const COLS_DISCOUNTS = [
  colDiscount.accessor('staffName',     { header: 'Staff Name' }),
  colDiscount.accessor('loanReference', { header: 'Loan Ref' }),
  colDiscount.accessor('discountType',  { header: 'Type' }),
  colDiscount.accessor('rate',          { header: 'Rate (%)', cell: i => `${i.getValue()}%` }),
  colDiscount.accessor('amount',        { header: 'Amount (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colDiscount.accessor('dateGranted',   { header: 'Date Granted', cell: i => i.getValue() ? new Date(i.getValue()).toLocaleDateString('en-GB') : '—' }),
];
```

- [ ] **Step 3: Add Total Discounts Given KPI to all-time block**

In `FundSummaryPanel`, in the "All-Time Fund Overview" grid, add a 5th KpiCard after Active Members:
```tsx
<KpiCard
  label="Total Discounts Given"
  value={fmtGHSShort(data.totalDiscountsGiven ?? 0)}
  title={fmtGHS(data.totalDiscountsGiven ?? 0)}
  icon={AlertCircle}
  iconKind="warning"
/>
```

Also change the grid from `grid-cols-2 md:grid-cols-4` to `grid-cols-2 md:grid-cols-5` to accommodate 5 KPIs.

- [ ] **Step 4: Add Discount Breakdown section to period summary**

Locate where the `defaultDetails` Section is rendered (near the bottom of period data). After it, add:
```tsx
{data.discountBreakdown.length > 0 && (
  <Section title="Discount Breakdown">
    <SummaryTable columns={COLS_DISCOUNTS} data={data.discountBreakdown} />
  </Section>
)}
```

- [ ] **Step 5: Verify TypeScript**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(dashboard)/reports/fund-summary-panel.tsx
git commit -m "feat(web): add Total Discounts KPI and discount breakdown table to Fund Summary"
```