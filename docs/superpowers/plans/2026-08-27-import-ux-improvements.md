# Import UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live progress bar to all 6 Excel import flows, fix the Staff import preview showing a raw serial number instead of a date, and let a user resolve a staff-mapping flag once and apply it across every pending import batch instead of batch-by-batch.

**Architecture:** A new global `ImportProgressService` (in-memory `Map`, no persistence) tracks row-processing counts per import job, exposed over one shared `GET /import-progress/:jobId` endpoint. The frontend generates a Mongo-ObjectId-shaped job id before upload, sends it with the file, and polls that endpoint every 500ms while the import request is in flight — this avoids splitting any of the 6 existing single-request import endpoints into two round trips. Two new `resolve-by-staff-id` endpoints (contributions, loans-repayment) reuse each service's existing per-entry resolve logic (extracted into a private helper) but loop it across every pending batch that has a flagged entry for the given Staff ID.

**Tech Stack:** NestJS 10 / Mongoose (API), Next.js / React Query / axios / xlsx (web), Jest (API unit tests only — the web app has no test runner configured, so frontend steps are verified by `npm run build`/`tsc` and a manual UI pass).

**Spec:** `docs/superpowers/specs/2026-08-27-import-ux-improvements-design.md`

## Global Constraints

- No new runtime dependencies (no SSE/WebSocket/Redis for progress — in-memory `Map` on the single API instance, per spec).
- `ImportProgressService`'s map is not persisted — acceptable per spec, ephemeral by design.
- Progress polling is auth-gated (global `JwtAuthGuard`) but not permission-gated (`@RequirePermission` omitted → `PermissionsGuard` allows any authenticated user, confirmed in `apps/api/src/auth/guards/permissions.guard.ts:14-15`).
- `resolve-by-staff-id` ships only for contributions and loans-repayment — not staff-import, loan-records-import, investments, or remittances (per spec scope).
- Every `processImport` signature gains an **optional trailing `jobId?: string`** param — existing callers that omit it must keep working unchanged (backward compatible).
- Follow existing patterns exactly: services throw `NotFoundException`/`BadRequestException` from `@nestjs/common`, controllers use `@RequirePermission(AppModule.X, 'full'|'readonly')`, audit logs go through the existing `AuditService.log(...)` call shape already used in each service.

---

## File Structure

New files:
- `apps/api/src/common/import-progress.service.ts` — in-memory progress tracker
- `apps/api/src/common/import-progress.service.spec.ts`
- `apps/api/src/common/import-progress.controller.ts` — `GET /import-progress/:jobId`
- `apps/api/src/common/import-progress.module.ts` — `@Global()`, registered in `AppModule`
- `apps/web/src/lib/job-id.ts` — client-side job id generator
- `apps/web/src/lib/excel-date.ts` — client-side mirror of `normalizeExcelDate`
- `apps/web/src/hooks/use-import-progress.ts` — polling hook
- `apps/web/src/components/ui/import-progress-bar.tsx` — progress bar component
- `apps/api/src/contributions/dto/resolve-by-staff-id.dto.ts`
- `apps/api/src/loans/dto/resolve-loan-by-staff-id.dto.ts`

Modified files (per import flow, listed in their tasks below):
- `apps/api/src/{contributions/import.service.ts, staff/staff.import.service.ts, loans/loans.import.service.ts, loans/loans.records.import.service.ts, investments/investments.import.service.ts, remittances/remittances.import.service.ts}` — inject `ImportProgressService`, accept `jobId`, wrap the row loop in `start`/`increment`/`complete`.
- Matching `*.controller.ts` files — accept `jobId` from the multipart body and pass it through.
- Matching `apps/web/src/lib/{contributions,staff,loans,investments,remittances}.ts` — accept `jobId` in the `import*` functions.
- Matching `apps/web/src/app/(dashboard)/**/import/import-client.tsx` — generate a job id, render `ImportProgressBar` while importing.
- `apps/api/src/contributions/import.service.ts` / `contributions.controller.ts` / `apps/web/src/lib/contributions.ts` / `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx` — bulk resolve.
- `apps/api/src/loans/loans.import.service.ts` / `loans.controller.ts` / `apps/web/src/lib/loans.ts` / `apps/web/src/app/(dashboard)/loans/import/import-client.tsx` — bulk resolve.

---

### Task 1: `ImportProgressService`

**Files:**
- Create: `apps/api/src/common/import-progress.service.ts`
- Test: `apps/api/src/common/import-progress.service.spec.ts`

**Interfaces:**
- Produces: `ImportProgressService` with `start(jobId: string, total: number): void`, `increment(jobId: string, by?: number): void`, `complete(jobId: string): void`, `get(jobId: string): { processed: number; total: number; done: boolean } | null`. Later tasks inject this via constructor DI (it will be provided by the `@Global()` module from Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/common/import-progress.service.spec.ts
import { ImportProgressService } from './import-progress.service';

describe('ImportProgressService', () => {
  let service: ImportProgressService;

  beforeEach(() => {
    service = new ImportProgressService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('returns null for an unknown jobId', () => {
    expect(service.get('unknown')).toBeNull();
  });

  it('tracks processed/total/done across start → increment → complete', () => {
    service.start('job-1', 10);
    expect(service.get('job-1')).toEqual({ processed: 0, total: 10, done: false });

    service.increment('job-1');
    service.increment('job-1');
    expect(service.get('job-1')).toEqual({ processed: 2, total: 10, done: false });

    service.complete('job-1');
    expect(service.get('job-1')).toEqual({ processed: 2, total: 10, done: true });
  });

  it('increment/complete on an unknown jobId is a no-op, not a throw', () => {
    expect(() => service.increment('missing')).not.toThrow();
    expect(() => service.complete('missing')).not.toThrow();
    expect(service.get('missing')).toBeNull();
  });

  it('sweeps entries older than the TTL', () => {
    jest.useFakeTimers();
    service.start('old-job', 5);
    jest.advanceTimersByTime(6 * 60_000); // past 5-minute TTL, past the 60s sweep tick
    expect(service.get('old-job')).toBeNull();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest import-progress.service.spec.ts`
Expected: FAIL — `Cannot find module './import-progress.service'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/common/import-progress.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';

interface ProgressEntry {
  processed: number;
  total: number;
  done: boolean;
  updatedAt: number;
}

export interface ImportProgress {
  processed: number;
  total: number;
  done: boolean;
}

const SWEEP_INTERVAL_MS = 60_000;
const ENTRY_TTL_MS = 5 * 60_000;

@Injectable()
export class ImportProgressService implements OnModuleDestroy {
  private readonly progress = new Map<string, ProgressEntry>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  start(jobId: string, total: number): void {
    this.progress.set(jobId, { processed: 0, total, done: false, updatedAt: Date.now() });
  }

  increment(jobId: string, by = 1): void {
    const entry = this.progress.get(jobId);
    if (!entry) return;
    entry.processed += by;
    entry.updatedAt = Date.now();
  }

  complete(jobId: string): void {
    const entry = this.progress.get(jobId);
    if (!entry) return;
    entry.done = true;
    entry.updatedAt = Date.now();
  }

  get(jobId: string): ImportProgress | null {
    const entry = this.progress.get(jobId);
    if (!entry) return null;
    return { processed: entry.processed, total: entry.total, done: entry.done };
  }

  private sweep(): void {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    for (const [jobId, entry] of this.progress) {
      if (entry.updatedAt < cutoff) this.progress.delete(jobId);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest import-progress.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/import-progress.service.ts apps/api/src/common/import-progress.service.spec.ts
git commit -m "feat(api): add in-memory ImportProgressService"
```

---

### Task 2: `ImportProgressController` + `ImportProgressModule`

**Files:**
- Create: `apps/api/src/common/import-progress.controller.ts`
- Create: `apps/api/src/common/import-progress.controller.spec.ts`
- Create: `apps/api/src/common/import-progress.module.ts`
- Modify: `apps/api/src/app.module.ts:29` (add import), `apps/api/src/app.module.ts:73` (register in `imports` array)

**Interfaces:**
- Consumes: `ImportProgressService.get(jobId)` from Task 1.
- Produces: `GET /import-progress/:jobId` → `200 { processed, total, done }` or `404`. Available for injection anywhere in the app once `ImportProgressModule` is imported into `AppModule` (it's `@Global()`, so no feature module needs to import it — later tasks just inject `ImportProgressService` in their constructors).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/common/import-progress.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ImportProgressController } from './import-progress.controller';
import { ImportProgressService } from './import-progress.service';

describe('ImportProgressController', () => {
  let controller: ImportProgressController;
  const mockService = { get: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportProgressController],
      providers: [{ provide: ImportProgressService, useValue: mockService }],
    }).compile();
    controller = module.get(ImportProgressController);
    jest.clearAllMocks();
  });

  it('returns progress when found', () => {
    mockService.get.mockReturnValue({ processed: 3, total: 10, done: false });
    expect(controller.get('job-1')).toEqual({ processed: 3, total: 10, done: false });
    expect(mockService.get).toHaveBeenCalledWith('job-1');
  });

  it('throws NotFoundException when not found', () => {
    mockService.get.mockReturnValue(null);
    expect(() => controller.get('missing')).toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest import-progress.controller.spec.ts`
Expected: FAIL — `Cannot find module './import-progress.controller'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/common/import-progress.controller.ts
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ImportProgressService } from './import-progress.service';

@Controller('import-progress')
export class ImportProgressController {
  constructor(private readonly progressService: ImportProgressService) {}

  @Get(':jobId')
  get(@Param('jobId') jobId: string) {
    const progress = this.progressService.get(jobId);
    if (!progress) throw new NotFoundException(`No progress found for job ${jobId}`);
    return progress;
  }
}
```

```ts
// apps/api/src/common/import-progress.module.ts
import { Global, Module } from '@nestjs/common';
import { ImportProgressController } from './import-progress.controller';
import { ImportProgressService } from './import-progress.service';

@Global()
@Module({
  controllers: [ImportProgressController],
  providers: [ImportProgressService],
  exports: [ImportProgressService],
})
export class ImportProgressModule {}
```

Modify `apps/api/src/app.module.ts` — add the import statement near the other feature-module imports (after line 29's `InvestmentsModule` import):

```ts
import { InvestmentsModule } from './investments/investments.module';
import { ImportProgressModule } from './common/import-progress.module';
```

and add `ImportProgressModule` to the `imports: [...]` array (after `InvestmentsModule,` around line 73):

```ts
    InvestmentsModule,
    ImportProgressModule,
    ReportsModule,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest import-progress.controller.spec.ts`
Expected: PASS (2 tests)

Then sanity-check the whole app still boots:
Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/import-progress.controller.ts apps/api/src/common/import-progress.controller.spec.ts apps/api/src/common/import-progress.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): expose GET /import-progress/:jobId"
```

---

### Task 3: Frontend progress primitives (job id generator, polling hook, progress bar)

**Files:**
- Create: `apps/web/src/lib/job-id.ts`
- Create: `apps/web/src/hooks/use-import-progress.ts`
- Create: `apps/web/src/components/ui/import-progress-bar.tsx`

**Interfaces:**
- Produces: `genJobId(): string` (24-hex-char string), `useImportProgress(jobId: string | null): { processed: number; total: number; done: boolean } | null`, `<ImportProgressBar processed={number} total={number} />`. Every `import-client.tsx` wired in Tasks 5–9 calls all three.
- Consumes: `apiClient` from `apps/web/src/lib/api-client.ts` (existing), `cn` from `apps/web/src/lib/utils.ts` (existing, used by `RepaymentBar` at `apps/web/src/components/ui/repayment-bar.tsx:1`).

This app has no unit test runner (`apps/web/package.json`'s `"test"` script is a no-op), so verification here is `tsc --noEmit` plus a manual check in Task 5 once something actually renders the progress bar.

- [ ] **Step 1: Write `genJobId`**

```ts
// apps/web/src/lib/job-id.ts
export function genJobId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Write the polling hook**

```ts
// apps/web/src/hooks/use-import-progress.ts
'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export interface ImportProgress {
  processed: number;
  total: number;
  done: boolean;
}

export function useImportProgress(jobId: string | null): ImportProgress | null {
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    if (!jobId) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    async function poll() {
      try {
        const { data } = await apiClient.get<ImportProgress>(`/import-progress/${jobId}`);
        if (cancelled) return;
        setProgress(data);
        if (data.done) clearInterval(interval);
      } catch {
        // Not started yet, or expired — keep polling silently.
      }
    }

    poll();
    interval = setInterval(poll, 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  return progress;
}
```

- [ ] **Step 3: Write the progress bar component**

```tsx
// apps/web/src/components/ui/import-progress-bar.tsx
import { cn } from '@/lib/utils';

interface ImportProgressBarProps {
  processed: number;
  total: number;
  className?: string;
}

export function ImportProgressBar({ processed, total, className }: ImportProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex justify-between text-sm text-neutral-500">
        <span>Importing…</span>
        <span className="font-mono tabular">{processed} of {total} rows</span>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-primary-500 transition-all duration-fast"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors (these files aren't imported anywhere yet, so this just confirms they're individually well-typed)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/job-id.ts apps/web/src/hooks/use-import-progress.ts apps/web/src/components/ui/import-progress-bar.tsx
git commit -m "feat(web): add import progress polling hook and progress bar"
```

---

### Task 4: Wire progress into Contributions import

**Files:**
- Modify: `apps/api/src/contributions/import.service.ts:1-3` (imports), `:20-26` (constructor), `:28-116` (`processImport`)
- Modify: `apps/api/src/contributions/contributions.controller.ts:26-41` (`importExcel`)
- Modify: `apps/web/src/lib/contributions.ts:49-62` (`importContributions`)
- Modify: `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx`
- Test: `apps/api/src/contributions/import.service.spec.ts` (new)

**Interfaces:**
- Consumes: `ImportProgressService` (Task 1), `genJobId`/`useImportProgress`/`ImportProgressBar` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/contributions/import.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ImportService } from './import.service';
import { ImportBatch } from './schemas/import-batch.schema';
import { ContributionsService } from './contributions.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };

const mockContributionsService = { processPayment: jest.fn().mockResolvedValue(undefined) };
const mockStaffService = { findByStaffId: jest.fn() };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('ImportService (contributions) — progress tracking', () => {
  let service: ImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: getModelToken(ImportBatch.name), useValue: mockBatchModel },
        { provide: ContributionsService, useValue: mockContributionsService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(ImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockStaffService.findByStaffId.mockResolvedValue({ _id: { toString: () => 'staff-1' } });
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { 'Staff ID': 'S1', 'Employee Name': 'Jane', Month: 1, Year: 2026, Amount: 100 },
      { 'Staff ID': 'S2', 'Employee Name': 'Joe', Month: 1, Year: 2026, Amount: 200 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'test.xlsx', undefined, undefined, 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 2);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(2);
    expect(mockProgressService.increment).toHaveBeenCalledWith('batch-1');
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(
      excelBuffer(), 'test.xlsx', undefined, undefined, 'actor-1', 'Actor', '507f1f77bcf86cd799439011',
    );

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });

  it('completes progress even when a row throws', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-2' } });
    mockContributionsService.processPayment.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.processImport(excelBuffer(), 'test.xlsx', undefined, undefined, 'actor-1', 'Actor'),
    ).rejects.toThrow('boom');

    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contributions/import.service.spec.ts`
Expected: FAIL — `processImport` doesn't accept a 7th `jobId` arg yet, and `ImportProgressService` isn't injected, so `mockProgressService.start` is never called (assertions fail).

- [ ] **Step 3: Implement**

`apps/api/src/contributions/import.service.ts` — add the import and constructor param:

```ts
import { Model, Types } from 'mongoose';
// ...
import { ImportProgressService } from '../common/import-progress.service';

@Injectable()
export class ImportService {
  constructor(
    @InjectModel(ImportBatch.name) private readonly batchModel: Model<ImportBatchDocument>,
    private readonly contributionsService: ContributionsService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
  ) {}
```

Update `processImport`'s signature and body (replace lines 28–104 of the current file):

```ts
  async processImport(
    buffer: Buffer,
    fileName: string,
    monthOverride: number | undefined,
    yearOverride: number | undefined,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<{ batchId: string; matched: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const firstRow = rows[0];
    const batchMonth = monthOverride ?? 0;
    const batchYear  = yearOverride  ?? 0;

    if (monthOverride && (monthOverride < 1 || monthOverride > 12))
      throw new BadRequestException('Month override must be 1–12');
    if (yearOverride && yearOverride < 2000)
      throw new BadRequestException('Year override must be ≥ 2000');
    if (!monthOverride) {
      const firstMonth = Number(firstRow.Month);
      if (!firstMonth || firstMonth < 1 || firstMonth > 12)
        throw new BadRequestException('Month column missing or invalid in first row');
    }
    if (!yearOverride) {
      const firstYear = Number(firstRow.Year);
      if (!firstYear || firstYear < 2000)
        throw new BadRequestException('Year column missing or invalid in first row');
    }

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      month: batchMonth, year: batchYear, fileName,
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
        const employeeName = String(row['Employee Name'] ?? '').trim();
        const amount = Number(row.Amount ?? 0);

        const rowMonth = monthOverride ?? Number(row.Month);
        const rowYear  = yearOverride  ?? Number(row.Year);

        if (!rawStaffId) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Missing Staff ID' });
          continue;
        }
        if (!rowMonth || rowMonth < 1 || rowMonth > 12) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Month' });
          continue;
        }
        if (!rowYear || rowYear < 2000) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Invalid or missing Year' });
          continue;
        }

        const staff = await this.staffService.findByStaffId(rawStaffId);
        if (!staff) {
          flaggedEntries.push({ staffId: rawStaffId, employeeName, amount, reason: 'Staff ID not found' });
          continue;
        }

        await this.contributionsService.processPayment(
          staff._id.toString(), rowMonth, rowYear, amount,
          ContributionSource.PayrollImport, actorId, actorName, batchId,
        );
        matched++;
      }
    } finally {
      this.progressService.complete(batchId);
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
```

`apps/api/src/contributions/contributions.controller.ts` — add `jobId` to `importExcel` (replace lines 26–41):

```ts
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('month') month?: string,
    @Body('year') year?: string,
    @Body('jobId') jobId?: string,
    @CurrentUser() user?: { sub: string; displayName: string },
  ) {
    if (!file) throw new Error('No file uploaded');
    return this.importService.processImport(
      file.buffer,
      file.originalname,
      month ? parseInt(month, 10) : undefined,
      year ? parseInt(year, 10) : undefined,
      user?.sub ?? 'system',
      user?.displayName ?? 'system',
      jobId,
    );
  }
```

`apps/web/src/lib/contributions.ts` — update `importContributions` (replace lines 49–62):

```ts
export async function importContributions(
  file: File,
  month?: number,
  year?: number,
  jobId?: string,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (month) form.append('month', String(month));
  if (year) form.append('year', String(year));
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/contributions/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
```

`apps/web/src/app/(dashboard)/contributions/import/import-client.tsx` — add the job id + progress bar. Add imports:

```ts
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';
```

Add state and wire it into the mutation (near the other `useState` calls, after `const [file, setFile] = useState<File | null>(null);`):

```ts
  const [jobId, setJobId] = useState<string | null>(null);
  const progress = useImportProgress(importMutation.isPending ? jobId : null);
```

(`useState`/`importMutation` already exist above this point — this just adds one more piece of state and one hook call.)

Change the mutation's `mutationFn` to generate and use the job id (replace the existing `mutationFn: () => importContributions(...)` line inside `importMutation`):

```ts
  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importContributions(
        file!,
        monthOverride ? parseInt(monthOverride, 10) : undefined,
        yearOverride ? parseInt(yearOverride, 10) : undefined,
        id,
      );
    },
```

Render the bar right after the existing Import `<Button>` element (still inside `<CardBody>`):

```tsx
          <Button variant="primary" Icon={Upload} disabled={!file || importMutation.isPending} loading={importMutation.isPending} onClick={() => importMutation.mutate()}>
            Import
          </Button>
          {importMutation.isPending && progress && (
            <ImportProgressBar processed={progress.processed} total={progress.total} />
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contributions/import.service.spec.ts`
Expected: PASS (3 tests)

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual check**

Start the API and web dev servers, go to Contributions → Import, upload a multi-row `.xlsx` file, confirm a progress bar appears under the Import button and advances while the request is in flight.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/contributions/import.service.ts apps/api/src/contributions/import.service.spec.ts apps/api/src/contributions/contributions.controller.ts apps/web/src/lib/contributions.ts "apps/web/src/app/(dashboard)/contributions/import/import-client.tsx"
git commit -m "feat: add import progress bar to contributions import"
```

---

### Task 5: Wire progress into Staff import + fix Date of Employment preview

**Files:**
- Modify: `apps/api/src/staff/staff.import.service.ts:1-3` (imports), `:31-38` (constructor), `:40-123` (`processImport`)
- Modify: `apps/api/src/staff/staff.controller.ts:40-45` (`importStaff`)
- Modify: `apps/web/src/lib/staff.ts:95-102` (`importStaff`)
- Modify: `apps/web/src/app/(dashboard)/staff/import/import-client.tsx`
- Create: `apps/web/src/lib/excel-date.ts` (client-side mirror of the server util)
- Test: `apps/api/src/staff/staff.import.service.spec.ts` (new)

**Interfaces:**
- Consumes: `ImportProgressService` (Task 1), `genJobId`/`useImportProgress`/`ImportProgressBar` (Task 3).
- Produces: `normalizeExcelDate(value: string | number | Date | undefined | null): string` in `apps/web/src/lib/excel-date.ts` — same signature and behavior as the server-side `apps/api/src/common/utils/excel-date.util.ts`, kept separate because it depends on the `xlsx` package the shared package doesn't currently pull in (per spec §2).

- [ ] **Step 1: Write the failing test (progress wiring)**

```ts
// apps/api/src/staff/staff.import.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StaffImportService } from './staff.import.service';
import { StaffImportBatch } from './schemas/staff-import-batch.schema';
import { StaffService } from './staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };
const mockStaffService = { create: jest.fn().mockResolvedValue({}) };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('StaffImportService — progress tracking', () => {
  let service: StaffImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffImportService,
        { provide: getModelToken(StaffImportBatch.name), useValue: mockBatchModel },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(StaffImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      {
        'Staff ID': 'S1', 'Full Name': 'Jane Doe', 'Date of Birth': '01/01/1990',
        Phone: '0555555555', Email: 'jane@example.com', 'Date of Employment': '01/02/2020',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'staff.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'staff.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest staff/staff.import.service.spec.ts`
Expected: FAIL — no 5th `jobId` param, `ImportProgressService` not injected.

- [ ] **Step 3: Implement backend progress wiring**

`apps/api/src/staff/staff.import.service.ts` — add imports and constructor param:

```ts
import { Model, Types } from 'mongoose';
// ...
import { ImportProgressService } from '../common/import-progress.service';

@Injectable()
export class StaffImportService {
  constructor(
    @InjectModel(StaffImportBatch.name)
    private readonly batchModel: Model<StaffImportBatchDocument>,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
  ) {}
```

Update `processImport` (replace lines 40–100 of the current file):

```ts
  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<StaffImportResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    const flaggedEntries: StaffImportBatchDocument['flaggedEntries'] = [];
    let created = 0;

    this.progressService.start(batchId, rows.length);
    try {
      for (let i = 0; i < rows.length; i++) {
        this.progressService.increment(batchId);

        const row = rows[i];
        const rowNumber = i + 2;
        const staffId    = String(row['Staff ID']    ?? '').trim();
        const fullName   = String(row['Full Name']   ?? '').trim();
        const pfNo       = String(row['PF No']       ?? '').trim() || undefined;
        const dob        = normalizeExcelDate(row['Date of Birth']);
        const phone      = String(row['Phone']                    ?? '').trim();
        const email      = String(row['Email']                    ?? '').trim();
        const dateOfEmp  = normalizeExcelDate(row['Date of Employment']);
        const dateOfFC   = normalizeExcelDate(row['Date of First Contribution']) || undefined;
        const level      = String(row['Level']       ?? '').trim() || undefined;
        const point      = row['Point'] !== undefined ? Number(row['Point']) : undefined;

        const flag = (reason: string) =>
          flaggedEntries.push({ rowNumber, staffId, fullName, reason });

        if (!staffId)  { flag('Missing Staff ID');  continue; }
        if (!fullName) { flag('Missing Full Name');  continue; }
        if (!dob)      { flag('Missing Date of Birth'); continue; }
        if (!phone)    { flag('Missing Phone');      continue; }
        if (!email)    { flag('Missing Email');      continue; }
        if (!dateOfEmp){ flag('Missing Date of Employment'); continue; }

        if (isNaN(new Date(dob).getTime()))     { flag('Invalid Date of Birth');       continue; }
        if (isNaN(new Date(dateOfEmp).getTime())){ flag('Invalid Date of Employment'); continue; }
        if (dateOfFC && isNaN(new Date(dateOfFC).getTime())) { flag('Invalid Date of First Contribution'); continue; }

        try {
          await this.staffService.create(
            { staffId, fullName, pfNo, dateOfBirth: dob, phoneNumber: phone, email, dateOfEmployment: dateOfEmp, dateOfFirstContribution: dateOfFC, level, point },
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
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Staff,
      batchId,
      undefined,
      { total: rows.length, created, flagged },
    );

    return { batchId, created, flagged, total: rows.length };
  }
```

`apps/api/src/staff/staff.controller.ts` — replace the `importStaff` handler (lines 40–45):

```ts
  importStaff(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId: string | undefined,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.processImport(file.buffer, file.originalname, user.sub, user.displayName, jobId);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest staff/staff.import.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the client-side date normalizer**

```ts
// apps/web/src/lib/excel-date.ts
import * as XLSX from 'xlsx';

export function normalizeExcelDate(value: string | number | Date | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return '';
    const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.round(parsed.S)));
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const str = String(value).trim();
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (!isNaN(new Date(iso).getTime())) return iso;
  }
  return str;
}
```

- [ ] **Step 6: Fix the preview + wire progress in the Staff import client**

`apps/web/src/lib/staff.ts` — replace `importStaff` (lines 95–102):

```ts
export async function importStaff(file: File, jobId?: string): Promise<StaffImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/staff/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
```

`apps/web/src/app/(dashboard)/staff/import/import-client.tsx` — add imports:

```ts
import { normalizeExcelDate } from '@/lib/excel-date';
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';
```

Fix the date bug in `handleFileChange` (replace the `rows.map(...)` call at lines 70–77):

```ts
      setPreview(
        rows.map((r) => ({
          staffId: String(r['Staff ID'] ?? ''),
          fullName: String(r['Full Name'] ?? ''),
          dateOfBirth: normalizeExcelDate(r['Date of Birth'] as string | number | undefined),
          email: String(r['Email'] ?? ''),
          phone: String(r['Phone'] ?? ''),
          dateOfEmployment: normalizeExcelDate(r['Date of Employment'] as string | number | undefined),
        })),
      );
```

Render the employment date as a real date instead of the raw string (replace line 156, the `dateOfEmployment` `<td>`):

```tsx
                      <td className="px-3 py-1.5">
                        {row.dateOfEmployment ? fmtDate(row.dateOfEmployment) : '—'}
                      </td>
```

`fmtDate` isn't imported in this file yet — add it to the existing `import { fmtDate } from '@/lib/format';` line (line 14 currently only imports `fmtDate` — check first: it already does, `import { fmtDate } from '@/lib/format';` — confirm no change needed there since it's already imported for the history table's `createdAt` column).

Add the job id + progress state (after `const [result, setResult] = useState...` around line 41):

```ts
  const [jobId, setJobId] = useState<string | null>(null);
  const progress = useImportProgress(importMutation.isPending ? jobId : null);
```

Change the mutation to generate a job id (replace `mutationFn: () => importStaff(file!),` inside `importMutation`):

```ts
  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importStaff(file!, id);
    },
```

Render the bar after the Import `<Button>`:

```tsx
          <Button
            variant="primary"
            Icon={Upload}
            disabled={!file || importMutation.isPending}
            loading={importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            Import
          </Button>
          {importMutation.isPending && progress && (
            <ImportProgressBar processed={progress.processed} total={progress.total} />
          )}
```

- [ ] **Step 7: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Manual check**

Upload a staff `.xlsx` with a real "Date of Employment" column (Excel date format) and confirm the preview shows a `dd/mm/yyyy` date, not a 5-digit number. Confirm the progress bar appears while importing.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/staff/staff.import.service.ts apps/api/src/staff/staff.import.service.spec.ts apps/api/src/staff/staff.controller.ts apps/web/src/lib/staff.ts apps/web/src/lib/excel-date.ts "apps/web/src/app/(dashboard)/staff/import/import-client.tsx"
git commit -m "fix: staff import preview shows formatted dates; add import progress bar"
```

---

### Task 6: Wire progress into Loans (repayment) import

**Files:**
- Modify: `apps/api/src/loans/loans.import.service.ts:1-3` (imports), `:36-45` (constructor), `:47-142` (`processImport`)
- Modify: `apps/api/src/loans/loans.controller.ts:77-85` (`importRepayments`)
- Modify: `apps/web/src/lib/loans.ts:89-96` (`importLoanRepayments`)
- Modify: `apps/web/src/app/(dashboard)/loans/import/import-client.tsx`
- Test: `apps/api/src/loans/loans.import.service.spec.ts` (new)

**Interfaces:**
- Consumes: `ImportProgressService` (Task 1), `genJobId`/`useImportProgress`/`ImportProgressBar` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/loans/loans.import.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoansImportService } from './loans.import.service';
import { Loan } from './schemas/loan.schema';
import { LoanImportBatch } from './schemas/loan-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };
const mockLoanModel = { findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' } }) }) };
const mockLoansService = { recordPaymentInternal: jest.fn().mockResolvedValue(undefined) };
const mockStaffService = { findByStaffId: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' } }) };
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('LoansImportService — progress tracking', () => {
  let service: LoansImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansImportService,
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: getModelToken(LoanImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { 'Staff ID': 'S1', Amount: 500, 'Paid Date': '01/03/2026' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'loans.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'loans.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest loans/loans.import.service.spec.ts`
Expected: FAIL — no 5th `jobId` param, `ImportProgressService` not injected.

- [ ] **Step 3: Implement**

`apps/api/src/loans/loans.import.service.ts` — add imports and constructor param:

```ts
import { Model, Types } from 'mongoose';
// ...
import { ImportProgressService } from '../common/import-progress.service';

@Injectable()
export class LoansImportService {
  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(LoanImportBatch.name)
    private readonly batchModel: Model<LoanImportBatchDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
  ) {}
```

Update `processImport` (replace lines 47–119 of the current file):

```ts
  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<ImportRepaymentResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    const flaggedEntries: LoanImportBatchDocument['flaggedEntries'] = [];
    let matched = 0;

    this.progressService.start(batchId, rows.length);
    try {
      for (let i = 0; i < rows.length; i++) {
        this.progressService.increment(batchId);

        const row = rows[i];
        const rowNumber = i + 2;
        const rawStaffId  = String(row['Staff ID']   ?? '').trim();
        const staffName   = String(row['Staff Name'] ?? '').trim();
        const rawLoanId   = String(row['Loan ID']    ?? '').trim();
        const amount      = Number(row.Amount ?? 0);
        const paidDateRaw = normalizeExcelDate(row['Paid Date']);
        const notes       = String(row.Notes        ?? '').trim() || undefined;

        const flag = (reason: string) =>
          flaggedEntries.push({ rowNumber, staffId: rawStaffId, staffName, loanId: rawLoanId, amount, paidDate: paidDateRaw, notes, reason });

        if (!rawStaffId) { flag('Missing Staff ID'); continue; }
        if (!(amount > 0)) { flag('Amount must be > 0'); continue; }

        let paidDate: string;
        if (paidDateRaw) {
          const d = new Date(paidDateRaw);
          if (isNaN(d.getTime())) { flag('Invalid Paid Date'); continue; }
          paidDate = d.toISOString();
        } else {
          paidDate = new Date().toISOString();
        }

        try {
          const staff = await this.staffService.findByStaffId(rawStaffId);
          if (!staff) { flag('Staff ID not found'); continue; }

          let loanId = rawLoanId || undefined;

          if (!loanId) {
            const activeLoan = await this.loanModel
              .findOne({ staffId: staff._id.toString(), status: LoanStatus.Active })
              .exec();
            if (!activeLoan) { flag('No active loan found for staff'); continue; }
            loanId = activeLoan._id.toString();
          }

          await this.loansService.recordPaymentInternal(
            loanId,
            { amount, paidDate, notes },
            RepaymentSource.Import,
            actorId,
            actorName,
          );
          matched++;
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
        matchedRows: matched,
        flaggedRows: flagged,
        flaggedEntries,
        status: flagged === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending,
      },
    }).exec();

    this.auditService.log(
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Loan,
      batchId,
      undefined,
      { total: rows.length, matched, flagged },
    );

    return { batchId, matched, flagged, total: rows.length };
  }
```

`apps/api/src/loans/loans.controller.ts` — replace `importRepayments` (lines 77–85):

```ts
  importRepayments(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId: string | undefined,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.processImport(file.buffer, file.originalname, user.sub, user.displayName, jobId);
  }
```

`apps/web/src/lib/loans.ts` — replace `importLoanRepayments` (lines 89–96):

```ts
export async function importLoanRepayments(file: File, jobId?: string): Promise<LoanImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/loans/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
```

`apps/web/src/app/(dashboard)/loans/import/import-client.tsx` — add imports:

```ts
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';
```

Add state (after `const [result, setResult] = useState...` near line 51):

```ts
  const [jobId, setJobId] = useState<string | null>(null);
  const progress = useImportProgress(importMutation.isPending ? jobId : null);
```

Change the mutation (replace `mutationFn: () => importLoanRepayments(file!),`):

```ts
  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importLoanRepayments(file!, id);
    },
```

Render the bar after the Import `<Button>` (same pattern as Task 4/5).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest loans/loans.import.service.spec.ts`
Expected: PASS (2 tests)

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual check**

Upload a loan repayment `.xlsx`, confirm the progress bar renders and advances.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.import.service.ts apps/api/src/loans/loans.import.service.spec.ts apps/api/src/loans/loans.controller.ts apps/web/src/lib/loans.ts "apps/web/src/app/(dashboard)/loans/import/import-client.tsx"
git commit -m "feat: add import progress bar to loan repayment import"
```

---

### Task 7: Wire progress into Loans records-import

**Files:**
- Modify: `apps/api/src/loans/loans.records.import.service.ts:1-3` (imports), `:29-37` (constructor), `:39-125` (`processImport`)
- Modify: `apps/api/src/loans/loans.controller.ts:120-128` (`importLoanRecords`)
- Modify: `apps/web/src/lib/loans.ts:127-134` (`importLoanRecords`)
- Modify: `apps/web/src/app/(dashboard)/loans/records-import/import-client.tsx`
- Test: `apps/api/src/loans/loans.records.import.service.spec.ts` (new)

**Interfaces:**
- Consumes: `ImportProgressService` (Task 1), `genJobId`/`useImportProgress`/`ImportProgressBar` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/loans/loans.records.import.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoansRecordsImportService } from './loans.records.import.service';
import { LoanRecordsImportBatch } from './schemas/loan-records-import-batch.schema';
import { LoansService } from './loans.service';
import { StaffService } from '../staff/staff.service';
import { AuditService } from '../audit/audit.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate };
const mockLoansService = { createForImport: jest.fn().mockResolvedValue({}) };
const mockStaffService = {
  findByStaffId: jest.fn((id: string) => Promise.resolve({ _id: { toString: () => `resolved-${id}` } })),
};
const mockAuditService = { log: jest.fn() };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('LoansRecordsImportService — progress tracking', () => {
  let service: LoansRecordsImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansRecordsImportService,
        { provide: getModelToken(LoanRecordsImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansRecordsImportService);
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      {
        'Staff ID': 'S1', 'Guarantor Staff ID': 'S2', 'Principal Amount': 1000,
        'Tenure Months': 6, 'Disbursed Date': '01/03/2026', 'Cheque No': 'C1', 'PV No': 'PV1',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'records.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'records.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest loans/loans.records.import.service.spec.ts`
Expected: FAIL — no 5th `jobId` param, `ImportProgressService` not injected.

- [ ] **Step 3: Implement**

`apps/api/src/loans/loans.records.import.service.ts` — add imports and constructor param:

```ts
import { Model, Types } from 'mongoose';
// ...
import { ImportProgressService } from '../common/import-progress.service';

@Injectable()
export class LoansRecordsImportService {
  constructor(
    @InjectModel(LoanRecordsImportBatch.name)
    private readonly batchModel: Model<LoanRecordsImportBatchDocument>,
    private readonly loansService: LoansService,
    private readonly staffService: StaffService,
    private readonly auditService: AuditService,
    private readonly progressService: ImportProgressService,
  ) {}
```

Update `processImport` (replace lines 39–102 of the current file):

```ts
  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<LoanRecordsImportResult> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      uploadedBy: actorName,
      totalRows: rows.length,
      status: ImportBatchStatus.Pending,
    });
    const batchId = batch._id.toString();

    const flaggedEntries: LoanRecordsImportBatchDocument['flaggedEntries'] = [];
    let created = 0;

    this.progressService.start(batchId, rows.length);
    try {
      for (let i = 0; i < rows.length; i++) {
        this.progressService.increment(batchId);

        const row = rows[i];
        const rowNumber = i + 2;
        const rawStaffId     = String(row['Staff ID']          ?? '').trim();
        const rawGuarantorId = String(row['Guarantor Staff ID'] ?? '').trim();
        const principalAmount = Number(row['Principal Amount'] ?? 0);
        const tenureMonths   = Number(row['Tenure Months']     ?? 0);
        const disbursedDateRaw = normalizeExcelDate(row['Disbursed Date']);
        const chequeNo       = String(row['Cheque No']         ?? '').trim();
        const pvNo           = String(row['PV No']             ?? '').trim();

        const flag = (reason: string) =>
          flaggedEntries.push({ rowNumber, staffId: rawStaffId, guarantorId: rawGuarantorId, principalAmount, disbursedDate: disbursedDateRaw, reason });

        if (!rawStaffId)      { flag('Missing Staff ID');       continue; }
        if (!rawGuarantorId)  { flag('Missing Guarantor Staff ID'); continue; }
        if (!(principalAmount > 0)) { flag('Principal Amount must be > 0'); continue; }
        if (!(tenureMonths >= 1 && tenureMonths <= 12)) { flag('Tenure Months must be 1–12'); continue; }
        if (!disbursedDateRaw){ flag('Missing Disbursed Date'); continue; }
        if (isNaN(new Date(disbursedDateRaw).getTime())) { flag('Invalid Disbursed Date'); continue; }
        if (!chequeNo)        { flag('Missing Cheque No');     continue; }
        if (!pvNo)            { flag('Missing PV No');         continue; }

        try {
          const staff = await this.staffService.findByStaffId(rawStaffId);
          if (!staff) { flag('Staff ID not found'); continue; }

          const guarantor = await this.staffService.findByStaffId(rawGuarantorId);
          if (!guarantor) { flag('Guarantor Staff ID not found'); continue; }

          await this.loansService.createForImport(
            staff._id.toString(),
            guarantor._id.toString(),
            { principalAmount, tenureMonths, disbursedDate: disbursedDateRaw, chequeNo, pvNo },
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
      actorId,
      actorName,
      AuditAction.Import,
      AuditEntity.Loan,
      batchId,
      undefined,
      { total: rows.length, created, flagged },
    );

    return { batchId, created, flagged, total: rows.length };
  }
```

`apps/api/src/loans/loans.controller.ts` — replace `importLoanRecords` (lines 120–128):

```ts
  importLoanRecords(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId: string | undefined,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.recordsImportService.processImport(file.buffer, file.originalname, user.sub, user.displayName, jobId);
  }
```

`apps/web/src/lib/loans.ts` — replace `importLoanRecords` (lines 127–134):

```ts
export async function importLoanRecords(file: File, jobId?: string): Promise<LoanRecordsImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/loans/records-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
```

`apps/web/src/app/(dashboard)/loans/records-import/import-client.tsx` — add imports:

```ts
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';
```

Add state (after `const [result, setResult] = useState...` near line 38):

```ts
  const [jobId, setJobId] = useState<string | null>(null);
  const progress = useImportProgress(importMutation.isPending ? jobId : null);
```

Change the mutation (replace `mutationFn: () => importLoanRecords(file!),`):

```ts
  const importMutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importLoanRecords(file!, id);
    },
```

Render the bar after the Import `<Button>` (same pattern as prior tasks).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest loans/loans.records.import.service.spec.ts`
Expected: PASS (2 tests)

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual check**

Upload a loan records `.xlsx`, confirm the progress bar renders and advances.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/loans/loans.records.import.service.ts apps/api/src/loans/loans.records.import.service.spec.ts apps/api/src/loans/loans.controller.ts apps/web/src/lib/loans.ts "apps/web/src/app/(dashboard)/loans/records-import/import-client.tsx"
git commit -m "feat: add import progress bar to loan records import"
```

---

### Task 8: Wire progress into Investments import

**Files:**
- Modify: `apps/api/src/investments/investments.import.service.ts:1-7` (imports), `:19-24` (constructor), `:26-109` (`processImport`)
- Modify: `apps/api/src/investments/investments.controller.ts:70-79` (`importFile`)
- Modify: `apps/web/src/lib/investments.ts:44-49` (`importInvestments`)
- Modify: `apps/web/src/app/(dashboard)/investments/import/import-client.tsx`
- Test: `apps/api/src/investments/investments.import.service.spec.ts` (new)

**Interfaces:**
- Consumes: `ImportProgressService` (Task 1), `genJobId`/`useImportProgress`/`ImportProgressBar` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/investments/investments.import.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { InvestmentsImportService } from './investments.import.service';
import { InvestmentImportBatch } from './schemas/investment-import-batch.schema';
import { InvestmentsService } from './investments.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockUpdateOne = jest.fn();
const mockBatchModel = { create: mockCreate, updateOne: mockUpdateOne };
const mockInvestmentsService = { create: jest.fn().mockResolvedValue({}) };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('InvestmentsImportService — progress tracking', () => {
  let service: InvestmentsImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsImportService,
        { provide: getModelToken(InvestmentImportBatch.name), useValue: mockBatchModel },
        { provide: InvestmentsService, useValue: mockInvestmentsService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(InvestmentsImportService);
    jest.clearAllMocks();
    mockUpdateOne.mockResolvedValue(undefined);
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      {
        'Purchase Date': '01/01/2026', Description: 'T-Bill', Cost: 1000,
        'Maturity Date': '01/04/2026', 'Face Value': 1050, Instruction: 'One-Time',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'inv.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'inv.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest investments/investments.import.service.spec.ts`
Expected: FAIL — no 5th `jobId` param, `ImportProgressService` not injected.

- [ ] **Step 3: Implement**

`apps/api/src/investments/investments.import.service.ts` — add imports and constructor param:

```ts
import { Model, Types } from 'mongoose';
// ...
import { ImportProgressService } from '../common/import-progress.service';

@Injectable()
export class InvestmentsImportService {
  constructor(
    @InjectModel(InvestmentImportBatch.name)
    private readonly batchModel: Model<InvestmentImportBatchDocument>,
    private readonly investmentsService: InvestmentsService,
    private readonly progressService: ImportProgressService,
  ) {}
```

Update `processImport` (replace lines 26–101 of the current file):

```ts
  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<InvestmentExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      recordedBy: actorName,
      total: rows.length,
      imported: 0,
      flagged: 0,
      flaggedRows: [],
    });
    const batchId = batch._id.toString();

    let imported = 0;
    const flaggedRows: Array<{ rowNumber: number; description: string; flagReason: string }> = [];

    this.progressService.start(batchId, rows.length);
    try {
      for (let i = 0; i < rows.length; i++) {
        this.progressService.increment(batchId);

        const row = rows[i];
        const description = String(row.Description ?? '').trim();
        const cost = Number(row.Cost ?? 0);
        const faceValue = Number(row['Face Value'] ?? 0);
        const instruction = String(row.Instruction ?? '').trim() as 'One-Time' | 'Roll-Over';
        const purchaseDateRaw = normalizeExcelDate(row['Purchase Date']);
        const maturityDateRaw = normalizeExcelDate(row['Maturity Date']);

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
        if (isNaN(new Date(purchaseDateRaw).getTime())) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid Purchase Date' });
          continue;
        }
        if (isNaN(new Date(maturityDateRaw).getTime())) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: 'Invalid Maturity Date' });
          continue;
        }
        if (!['One-Time', 'Roll-Over'].includes(instruction)) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: `Invalid Instruction: "${instruction}" (must be One-Time or Roll-Over)` });
          continue;
        }

        try {
          await this.investmentsService.create(
            { purchaseDate: purchaseDateRaw, description, cost, maturityDate: maturityDateRaw, faceValue, instruction },
            actorId,
          );
          imported++;
        } catch (err: any) {
          flaggedRows.push({ rowNumber: i + 2, description, flagReason: err?.message ?? 'Unknown error' });
        }
      }
    } finally {
      this.progressService.complete(batchId);
    }

    await this.batchModel.updateOne(
      { _id: batch._id },
      { imported, flagged: flaggedRows.length, flaggedRows },
    );

    return { batchId, imported, flagged: flaggedRows.length, total: rows.length };
  }
```

`apps/api/src/investments/investments.controller.ts` — replace `importFile` (lines 70–79):

```ts
  @Post('import')
  @RequirePermission(AppModule.Investments, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId: string | undefined,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.processImport(file.buffer, file.originalname, user._id.toString(), user.displayName, jobId);
  }
```

`apps/web/src/lib/investments.ts` — replace `importInvestments` (lines 44–49):

```ts
export async function importInvestments(
  file: File,
  jobId?: string,
): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/investments/import', form);
  return data;
}
```

`apps/web/src/app/(dashboard)/investments/import/import-client.tsx` — add imports:

```ts
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';
```

Add state (after `const [result, setResult] = useState...` near line 16):

```ts
  const [jobId, setJobId] = useState<string | null>(null);
  const progress = useImportProgress(mutation.isPending ? jobId : null);
```

Change the mutation (replace `mutationFn: () => importInvestments(file!),`):

```ts
  const mutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importInvestments(file!, id);
    },
```

Render the bar after the Import `<Button>` (inside the `{file && (...)}` block, after the `</Button>`):

```tsx
          {file && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} Icon={Upload}>
              {mutation.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}
          {mutation.isPending && progress && (
            <ImportProgressBar processed={progress.processed} total={progress.total} />
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest investments/investments.import.service.spec.ts`
Expected: PASS (2 tests)

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual check**

Upload an investments `.xlsx`, confirm the progress bar renders and advances.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/investments/investments.import.service.ts apps/api/src/investments/investments.import.service.spec.ts apps/api/src/investments/investments.controller.ts apps/web/src/lib/investments.ts "apps/web/src/app/(dashboard)/investments/import/import-client.tsx"
git commit -m "feat: add import progress bar to investments import"
```

---

### Task 9: Wire progress into Remittances import

**Files:**
- Modify: `apps/api/src/remittances/remittances.import.service.ts:1-7` (imports), `:16-21` (constructor), `:23-91` (`processImport`)
- Modify: `apps/api/src/remittances/remittances.controller.ts:69-78` (`importFile`)
- Modify: `apps/web/src/lib/remittances.ts:69-74` (`importRemittances`)
- Modify: `apps/web/src/app/(dashboard)/remittances/import/import-client.tsx`
- Test: `apps/api/src/remittances/remittances.import.service.spec.ts` (new)

**Interfaces:**
- Consumes: `ImportProgressService` (Task 1), `genJobId`/`useImportProgress`/`ImportProgressBar` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/remittances/remittances.import.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RemittancesImportService } from './remittances.import.service';
import { RemittanceImportBatch } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';
import { ImportProgressService } from '../common/import-progress.service';

const mockCreate = jest.fn();
const mockUpdateOne = jest.fn();
const mockBatchModel = { create: mockCreate, updateOne: mockUpdateOne };
const mockRemittancesService = { create: jest.fn().mockResolvedValue({}) };
const mockProgressService = { start: jest.fn(), increment: jest.fn(), complete: jest.fn(), get: jest.fn() };

describe('RemittancesImportService — progress tracking', () => {
  let service: RemittancesImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesImportService,
        { provide: getModelToken(RemittanceImportBatch.name), useValue: mockBatchModel },
        { provide: RemittancesService, useValue: mockRemittancesService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(RemittancesImportService);
    jest.clearAllMocks();
    mockUpdateOne.mockResolvedValue(undefined);
  });

  function excelBuffer(): Buffer {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet([
      { Month: 1, Year: 2026, 'Receipt Date': '05/01/2026' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('starts, increments once per row, and completes progress using the batch id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => 'batch-1' } });

    await service.processImport(excelBuffer(), 'rem.xlsx', 'actor-1', 'Actor');

    expect(mockProgressService.start).toHaveBeenCalledWith('batch-1', 1);
    expect(mockProgressService.increment).toHaveBeenCalledTimes(1);
    expect(mockProgressService.complete).toHaveBeenCalledWith('batch-1');
  });

  it('creates the batch with the caller-supplied jobId as its _id', async () => {
    mockCreate.mockResolvedValue({ _id: { toString: () => '507f1f77bcf86cd799439011' } });

    await service.processImport(excelBuffer(), 'rem.xlsx', 'actor-1', 'Actor', '507f1f77bcf86cd799439011');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg._id?.toString()).toBe('507f1f77bcf86cd799439011');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest remittances/remittances.import.service.spec.ts`
Expected: FAIL — no 5th `jobId` param, `ImportProgressService` not injected.

- [ ] **Step 3: Implement**

`apps/api/src/remittances/remittances.import.service.ts` — add imports and constructor param:

```ts
import { Model, Types } from 'mongoose';
// ...
import { ImportProgressService } from '../common/import-progress.service';

@Injectable()
export class RemittancesImportService {
  constructor(
    @InjectModel(RemittanceImportBatch.name)
    private readonly batchModel: Model<RemittanceImportBatchDocument>,
    private readonly remittancesService: RemittancesService,
    private readonly progressService: ImportProgressService,
  ) {}
```

Update `processImport` (replace lines 23–89 of the current file):

```ts
  async processImport(
    buffer: Buffer,
    fileName: string,
    actorId: string,
    actorName: string,
    jobId?: string,
  ): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<RemittanceExcelRow>(sheet);

    if (rows.length === 0) throw new BadRequestException('Excel file has no data rows');

    const batch = await this.batchModel.create({
      ...(jobId ? { _id: new Types.ObjectId(jobId) } : {}),
      fileName,
      recordedBy: actorName,
      total: rows.length,
      imported: 0,
      flagged: 0,
      flaggedRows: [],
    });
    const batchId = batch._id.toString();

    let imported = 0;
    const flaggedRows: Array<{ rowNumber: number; month: number; year: number; flagReason: string }> = [];

    this.progressService.start(batchId, rows.length);
    try {
      for (let i = 0; i < rows.length; i++) {
        this.progressService.increment(batchId);

        const row = rows[i];
        const month = Number(row.Month ?? 0);
        const year = Number(row.Year ?? 0);
        const receiptDate = normalizeExcelDate(row['Receipt Date']);

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
        if (isNaN(new Date(receiptDate).getTime())) {
          flaggedRows.push({ rowNumber: i + 2, month, year, flagReason: 'Invalid Receipt Date' });
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
    } finally {
      this.progressService.complete(batchId);
    }

    await this.batchModel.updateOne(
      { _id: batch._id },
      { imported, flagged: flaggedRows.length, flaggedRows },
    );

    return { batchId, imported, flagged: flaggedRows.length, total: rows.length };
  }
```

`apps/api/src/remittances/remittances.controller.ts` — replace `importFile` (lines 69–78):

```ts
  @Post('import')
  @RequirePermission(AppModule.Remittances, 'full')
  @UseInterceptors(FileInterceptor('file'))
  importFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobId') jobId: string | undefined,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.processImport(file.buffer, file.originalname, user._id.toString(), user.displayName, jobId);
  }
```

`apps/web/src/lib/remittances.ts` — replace `importRemittances` (lines 69–74):

```ts
export async function importRemittances(
  file: File,
  jobId?: string,
): Promise<{ batchId: string; imported: number; flagged: number; total: number }> {
  const form = new FormData();
  form.append('file', file);
  if (jobId) form.append('jobId', jobId);
  const { data } = await apiClient.post('/remittances/import', form);
  return data;
}
```

`apps/web/src/app/(dashboard)/remittances/import/import-client.tsx` — add imports:

```ts
import { genJobId } from '@/lib/job-id';
import { useImportProgress } from '@/hooks/use-import-progress';
import { ImportProgressBar } from '@/components/ui/import-progress-bar';
```

Add state (after `const [result, setResult] = useState...` near line 16):

```ts
  const [jobId, setJobId] = useState<string | null>(null);
  const progress = useImportProgress(mutation.isPending ? jobId : null);
```

Change the mutation (replace `mutationFn: () => importRemittances(file!),`):

```ts
  const mutation = useMutation({
    mutationFn: () => {
      const id = genJobId();
      setJobId(id);
      return importRemittances(file!, id);
    },
```

Render the bar after the Import `<Button>` (same pattern as Task 8).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest remittances/remittances.import.service.spec.ts`
Expected: PASS (2 tests)

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual check**

Upload a remittances `.xlsx`, confirm the progress bar renders and advances.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/remittances/remittances.import.service.ts apps/api/src/remittances/remittances.import.service.spec.ts apps/api/src/remittances/remittances.controller.ts apps/web/src/lib/remittances.ts "apps/web/src/app/(dashboard)/remittances/import/import-client.tsx"
git commit -m "feat: add import progress bar to remittances import"
```

---

### Task 10: Contributions `resolveByStaffId` (backend)

**Files:**
- Create: `apps/api/src/contributions/dto/resolve-by-staff-id.dto.ts`
- Modify: `apps/api/src/contributions/import.service.ts` (extract `resolveOneEntry`, add `resolveByStaffId`)
- Modify: `apps/api/src/contributions/contributions.controller.ts` (add `resolveByStaffId` route)
- Test: extend `apps/api/src/contributions/import.service.spec.ts`

**Interfaces:**
- Produces: `ImportService.resolveByStaffId(originalStaffId: string, resolvedStaffMongoId: string, actorId: string, actorName: string): Promise<{ resolvedCount: number; batchesUpdated: number }>`. `PATCH /contributions/import/resolve-by-staff-id`, body `{ originalStaffId, resolvedStaffMongoId }`. Task 11's frontend calls this.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/contributions/import.service.spec.ts` (add a `mockFind` to `mockBatchModel` first):

```ts
// Add to mockBatchModel (replace the const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate }; line):
const mockFind = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: mockFind };
```

Then add a new `describe` block at the bottom of the file:

```ts
describe('ImportService (contributions) — resolveByStaffId', () => {
  let service: ImportService;

  function makeBatch(overrides: Partial<{ status: string; flaggedEntries: any[] }> = {}) {
    const batch: any = {
      _id: 'batch-x',
      month: 1,
      year: 2026,
      status: overrides.status ?? 'Pending',
      matchedRows: 0,
      flaggedRows: overrides.flaggedEntries?.length ?? 0,
      flaggedEntries: overrides.flaggedEntries ?? [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    return batch;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: getModelToken(ImportBatch.name), useValue: mockBatchModel },
        { provide: ContributionsService, useValue: mockContributionsService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(ImportService);
    jest.clearAllMocks();
  });

  it('resolves the matching flagged entry in every pending batch that has one', async () => {
    const batchA = makeBatch({ flaggedEntries: [{ staffId: 'S1', employeeName: 'Jane', amount: 100, reason: 'Staff ID not found' }] });
    const batchB = makeBatch({ flaggedEntries: [{ staffId: 'S1', employeeName: 'Jane', amount: 150, reason: 'Staff ID not found' }] });
    mockFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([batchA, batchB]) });

    const result = await service.resolveByStaffId('S1', 'staff-mongo-id', 'actor-1', 'Actor');

    expect(result).toEqual({ resolvedCount: 2, batchesUpdated: 2 });
    expect(mockContributionsService.processPayment).toHaveBeenCalledTimes(2);
    expect(batchA.flaggedEntries).toHaveLength(0);
    expect(batchB.flaggedEntries).toHaveLength(0);
    expect(batchA.save).toHaveBeenCalled();
    expect(batchB.save).toHaveBeenCalled();
  });

  it('skips batches without a matching staffId and returns zero counts if none match', async () => {
    const batchA = makeBatch({ flaggedEntries: [{ staffId: 'S2', employeeName: 'Other', amount: 100, reason: 'Staff ID not found' }] });
    mockFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([batchA]) });

    const result = await service.resolveByStaffId('S1', 'staff-mongo-id', 'actor-1', 'Actor');

    expect(result).toEqual({ resolvedCount: 0, batchesUpdated: 0 });
    expect(mockContributionsService.processPayment).not.toHaveBeenCalled();
    expect(batchA.save).not.toHaveBeenCalled();
  });

  it('resolves multiple matching entries within the same batch', async () => {
    const batchA = makeBatch({
      flaggedEntries: [
        { staffId: 'S1', employeeName: 'Jane', amount: 100, reason: 'Staff ID not found' },
        { staffId: 'S1', employeeName: 'Jane', amount: 120, reason: 'Staff ID not found' },
      ],
    });
    mockFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([batchA]) });

    const result = await service.resolveByStaffId('S1', 'staff-mongo-id', 'actor-1', 'Actor');

    expect(result).toEqual({ resolvedCount: 2, batchesUpdated: 1 });
    expect(batchA.flaggedEntries).toHaveLength(0);
    expect(batchA.matchedRows).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contributions/import.service.spec.ts`
Expected: FAIL — `service.resolveByStaffId is not a function`

- [ ] **Step 3: Implement**

`apps/api/src/contributions/dto/resolve-by-staff-id.dto.ts`:

```ts
import { IsMongoId, IsString } from 'class-validator';

export class ResolveByStaffIdDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedStaffMongoId!: string;
}
```

`apps/api/src/contributions/import.service.ts` — extract the shared resolve logic and add `resolveByStaffId`. Replace the existing `resolveFlagged` method (the last method in the class, currently lines 133–158) with:

```ts
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

    await this.resolveOneEntry(batch, entryIndex, resolvedStaffMongoId, actorId, actorName);
    await batch.save();

    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }

  async resolveByStaffId(
    originalStaffId: string,
    resolvedStaffMongoId: string,
    actorId: string,
    actorName: string,
  ): Promise<{ resolvedCount: number; batchesUpdated: number }> {
    const batches = await this.batchModel
      .find({ status: { $ne: ImportBatchStatus.Completed }, 'flaggedEntries.staffId': originalStaffId })
      .exec();

    let resolvedCount = 0;
    let batchesUpdated = 0;

    for (const batch of batches) {
      let resolvedInBatch = 0;
      // Resolve from the end so repeated splices don't shift not-yet-visited indices.
      for (let i = batch.flaggedEntries.length - 1; i >= 0; i--) {
        if (batch.flaggedEntries[i].staffId !== originalStaffId) continue;
        await this.resolveOneEntry(batch, i, resolvedStaffMongoId, actorId, actorName);
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
        actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, originalStaffId,
        undefined, { resolvedCount, batchesUpdated },
      );
    }

    return { resolvedCount, batchesUpdated };
  }

  private async resolveOneEntry(
    batch: ImportBatchDocument,
    entryIndex: number,
    resolvedStaffMongoId: string,
    actorId: string,
    actorName: string,
  ): Promise<void> {
    const entry = batch.flaggedEntries[entryIndex];
    await this.contributionsService.processPayment(
      resolvedStaffMongoId, batch.month, batch.year, entry.amount,
      ContributionSource.PayrollImport, actorId, actorName, batch._id.toString(),
    );

    batch.flaggedEntries.splice(entryIndex, 1);
    batch.matchedRows += 1;
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
  }
```

`apps/api/src/contributions/contributions.controller.ts` — add the import and route (after the existing `resolveFlagged` handler, before `@Post('manual')`):

```ts
import { ResolveByStaffIdDto } from './dto/resolve-by-staff-id.dto';
```

```ts
  @Patch('import/resolve-by-staff-id')
  @RequirePermission(AppModule.Contributions, 'full')
  resolveByStaffId(
    @Body() dto: ResolveByStaffIdDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveByStaffId(
      dto.originalStaffId, dto.resolvedStaffMongoId, user.sub, user.displayName,
    );
  }
```

Note this route must be registered before `@Patch('import/:batchId/resolve')` would otherwise be fine since Nest matches literal segments before params correctly regardless of declaration order for `resolve-by-staff-id` vs `:batchId/resolve` (different path shapes), but keep it adjacent to the existing resolve route for readability.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contributions/import.service.spec.ts`
Expected: PASS (all tests, including the original 3 from Task 4 plus the 3 new ones)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contributions/dto/resolve-by-staff-id.dto.ts apps/api/src/contributions/import.service.ts apps/api/src/contributions/import.service.spec.ts apps/api/src/contributions/contributions.controller.ts
git commit -m "feat(api): resolve a flagged Staff ID across all pending contribution batches"
```

---

### Task 11: Contributions bulk resolve (frontend)

**Files:**
- Modify: `apps/web/src/lib/contributions.ts` (add `resolveByStaffId`)
- Modify: `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx` (aggregate flagged-entries view)

**Interfaces:**
- Consumes: `resolveByStaffId` from Task 10's endpoint.

- [ ] **Step 1: Add the API call**

`apps/web/src/lib/contributions.ts` — add after `resolveFlaggedEntry` (after line 87):

```ts
export async function resolveContributionsByStaffId(
  originalStaffId: string,
  resolvedStaffMongoId: string,
): Promise<{ resolvedCount: number; batchesUpdated: number }> {
  const { data } = await apiClient.patch('/contributions/import/resolve-by-staff-id', {
    originalStaffId,
    resolvedStaffMongoId,
  });
  return data;
}
```

- [ ] **Step 2: Add the aggregate flagged-entries section**

`apps/web/src/app/(dashboard)/contributions/import/import-client.tsx` — import the new function (add to the existing `import { importContributions, listImportBatches, resolveFlaggedEntry } from '@/lib/contributions';` line):

```ts
import { importContributions, listImportBatches, resolveFlaggedEntry, resolveContributionsByStaffId } from '@/lib/contributions';
```

Add a grouping type and a derived value right after the `batchHistory` query (after line 47):

```ts
  interface AggregatedFlag {
    staffId: string;
    employeeName: string;
    occurrences: number;
  }

  const aggregatedFlags: AggregatedFlag[] = (() => {
    const byStaffId = new Map<string, AggregatedFlag>();
    for (const batch of batchHistory?.data ?? []) {
      if (batch.status === ImportBatchStatus.Completed) continue;
      for (const entry of batch.flaggedEntries) {
        if (!entry.staffId) continue; // nothing to bulk-map for rows with no Staff ID at all
        const existing = byStaffId.get(entry.staffId);
        if (existing) existing.occurrences++;
        else byStaffId.set(entry.staffId, { staffId: entry.staffId, employeeName: entry.employeeName, occurrences: 1 });
      }
    }
    return Array.from(byStaffId.values());
  })();
```

Add a `bulkResolveTarget` piece of state next to the existing `resolveTarget` state (after `const [resolveTarget, setResolveTarget] = useState<string | null>(null);`):

```ts
  const [bulkResolveTarget, setBulkResolveTarget] = useState<string | null>(null);
```

Add a mutation next to `resolveMutation` (after its closing `});`):

```ts
  const bulkResolveMutation = useMutation({
    mutationFn: ({ originalStaffId, resolvedId }: { originalStaffId: string; resolvedId: string }) =>
      resolveContributionsByStaffId(originalStaffId, resolvedId),
    onSuccess: (result) => {
      setBulkResolveTarget(null);
      setStaffSearch('');
      setStaffOptions([]);
      qc.invalidateQueries({ queryKey: ['import-batches'] });
      toast.success(`Mapped ${result.resolvedCount} entries across ${result.batchesUpdated} imports`);
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Resolve failed');
    },
  });
```

Add a new Card section, placed right before the existing `{/* Import history */}` comment:

```tsx
      {aggregatedFlags.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries (All Pending Imports)" subtitle={`${aggregatedFlags.length} Staff IDs need mapping across one or more imports`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Staff ID', 'Employee Name', 'Occurrences', 'Action'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {aggregatedFlags.map((flag) => (
                    <tr key={flag.staffId} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{flag.staffId}</td>
                      <td className="px-4 py-2 text-neutral-700">{flag.employeeName}</td>
                      <td className="px-4 py-2 text-neutral-500">{flag.occurrences} import{flag.occurrences === 1 ? '' : 's'}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => setBulkResolveTarget(flag.staffId)} className="text-primary-600 hover:underline text-xs font-medium">
                          Map to Staff (all imports)
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

```

Add the bulk-resolve modal right after the existing `{/* Resolve Modal */}` block's closing `)}` (i.e. after the existing per-batch resolve modal, still inside the outer `<div>`):

```tsx
      {bulkResolveTarget && (
        <Modal
          open
          onClose={() => { setBulkResolveTarget(null); setStaffSearch(''); setStaffOptions([]); }}
          title={`Map "${bulkResolveTarget}" to Staff (all imports)`}
          size="sm"
          iconKind="warning"
        >
          <div className="mt-3 space-y-3">
            <Input
              placeholder="Search staff name or ID…"
              value={staffSearch}
              onChange={(e) => handleStaffSearch(e.target.value)}
              autoFocus
            />
            {staffOptions.length > 0 && (
              <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100 max-h-48 overflow-y-auto">
                {staffOptions.map((s) => (
                  <li key={s._id}>
                    <button
                      className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast"
                      onClick={() => bulkResolveMutation.mutate({ originalStaffId: bulkResolveTarget, resolvedId: s._id })}
                      disabled={bulkResolveMutation.isPending}
                    >
                      <span className="font-medium text-neutral-900">{s.fullName}</span>
                      <span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
```

The `staffSearch`/`staffOptions`/`handleStaffSearch` state and function are shared with the existing per-batch resolve flow (already defined higher in the file) — reusing them here means opening the bulk modal while the per-batch modal's search state is non-empty would show stale results, but both modals are mutually exclusive (only one of `resolveTarget`/`bulkResolveTarget` is set at a time) and each modal's `onClose`/`onSuccess` already clears `staffSearch`/`staffOptions`, so this is safe.

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check**

Import the same Staff ID as a flagged entry in 2+ separate contribution import files (different months), create the missing staff record, open Contributions → Import, confirm the "Flagged Entries (All Pending Imports)" section shows that Staff ID with the right occurrence count, click "Map to Staff (all imports)", pick the staff, and confirm both batches move to Completed/lose their flagged entry in one action.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/contributions.ts "apps/web/src/app/(dashboard)/contributions/import/import-client.tsx"
git commit -m "feat(web): bulk-map a flagged Staff ID across all pending contribution imports"
```

---

### Task 12: Loans `resolveByStaffId` (backend)

**Files:**
- Create: `apps/api/src/loans/dto/resolve-loan-by-staff-id.dto.ts`
- Modify: `apps/api/src/loans/loans.import.service.ts` (extract `resolveOneEntry`, add `resolveByStaffId`)
- Modify: `apps/api/src/loans/loans.controller.ts` (add `resolveByStaffId` route)
- Test: extend `apps/api/src/loans/loans.import.service.spec.ts`

**Interfaces:**
- Produces: `LoansImportService.resolveByStaffId(originalStaffId: string, resolvedLoanId: string, actorId: string, actorName: string): Promise<{ resolvedCount: number; batchesUpdated: number }>`. `PATCH /loans/import/resolve-by-staff-id`, body `{ originalStaffId, resolvedLoanId }`. Task 13's frontend calls this.

- [ ] **Step 1: Write the failing test**

Add a `mockFind` to the existing `mockBatchModel` in `apps/api/src/loans/loans.import.service.spec.ts` (replace the `const mockBatchModel = ...` line):

```ts
const mockFind = jest.fn();
const mockBatchModel = { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: mockFind };
```

Add a new `describe` block at the bottom of the file:

```ts
describe('LoansImportService — resolveByStaffId', () => {
  let service: LoansImportService;

  function makeBatch(flaggedEntries: any[] = []) {
    return {
      _id: 'batch-x',
      status: 'Pending',
      matchedRows: 0,
      flaggedRows: flaggedEntries.length,
      flaggedEntries,
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansImportService,
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        { provide: getModelToken(LoanImportBatch.name), useValue: mockBatchModel },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansImportService);
    jest.clearAllMocks();
  });

  it('resolves the matching flagged entry in every pending batch, applying the same loan to each', async () => {
    const batchA = makeBatch([{ rowNumber: 2, staffId: 'S1', staffName: 'Jane', loanId: '', amount: 300, paidDate: '2026-01-01T00:00:00.000Z', reason: 'Staff ID not found' }]);
    const batchB = makeBatch([{ rowNumber: 2, staffId: 'S1', staffName: 'Jane', loanId: '', amount: 350, paidDate: '2026-02-01T00:00:00.000Z', reason: 'Staff ID not found' }]);
    mockFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([batchA, batchB]) });

    const result = await service.resolveByStaffId('S1', 'loan-mongo-id', 'actor-1', 'Actor');

    expect(result).toEqual({ resolvedCount: 2, batchesUpdated: 2 });
    expect(mockLoansService.recordPaymentInternal).toHaveBeenCalledTimes(2);
    expect(mockLoansService.recordPaymentInternal).toHaveBeenCalledWith(
      'loan-mongo-id', expect.objectContaining({ amount: 300 }), expect.anything(), 'actor-1', 'Actor',
    );
    expect(batchA.flaggedEntries).toHaveLength(0);
    expect(batchB.flaggedEntries).toHaveLength(0);
  });

  it('returns zero counts when no batch has a matching staffId', async () => {
    mockFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    const result = await service.resolveByStaffId('S1', 'loan-mongo-id', 'actor-1', 'Actor');

    expect(result).toEqual({ resolvedCount: 0, batchesUpdated: 0 });
    expect(mockLoansService.recordPaymentInternal).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest loans/loans.import.service.spec.ts`
Expected: FAIL — `service.resolveByStaffId is not a function`

- [ ] **Step 3: Implement**

`apps/api/src/loans/dto/resolve-loan-by-staff-id.dto.ts`:

```ts
import { IsMongoId, IsString } from 'class-validator';

export class ResolveLoanByStaffIdDto {
  @IsString() originalStaffId!: string;
  @IsMongoId() resolvedLoanId!: string;
}
```

`apps/api/src/loans/loans.import.service.ts` — extract the shared resolve logic and add `resolveByStaffId`. Replace the existing `resolveFlagged` method (currently lines 159–200) with:

```ts
  async resolveFlagged(
    batchId: string,
    rowNumber: number,
    resolvedLoanId: string,
    actorId: string,
    actorName: string,
  ): Promise<LoanImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    const entryIdx = batch.flaggedEntries.findIndex((e) => e.rowNumber === rowNumber);
    if (entryIdx === -1) throw new NotFoundException(`Flagged entry row ${rowNumber} not found`);

    await this.resolveOneEntry(batch, entryIdx, resolvedLoanId, actorId, actorName);
    await batch.save();

    this.auditService.log(
      actorId, actorName, AuditAction.Update, AuditEntity.Loan, batchId,
      undefined, { resolvedRow: rowNumber, resolvedLoanId },
    );

    return batch;
  }

  async resolveByStaffId(
    originalStaffId: string,
    resolvedLoanId: string,
    actorId: string,
    actorName: string,
  ): Promise<{ resolvedCount: number; batchesUpdated: number }> {
    const batches = await this.batchModel
      .find({ status: { $ne: ImportBatchStatus.Resolved }, 'flaggedEntries.staffId': originalStaffId })
      .exec();

    let resolvedCount = 0;
    let batchesUpdated = 0;

    for (const batch of batches) {
      let resolvedInBatch = 0;
      for (let i = batch.flaggedEntries.length - 1; i >= 0; i--) {
        if (batch.flaggedEntries[i].staffId !== originalStaffId) continue;
        await this.resolveOneEntry(batch, i, resolvedLoanId, actorId, actorName);
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
        actorId, actorName, AuditAction.Update, AuditEntity.Loan, originalStaffId,
        undefined, { resolvedCount, batchesUpdated },
      );
    }

    return { resolvedCount, batchesUpdated };
  }

  private async resolveOneEntry(
    batch: LoanImportBatchDocument,
    entryIdx: number,
    resolvedLoanId: string,
    actorId: string,
    actorName: string,
  ): Promise<void> {
    const entry = batch.flaggedEntries[entryIdx];
    const paidDate = entry.paidDate
      ? new Date(entry.paidDate).toISOString()
      : new Date().toISOString();

    await this.loansService.recordPaymentInternal(
      resolvedLoanId,
      { amount: entry.amount, paidDate, notes: entry.notes },
      RepaymentSource.Import,
      actorId,
      actorName,
    );

    batch.flaggedEntries.splice(entryIdx, 1);
    batch.matchedRows += 1;
    batch.flaggedRows  -= 1;
    batch.status = batch.flaggedRows === 0 ? ImportBatchStatus.Resolved : ImportBatchStatus.Pending;
  }
```

Note: this preserves the existing (slightly inconsistent with contributions) rule that a fully-resolved loan-repayment batch ends in `Resolved` status rather than `Completed` — that's the pre-existing behavior at the current `loans.import.service.ts:186`, unchanged here.

`apps/api/src/loans/loans.controller.ts` — add the import and route (right after the existing `resolveFlagged` handler, before the `// ── loan records import routes ──` comment):

```ts
import { ResolveLoanByStaffIdDto } from './dto/resolve-loan-by-staff-id.dto';
```

```ts
  @Patch('import/resolve-by-staff-id')
  @RequirePermission(AppModule.Loans, 'full')
  resolveLoanByStaffId(
    @Body() dto: ResolveLoanByStaffIdDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.resolveByStaffId(
      dto.originalStaffId, dto.resolvedLoanId, user.sub, user.displayName,
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest loans/loans.import.service.spec.ts`
Expected: PASS (all tests, including the original 2 from Task 6 plus the 2 new ones)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/dto/resolve-loan-by-staff-id.dto.ts apps/api/src/loans/loans.import.service.ts apps/api/src/loans/loans.import.service.spec.ts apps/api/src/loans/loans.controller.ts
git commit -m "feat(api): resolve a flagged Staff ID across all pending loan repayment batches"
```

---

### Task 13: Loans bulk resolve (frontend)

**Files:**
- Modify: `apps/web/src/lib/loans.ts` (add `resolveLoanByStaffId`)
- Modify: `apps/web/src/app/(dashboard)/loans/import/import-client.tsx` (aggregate flagged-entries view)

**Interfaces:**
- Consumes: `resolveLoanByStaffId` from Task 12's endpoint.

- [ ] **Step 1: Add the API call**

`apps/web/src/lib/loans.ts` — add after `resolveLoanFlaggedEntry` (after line 118):

```ts
export async function resolveLoanByStaffId(
  originalStaffId: string,
  resolvedLoanId: string,
): Promise<{ resolvedCount: number; batchesUpdated: number }> {
  const { data } = await apiClient.patch('/loans/import/resolve-by-staff-id', {
    originalStaffId,
    resolvedLoanId,
  });
  return data;
}
```

- [ ] **Step 2: Add the aggregate flagged-entries section**

`apps/web/src/app/(dashboard)/loans/import/import-client.tsx` — import the new function (add to the existing `import { importLoanRepayments, listLoanImportBatches, resolveLoanFlaggedEntry, listLoans } from '@/lib/loans';` block):

```ts
import {
  importLoanRepayments,
  listLoanImportBatches,
  resolveLoanFlaggedEntry,
  resolveLoanByStaffId,
  listLoans,
} from '@/lib/loans';
```

Add a grouping type and derived value right after the `batchHistory` query:

```ts
  interface AggregatedFlag {
    staffId: string;
    staffName: string;
    occurrences: number;
  }

  const aggregatedFlags: AggregatedFlag[] = (() => {
    const byStaffId = new Map<string, AggregatedFlag>();
    for (const batch of batchHistory?.data ?? []) {
      if (batch.status === ImportBatchStatus.Resolved || batch.status === ImportBatchStatus.Completed) continue;
      for (const entry of batch.flaggedEntries) {
        if (!entry.staffId) continue;
        const existing = byStaffId.get(entry.staffId);
        if (existing) existing.occurrences++;
        else byStaffId.set(entry.staffId, { staffId: entry.staffId, staffName: entry.staffName, occurrences: 1 });
      }
    }
    return Array.from(byStaffId.values());
  })();
```

Add a `bulkResolveTarget` state next to the existing `resolveState` (after `const [resolveState, setResolveState] = useState<ResolveState | null>(null);`):

```ts
  const [bulkResolveStaffId, setBulkResolveStaffId] = useState<string | null>(null);
```

Add a mutation next to `resolveMutation` (after its closing `});`), reusing the existing `selectedStaffId`/`staffLoans` state that already drives the per-entry loan picker:

```ts
  const bulkResolveMutation = useMutation({
    mutationFn: ({ resolvedLoanId }: { resolvedLoanId: string }) =>
      resolveLoanByStaffId(bulkResolveStaffId!, resolvedLoanId),
    onSuccess: (result) => {
      setBulkResolveStaffId(null);
      closeResolveModal();
      qc.invalidateQueries({ queryKey: ['loan-import-batches'] });
      toast.success(`Mapped ${result.resolvedCount} entries across ${result.batchesUpdated} imports`);
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Resolve failed');
    },
  });
```

Add a new Card section right before the existing `{/* Import history */}` comment:

```tsx
      {aggregatedFlags.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries (All Pending Imports)" subtitle={`${aggregatedFlags.length} Staff IDs need mapping across one or more imports`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Staff ID', 'Staff Name', 'Occurrences', 'Action'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {aggregatedFlags.map((flag) => (
                    <tr key={flag.staffId} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{flag.staffId}</td>
                      <td className="px-4 py-2 text-neutral-700">{flag.staffName || '—'}</td>
                      <td className="px-4 py-2 text-neutral-500">{flag.occurrences} import{flag.occurrences === 1 ? '' : 's'}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => setBulkResolveStaffId(flag.staffId)} className="text-primary-600 hover:underline text-xs font-medium">
                          Map to Staff (all imports)
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

```

Add the bulk-resolve modal right after the existing per-entry `{/* Resolve Modal */}` block, still inside the outer `<div>`. It reuses the existing staff-search + loan-picker UI, but writes to `bulkResolveMutation` instead of `resolveMutation`:

```tsx
      {bulkResolveStaffId && (
        <Modal
          open
          onClose={() => { setBulkResolveStaffId(null); closeResolveModal(); }}
          title={`Map "${bulkResolveStaffId}" to Staff (all imports)`}
          size="sm"
          iconKind="warning"
          footer={
            <Button variant="secondary" onClick={() => { setBulkResolveStaffId(null); closeResolveModal(); }}>Cancel</Button>
          }
        >
          <div className="mt-3 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-neutral-600">Search for staff to find the correct loan:</p>
              <Input
                placeholder="Search staff name or ID…"
                value={staffSearch}
                onChange={(e) => handleStaffSearch(e.target.value)}
                autoFocus
              />
              {staffOptions.length > 0 && !selectedStaffId && (
                <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100 max-h-40 overflow-y-auto">
                  {staffOptions.map((s) => (
                    <li key={s._id}>
                      <button
                        className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast"
                        onClick={() => { setSelectedStaffId(s._id); setStaffSearch(s.fullName); setStaffOptions([]); }}
                      >
                        <span className="font-medium text-neutral-900">{s.fullName}</span>
                        <span className="text-neutral-400 ml-2 text-xs font-mono">{s.staffId}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selectedStaffId && staffLoans && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-neutral-600">Select the loan to apply every matching payment to:</p>
                {staffLoans.data.length === 0 ? (
                  <p className="text-xs text-danger-600">No active loans found for this staff.</p>
                ) : (
                  <ul className="border border-neutral-200 rounded-sm divide-y divide-neutral-100">
                    {staffLoans.data.map((loan) => (
                      <li key={loan._id}>
                        <button
                          className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors duration-fast"
                          onClick={() => bulkResolveMutation.mutate({ resolvedLoanId: loan._id })}
                          disabled={bulkResolveMutation.isPending}
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <span className="font-medium text-neutral-900">{fmtGHS(loan.principalAmount)}</span>
                              <span className="text-neutral-400 ml-2 text-xs">disbursed {fmtDate(loan.disbursedDate)}</span>
                            </div>
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded-xs font-medium',
                              loan.status === 'Active' ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-500',
                            )}>
                              {loan.status}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
```

This reuses `selectedStaffId`/`staffLoans`/`staffSearch`/`staffOptions`/`handleStaffSearch`/`closeResolveModal` already defined for the per-entry modal — same mutual-exclusion reasoning as Task 11 (only one of `resolveState`/`bulkResolveStaffId` is set at a time, and `closeResolveModal()` already resets all the shared search/selection state on both paths).

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check**

Import the same Staff ID as a flagged repayment entry across 2+ separate loan import files, confirm "Flagged Entries (All Pending Imports)" lists it with the right occurrence count, use "Map to Staff (all imports)", pick the staff and their loan, confirm every matching batch resolves in one action.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/loans.ts "apps/web/src/app/(dashboard)/loans/import/import-client.tsx"
git commit -m "feat(web): bulk-map a flagged Staff ID across all pending loan repayment imports"
```

---

## Self-Review Notes

**Spec coverage:** §1 progress bar → Tasks 1–9 (infra + all 6 flows). §2 date bug → Task 5. §3 bulk resolve → Tasks 10–13 (contributions + loans only, matching the spec's explicit scope narrowing). Error-handling requirements from the spec (404-as-silent-retry, zero-match bulk resolve returning counts not throwing) are covered in Task 3 (hook catch block) and Task 10/12 (`resolvedCount: 0` tests) respectively.

**Placeholder scan:** no TBD/TODO; every step has runnable code or an exact command.

**Type consistency:** `ImportProgress` (`processed`/`total`/`done`) is defined once in Task 1's service and reused verbatim by the Task 2 controller, Task 3's hook, and every `ImportProgressBar` consumer. `resolveByStaffId`'s return shape `{ resolvedCount, batchesUpdated }` is identical across contributions (Task 10) and loans (Task 12), and both frontends (Tasks 11/13) destructure it the same way. `jobId?: string` is the trailing optional param on every `processImport` across Tasks 4–9, consistently threaded controller → lib → client.
