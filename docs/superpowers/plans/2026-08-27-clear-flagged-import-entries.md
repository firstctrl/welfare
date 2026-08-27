# Clear Flagged Import Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user dismiss a single flagged import row (no downstream record created) or delete an entire import batch, across all 6 import flows — including building the Import History UI that investments and remittances currently lack entirely.

**Architecture:** Each of the 6 `*ImportService` classes gets two new methods, `dismissFlaggedEntry(batchId, index, actorId, actorName)` and `deleteBatch(batchId, actorId, actorName)`, keyed by array index (the only key that's always unique across every flagged-entry shape in this codebase). Two new `GET` routes (list/get) are added for investments and remittances, which have none today. Frontend gets a shared `ConfirmModal` for the irreversible delete action, a Dismiss button wired into each existing (or newly built) flagged-entries table, and a Delete button on every Import History row.

**Tech Stack:** NestJS 10 / Mongoose (API), Next.js / React Query / axios (web), Jest (API unit tests only — web verified via `tsc --noEmit`/`next build` + manual pass, per this repo's existing convention).

**Spec:** `docs/superpowers/specs/2026-08-27-clear-flagged-import-entries-design.md`

## Global Constraints

- Delete removes only the batch tracking document — never touches already-created contribution/loan/investment/remittance records from that import's matched rows.
- Dismiss/delete never create any domain record — dismiss just drops the flagged entry.
- All new routes gated `@RequirePermission(AppModule.X, 'full')`, matching every other mutating route in each controller.
- Dismiss audit-logs `AuditAction.Update`; delete audit-logs `AuditAction.Delete`. Both use `AuditEntity.ImportBatch` (generic, matches the existing contributions convention — no per-domain audit entity exists for import batches).
- Investments/remittances batch schemas have no `status` field — dismiss there only touches `flaggedRows` (array) and `flagged` (count), never a status enum.
- Every array-index operation validates bounds and throws `BadRequestException` on an out-of-range index (per spec's error-handling section).

---

## File Structure

New files:
- `packages/shared/src/interfaces/investment-import-batch.interface.ts`, `remittance-import-batch.interface.ts` — new shared types
- `apps/api/src/investments/investments.import.service.spec.ts` — extended (already exists, adding list/get/dismiss/delete tests)
- `apps/api/src/{staff,contributions,loans,investments,remittances}/dto/dismiss-flagged-*.dto.ts` — 5 new DTOs (loans module's is shared by both its import flows)
- `apps/web/src/components/ui/confirm-modal.tsx` — reusable delete confirmation
- `apps/web/src/app/(dashboard)/investments/import/import-history.tsx`, `apps/web/src/app/(dashboard)/remittances/import/import-history.tsx` — NEW, since these two currently have zero history UI (kept as separate components from the existing upload-flow component rather than growing one file past what it can hold in view)

Modified files (per import flow):
- `apps/api/src/{contributions/import.service.ts, staff/staff.import.service.ts, loans/loans.import.service.ts, loans/loans.records.import.service.ts, investments/investments.import.service.ts, remittances/remittances.import.service.ts}` — add `dismissFlaggedEntry`/`deleteBatch` (+ `listBatches`/`getBatch` for investments/remittances only).
- Matching `*.controller.ts` — new routes.
- Matching `apps/web/src/lib/{contributions,staff,loans,investments,remittances}.ts` — new client functions.
- Matching `apps/web/src/app/(dashboard)/**/import/import-client.tsx` — Dismiss/Delete buttons + confirm modal.
- `packages/shared/src/index.ts` — export the 2 new interfaces.

---

### Task 1: Shared types for investments/remittances import batches

**Files:**
- Create: `packages/shared/src/interfaces/investment-import-batch.interface.ts`
- Create: `packages/shared/src/interfaces/remittance-import-batch.interface.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `IInvestmentFlaggedRow { rowNumber, description, flagReason }`, `IInvestmentImportBatch { _id, fileName, recordedBy, total, imported, flagged, flaggedRows: IInvestmentFlaggedRow[], createdAt }`; `IRemittanceFlaggedRow { rowNumber, month, year, flagReason }`, `IRemittanceImportBatch { _id, fileName, recordedBy, total, imported, flagged, flaggedRows: IRemittanceFlaggedRow[], createdAt }`. Task 3 (investments backend) and Task 4 (remittances backend) return these shapes; Task 13/14 (frontend) import them.

This task has no unit test of its own (pure type declarations) — verified by the package build in Step 3.

- [ ] **Step 1: Create the investments interface**

```ts
// packages/shared/src/interfaces/investment-import-batch.interface.ts
export interface IInvestmentFlaggedRow {
  rowNumber: number;
  description: string;
  flagReason: string;
}

export interface IInvestmentImportBatch {
  _id: string;
  fileName: string;
  recordedBy: string;
  total: number;
  imported: number;
  flagged: number;
  flaggedRows: IInvestmentFlaggedRow[];
  createdAt: string;
}
```

- [ ] **Step 2: Create the remittances interface**

```ts
// packages/shared/src/interfaces/remittance-import-batch.interface.ts
export interface IRemittanceFlaggedRow {
  rowNumber: number;
  month: number;
  year: number;
  flagReason: string;
}

export interface IRemittanceImportBatch {
  _id: string;
  fileName: string;
  recordedBy: string;
  total: number;
  imported: number;
  flagged: number;
  flaggedRows: IRemittanceFlaggedRow[];
  createdAt: string;
}
```

- [ ] **Step 3: Export from the package barrel and rebuild**

`packages/shared/src/index.ts` — add after the existing `export type { ILoanRecordFlaggedEntry, ILoanRecordsImportBatch } from './interfaces/loan-records-import-batch.interface';` line:

```ts
export type { IInvestmentFlaggedRow, IInvestmentImportBatch } from './interfaces/investment-import-batch.interface';
export type { IRemittanceFlaggedRow, IRemittanceImportBatch } from './interfaces/remittance-import-batch.interface';
```

Run: `cd packages/shared && npm run build`
Expected: exits 0, no TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/interfaces/investment-import-batch.interface.ts packages/shared/src/interfaces/remittance-import-batch.interface.ts packages/shared/src/index.ts
git commit -m "feat(shared): add IInvestmentImportBatch and IRemittanceImportBatch types"
```

---

### Task 2: Reusable `ConfirmModal` (frontend)

**Files:**
- Create: `apps/web/src/components/ui/confirm-modal.tsx`

**Interfaces:**
- Produces: `<ConfirmModal open title body confirmLabel="Delete" onConfirm onClose isPending? />`. Consumed by Tasks 9–14's Delete-batch flow in all 6 import clients.
- Consumes: `Modal`/`Button` from `apps/web/src/components/ui/{modal,button}.tsx` (existing, confirmed API in `modal.tsx`: `open`, `onClose`, `title`, `children`, `footer`, `size`, `iconKind`).

No web test runner in this repo (per prior work in this codebase) — verified by `tsc --noEmit` and a manual click-through once wired into Task 9.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/components/ui/confirm-modal.tsx
'use client';

import { Modal } from './modal';
import { Button } from './button';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  isPending = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      iconKind="danger"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={isPending} disabled={isPending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-neutral-600">{body}</p>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (`Button`'s `Variant` union in `apps/web/src/components/ui/button.tsx` already includes `'danger'`, confirmed).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/confirm-modal.tsx
git commit -m "feat(web): add reusable ConfirmModal for destructive actions"
```

---

### Task 3: Investments backend — list/get/dismiss/delete

**Files:**
- Modify: `apps/api/src/investments/investments.import.service.ts`
- Modify: `apps/api/src/investments/investments.controller.ts`
- Create: `apps/api/src/investments/dto/dismiss-flagged-row.dto.ts`
- Test: `apps/api/src/investments/investments.import.service.spec.ts` (extend existing)

**Interfaces:**
- Produces: `InvestmentsImportService.listBatches(page?, limit?): Promise<PaginatedResult<InvestmentImportBatchDocument>>`, `.getBatch(batchId): Promise<InvestmentImportBatchDocument>` (throws `NotFoundException`), `.dismissFlaggedEntry(batchId, index, actorId, actorName): Promise<InvestmentImportBatchDocument>` (throws `NotFoundException`/`BadRequestException`), `.deleteBatch(batchId, actorId, actorName): Promise<void>` (throws `NotFoundException`).
- New routes: `GET /investments/import`, `GET /investments/import/:batchId`, `PATCH /investments/import/:batchId/dismiss` (body `{ index }`), `DELETE /investments/import/:batchId`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/investments/investments.import.service.spec.ts` (after the existing `describe('InvestmentsImportService — progress tracking', ...)` block's closing `});`):

```ts
describe('InvestmentsImportService — list/get/dismiss/delete', () => {
  let service: InvestmentsImportService;
  const mockFind = jest.fn();
  const mockCountDocuments = jest.fn();
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsImportService,
        {
          provide: getModelToken(InvestmentImportBatch.name),
          useValue: {
            create: mockCreate,
            updateOne: mockUpdateOne,
            find: mockFind,
            countDocuments: mockCountDocuments,
            findById: mockFindById,
            findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: InvestmentsService, useValue: mockInvestmentsService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(InvestmentsImportService);
    jest.clearAllMocks();
  });

  it('listBatches paginates newest-first', async () => {
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ _id: 'b1' }]),
    });
    mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

    const result = await service.listBatches(1, 20);

    expect(result).toEqual({ data: [{ _id: 'b1' }], total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it('getBatch throws NotFoundException when missing', async () => {
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.getBatch('missing')).rejects.toThrow('Import batch missing not found');
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      flagged: 2,
      flaggedRows: [
        { rowNumber: 2, description: 'A', flagReason: 'Missing Cost' },
        { rowNumber: 3, description: 'B', flagReason: 'Missing Cost' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedRows).toEqual([{ rowNumber: 3, description: 'B', flagReason: 'Missing Cost' }]);
    expect(result.flagged).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flagged: 1, flaggedRows: [{ rowNumber: 2, description: 'A', flagReason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('deleteBatch deletes and throws NotFoundException when missing', async () => {
    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'b1' }) });
    await expect(service.deleteBatch('b1', 'actor-1', 'Actor')).resolves.toBeUndefined();

    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteBatch('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest investments/investments.import.service.spec.ts`
Expected: FAIL — `listBatches`/`getBatch`/`dismissFlaggedEntry`/`deleteBatch` don't exist on `InvestmentsImportService`.

- [ ] **Step 3: Implement**

`apps/api/src/investments/investments.import.service.ts` — add imports (replace the top of the file):

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, PaginatedResult } from '@welfare/shared';
import { InvestmentImportBatch, InvestmentImportBatchDocument } from './schemas/investment-import-batch.schema';
import { InvestmentsService } from './investments.service';
import { normalizeExcelDate } from '../common/utils/excel-date.util';
import { ImportProgressService } from '../common/import-progress.service';
import { AuditService } from '../audit/audit.service';
```

Add `AuditService` to the constructor (replace the constructor):

```ts
  constructor(
    @InjectModel(InvestmentImportBatch.name)
    private readonly batchModel: Model<InvestmentImportBatchDocument>,
    private readonly investmentsService: InvestmentsService,
    private readonly progressService: ImportProgressService,
    private readonly auditService: AuditService,
  ) {}
```

Add the four new methods at the end of the class (after the closing `}` of `processImport`, before the class's final `}`):

```ts
  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<InvestmentImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<InvestmentImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<InvestmentImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedRows.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedRows.splice(index, 1);
    batch.flagged -= 1;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }

  async deleteBatch(batchId: string, actorId: string, actorName: string): Promise<void> {
    const result = await this.batchModel.findByIdAndDelete(batchId).exec();
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.ImportBatch, batchId);
  }
```

`apps/api/src/investments/dto/dismiss-flagged-row.dto.ts`:

```ts
import { IsInt, Min } from 'class-validator';

export class DismissFlaggedRowDto {
  @IsInt() @Min(0) index!: number;
}
```

`apps/api/src/investments/investments.controller.ts` — add imports:

```ts
import { DismissFlaggedRowDto } from './dto/dismiss-flagged-row.dto';
```

Add routes after `importFile` (before the closing `}` of the class):

```ts
  @Get('import')
  @RequirePermission(AppModule.Investments, 'readonly')
  listImportBatches(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.importService.listBatches(page ? +page : 1, limit ? +limit : 20);
  }

  @Get('import/:batchId')
  @RequirePermission(AppModule.Investments, 'readonly')
  getImportBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Investments, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedRowDto,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user._id.toString(), user.displayName);
  }

  @Delete('import/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Investments, 'full')
  async deleteImportBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    await this.importService.deleteBatch(batchId, user._id.toString(), user.displayName);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest investments/investments.import.service.spec.ts`
Expected: PASS (all tests, including the 2 pre-existing progress-tracking tests plus the 5 new ones)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/investments/investments.import.service.ts apps/api/src/investments/investments.import.service.spec.ts apps/api/src/investments/investments.controller.ts apps/api/src/investments/dto/dismiss-flagged-row.dto.ts
git commit -m "feat(api): add import history list/get and dismiss/delete for investments"
```

---

### Task 4: Remittances backend — list/get/dismiss/delete

**Files:**
- Modify: `apps/api/src/remittances/remittances.import.service.ts`
- Modify: `apps/api/src/remittances/remittances.controller.ts`
- Create: `apps/api/src/remittances/dto/dismiss-flagged-row.dto.ts`
- Test: `apps/api/src/remittances/remittances.import.service.spec.ts` (extend existing)

**Interfaces:** identical shape to Task 3, on `RemittancesImportService`/`RemittancesController`, operating on `flaggedRows: { rowNumber, month, year, flagReason }[]` / `flagged: number`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/remittances/remittances.import.service.spec.ts` (after the existing `describe('RemittancesImportService — progress tracking', ...)` block's closing `});`), first adding `getModelToken`-style mocks:

```ts
describe('RemittancesImportService — list/get/dismiss/delete', () => {
  let service: RemittancesImportService;
  const mockFind = jest.fn();
  const mockCountDocuments = jest.fn();
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemittancesImportService,
        {
          provide: getModelToken(RemittanceImportBatch.name),
          useValue: {
            create: mockBatchModel.create,
            updateOne: mockBatchModel.updateOne,
            find: mockFind,
            countDocuments: mockCountDocuments,
            findById: mockFindById,
            findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: RemittancesService, useValue: mockRemittancesService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(RemittancesImportService);
    jest.clearAllMocks();
  });

  it('listBatches paginates newest-first', async () => {
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ _id: 'b1' }]),
    });
    mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

    const result = await service.listBatches(1, 20);

    expect(result).toEqual({ data: [{ _id: 'b1' }], total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it('getBatch throws NotFoundException when missing', async () => {
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.getBatch('missing')).rejects.toThrow('Import batch missing not found');
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      flagged: 2,
      flaggedRows: [
        { rowNumber: 2, month: 1, year: 2026, flagReason: 'Duplicate period' },
        { rowNumber: 3, month: 2, year: 2026, flagReason: 'Duplicate period' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedRows).toEqual([{ rowNumber: 3, month: 2, year: 2026, flagReason: 'Duplicate period' }]);
    expect(result.flagged).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flagged: 1, flaggedRows: [{ rowNumber: 2, month: 1, year: 2026, flagReason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('deleteBatch deletes and throws NotFoundException when missing', async () => {
    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'b1' }) });
    await expect(service.deleteBatch('b1', 'actor-1', 'Actor')).resolves.toBeUndefined();

    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteBatch('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest remittances/remittances.import.service.spec.ts`
Expected: FAIL — `listBatches`/`getBatch`/`dismissFlaggedEntry`/`deleteBatch` don't exist on `RemittancesImportService`.

- [ ] **Step 3: Implement**

`apps/api/src/remittances/remittances.import.service.ts` — add imports (replace the top of the file):

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import { AuditAction, AuditEntity, PaginatedResult } from '@welfare/shared';
import { RemittanceImportBatch, RemittanceImportBatchDocument } from './schemas/remittance-import-batch.schema';
import { RemittancesService } from './remittances.service';
import { normalizeExcelDate } from '../common/utils/excel-date.util';
import { ImportProgressService } from '../common/import-progress.service';
import { AuditService } from '../audit/audit.service';
```

Add `AuditService` to the constructor:

```ts
  constructor(
    @InjectModel(RemittanceImportBatch.name)
    private readonly batchModel: Model<RemittanceImportBatchDocument>,
    private readonly remittancesService: RemittancesService,
    private readonly progressService: ImportProgressService,
    private readonly auditService: AuditService,
  ) {}
```

Add the four new methods at the end of the class:

```ts
  async listBatches(page = 1, limit = 20): Promise<PaginatedResult<RemittanceImportBatchDocument>> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.batchModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.batchModel.countDocuments().exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBatch(batchId: string): Promise<RemittanceImportBatchDocument> {
    const batch = await this.batchModel.findById(batchId).exec();
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    return batch;
  }

  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<RemittanceImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedRows.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedRows.splice(index, 1);
    batch.flagged -= 1;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }

  async deleteBatch(batchId: string, actorId: string, actorName: string): Promise<void> {
    const result = await this.batchModel.findByIdAndDelete(batchId).exec();
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.ImportBatch, batchId);
  }
```

`apps/api/src/remittances/dto/dismiss-flagged-row.dto.ts`:

```ts
import { IsInt, Min } from 'class-validator';

export class DismissFlaggedRowDto {
  @IsInt() @Min(0) index!: number;
}
```

`apps/api/src/remittances/remittances.controller.ts` — add import:

```ts
import { DismissFlaggedRowDto } from './dto/dismiss-flagged-row.dto';
```

Add routes after `importFile` (before the `@Patch(':id')` handler):

```ts
  @Get('import')
  @RequirePermission(AppModule.Remittances, 'readonly')
  listImportBatches(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.importService.listBatches(page ? +page : 1, limit ? +limit : 20);
  }

  @Get('import/:batchId')
  @RequirePermission(AppModule.Remittances, 'readonly')
  getImportBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatch(batchId);
  }

  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Remittances, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedRowDto,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user._id.toString(), user.displayName);
  }

  @Delete('import/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Remittances, 'full')
  async deleteImportBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { _id: { toString(): string }; displayName: string },
  ) {
    await this.importService.deleteBatch(batchId, user._id.toString(), user.displayName);
  }
```

Note: this must be placed so it doesn't collide with the existing `@Delete(':id')` route further down — `import/:batchId` is 2 static+param segments under a literal `import` prefix, `:id` is a single bare param at root, so Nest/Express route matching (by segment count and literal-before-param precedence) keeps them distinct regardless of declaration order, same as every other module's import routes in this codebase.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest remittances/remittances.import.service.spec.ts`
Expected: PASS (all tests — the 4 original business-logic tests, 2 progress-tracking tests, and 5 new ones)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/remittances/remittances.import.service.ts apps/api/src/remittances/remittances.import.service.spec.ts apps/api/src/remittances/remittances.controller.ts apps/api/src/remittances/dto/dismiss-flagged-row.dto.ts
git commit -m "feat(api): add import history list/get and dismiss/delete for remittances"
```

---

### Task 5: Staff backend — dismiss/delete

**Files:**
- Modify: `apps/api/src/staff/staff.import.service.ts`
- Modify: `apps/api/src/staff/staff.controller.ts`
- Create: `apps/api/src/staff/dto/dismiss-flagged-entry.dto.ts`
- Test: `apps/api/src/staff/staff.import.service.spec.ts` (extend existing)

**Interfaces:**
- Produces: `StaffImportService.dismissFlaggedEntry(batchId, index, actorId, actorName): Promise<StaffImportBatchDocument>`, `.deleteBatch(batchId, actorId, actorName): Promise<void>`.
- New routes: `PATCH /staff/import/:batchId/dismiss`, `DELETE /staff/import/:batchId`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/staff/staff.import.service.spec.ts` (after the existing `describe(...)` block's closing `});`):

```ts
describe('StaffImportService — dismiss/delete', () => {
  let service: StaffImportService;
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffImportService,
        {
          provide: getModelToken(StaffImportBatch.name),
          useValue: { create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, findById: mockFindById, findByIdAndDelete: mockFindByIdAndDelete },
        },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(StaffImportService);
    jest.clearAllMocks();
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count, recomputing status', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 2,
      flaggedEntries: [
        { rowNumber: 2, staffId: 'S1', fullName: 'A', reason: 'Missing Email' },
        { rowNumber: 3, staffId: 'S2', fullName: 'B', reason: 'Missing Email' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedEntries).toEqual([{ rowNumber: 3, staffId: 'S2', fullName: 'B', reason: 'Missing Email' }]);
    expect(result.flaggedRows).toBe(1);
    expect(result.status).toBe('Pending');
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry marks the batch Completed once the last flagged entry is cleared', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 1,
      flaggedEntries: [{ rowNumber: 2, staffId: 'S1', fullName: 'A', reason: 'Missing Email' }],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.status).toBe('Completed');
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flaggedRows: 1, flaggedEntries: [{ rowNumber: 2, staffId: 'S1', fullName: 'A', reason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('deleteBatch deletes and throws NotFoundException when missing', async () => {
    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'b1' }) });
    await expect(service.deleteBatch('b1', 'actor-1', 'Actor')).resolves.toBeUndefined();

    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteBatch('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest staff/staff.import.service.spec.ts`
Expected: FAIL — `dismissFlaggedEntry`/`deleteBatch` don't exist on `StaffImportService`.

- [ ] **Step 3: Implement**

`apps/api/src/staff/staff.import.service.ts` — add `BadRequestException` is already imported; add `AuditAction`/`AuditEntity` are already imported. Add the two new methods at the end of the class (after `getBatch`, before the class's final `}`):

```ts
  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<StaffImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }

  async deleteBatch(batchId: string, actorId: string, actorName: string): Promise<void> {
    const result = await this.batchModel.findByIdAndDelete(batchId).exec();
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.ImportBatch, batchId);
  }
```

`apps/api/src/staff/dto/dismiss-flagged-entry.dto.ts`:

```ts
import { IsInt, Min } from 'class-validator';

export class DismissFlaggedEntryDto {
  @IsInt() @Min(0) index!: number;
}
```

`apps/api/src/staff/staff.controller.ts` — add import:

```ts
import { DismissFlaggedEntryDto } from './dto/dismiss-flagged-entry.dto';
```

Add routes after `getImportBatch` (before `@Post()` create):

```ts
  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Staff, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Delete('import/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Staff, 'full')
  async deleteImportBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    await this.importService.deleteBatch(batchId, user.sub, user.displayName);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest staff/staff.import.service.spec.ts`
Expected: PASS (all tests)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/staff/staff.import.service.ts apps/api/src/staff/staff.import.service.spec.ts apps/api/src/staff/staff.controller.ts apps/api/src/staff/dto/dismiss-flagged-entry.dto.ts
git commit -m "feat(api): add dismiss/delete for staff import batches"
```

---

### Task 6: Contributions backend — dismiss/delete

**Files:**
- Modify: `apps/api/src/contributions/import.service.ts`
- Modify: `apps/api/src/contributions/contributions.controller.ts`
- Create: `apps/api/src/contributions/dto/dismiss-flagged-entry.dto.ts`
- Test: `apps/api/src/contributions/import.service.spec.ts` (extend existing)

**Interfaces:**
- Produces: `ImportService.dismissFlaggedEntry(batchId, index, actorId, actorName): Promise<ImportBatchDocument>`, `.deleteBatch(batchId, actorId, actorName): Promise<void>`.
- New routes: `PATCH /contributions/import/:batchId/dismiss`, `DELETE /contributions/import/:batchId`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/contributions/import.service.spec.ts` (after the existing `describe('ImportService (contributions) — resolveByStaffId', ...)` block's closing `});`):

```ts
describe('ImportService (contributions) — dismiss/delete', () => {
  let service: ImportService;
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        {
          provide: getModelToken(ImportBatch.name),
          useValue: {
            create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: mockFind,
            findById: mockFindById, findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: ContributionsService, useValue: mockContributionsService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(ImportService);
    jest.clearAllMocks();
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 2,
      flaggedEntries: [
        { staffId: 'S1', employeeName: 'A', amount: 100, reason: 'Staff ID not found' },
        { staffId: 'S2', employeeName: 'B', amount: 200, reason: 'Staff ID not found' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedEntries).toEqual([{ staffId: 'S2', employeeName: 'B', amount: 200, reason: 'Staff ID not found' }]);
    expect(result.flaggedRows).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flaggedRows: 1, flaggedEntries: [{ staffId: 'S1', employeeName: 'A', amount: 1, reason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('deleteBatch deletes and throws NotFoundException when missing', async () => {
    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'b1' }) });
    await expect(service.deleteBatch('b1', 'actor-1', 'Actor')).resolves.toBeUndefined();

    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteBatch('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest contributions/import.service.spec.ts`
Expected: FAIL — `dismissFlaggedEntry`/`deleteBatch` don't exist on `ImportService`.

- [ ] **Step 3: Implement**

`apps/api/src/contributions/import.service.ts` — add the two new methods at the end of the class (`BadRequestException`, `AuditAction`, `AuditEntity` already imported):

```ts
  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<ImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.ImportBatch, batchId);
    return batch;
  }

  async deleteBatch(batchId: string, actorId: string, actorName: string): Promise<void> {
    const result = await this.batchModel.findByIdAndDelete(batchId).exec();
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.ImportBatch, batchId);
  }
```

`apps/api/src/contributions/dto/dismiss-flagged-entry.dto.ts`:

```ts
import { IsInt, Min } from 'class-validator';

export class DismissFlaggedEntryDto {
  @IsInt() @Min(0) index!: number;
}
```

`apps/api/src/contributions/contributions.controller.ts` — add import:

```ts
import { DismissFlaggedEntryDto } from './dto/dismiss-flagged-entry.dto';
```

Add routes after `resolveByStaffId` (before `@Post('manual')`):

```ts
  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Contributions, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Delete('import/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Contributions, 'full')
  async deleteImportBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    await this.importService.deleteBatch(batchId, user.sub, user.displayName);
  }
```

Note: this new `DELETE 'import/:batchId'` sits alongside the existing `DELETE ':id'` (contribution-record delete) and `DELETE 'bulk'` routes — different segment shapes (`import/:batchId` vs bare `:id` vs literal `bulk`), so no route-matching conflict regardless of declaration order, consistent with every other module.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest contributions/import.service.spec.ts`
Expected: PASS (all tests)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contributions/import.service.ts apps/api/src/contributions/import.service.spec.ts apps/api/src/contributions/contributions.controller.ts apps/api/src/contributions/dto/dismiss-flagged-entry.dto.ts
git commit -m "feat(api): add dismiss/delete for contribution import batches"
```

---

### Task 7: Loans (repayment) backend — dismiss/delete

**Files:**
- Modify: `apps/api/src/loans/loans.import.service.ts`
- Modify: `apps/api/src/loans/loans.controller.ts`
- Create: `apps/api/src/loans/dto/dismiss-flagged-entry.dto.ts` (shared with Task 8's records-import route)
- Test: `apps/api/src/loans/loans.import.service.spec.ts` (extend existing)

**Interfaces:**
- Produces: `LoansImportService.dismissFlaggedEntry(batchId, index, actorId, actorName): Promise<LoanImportBatchDocument>`, `.deleteBatch(batchId, actorId, actorName): Promise<void>`.
- New routes: `PATCH /loans/import/:batchId/dismiss`, `DELETE /loans/import/:batchId`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/loans/loans.import.service.spec.ts` (after the existing `describe('LoansImportService — resolveByStaffId', ...)` block's closing `});`):

```ts
describe('LoansImportService — dismiss/delete', () => {
  let service: LoansImportService;
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansImportService,
        { provide: getModelToken(Loan.name), useValue: mockLoanModel },
        {
          provide: getModelToken(LoanImportBatch.name),
          useValue: {
            create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate, find: mockFind,
            findById: mockFindById, findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansImportService);
    jest.clearAllMocks();
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 2,
      flaggedEntries: [
        { rowNumber: 2, staffId: 'S1', staffName: 'A', loanId: '', amount: 100, paidDate: '2026-01-01T00:00:00.000Z', reason: 'Staff ID not found' },
        { rowNumber: 3, staffId: 'S2', staffName: 'B', loanId: '', amount: 200, paidDate: '2026-01-01T00:00:00.000Z', reason: 'Staff ID not found' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedEntries).toHaveLength(1);
    expect(result.flaggedEntries[0].staffId).toBe('S2');
    expect(result.flaggedRows).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flaggedRows: 1, flaggedEntries: [{ rowNumber: 2, staffId: 'S1', staffName: 'A', loanId: '', amount: 1, paidDate: '', reason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('deleteBatch deletes and throws NotFoundException when missing', async () => {
    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'b1' }) });
    await expect(service.deleteBatch('b1', 'actor-1', 'Actor')).resolves.toBeUndefined();

    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteBatch('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest loans/loans.import.service.spec.ts`
Expected: FAIL — `dismissFlaggedEntry`/`deleteBatch` don't exist on `LoansImportService`.

- [ ] **Step 3: Implement**

`apps/api/src/loans/loans.import.service.ts` — add the two new methods at the end of the class (`BadRequestException`, `AuditAction`, `AuditEntity` already imported). This service's existing `resolveOneEntry` sets status to `Resolved` (not `Completed`) when flags reach 0 — dismiss follows the same existing convention for consistency:

```ts
  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<LoanImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedRows === 0 ? ImportBatchStatus.Resolved : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, batchId);
    return batch;
  }

  async deleteBatch(batchId: string, actorId: string, actorName: string): Promise<void> {
    const result = await this.batchModel.findByIdAndDelete(batchId).exec();
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.Loan, batchId);
  }
```

`apps/api/src/loans/dto/dismiss-flagged-entry.dto.ts`:

```ts
import { IsInt, Min } from 'class-validator';

export class DismissFlaggedEntryDto {
  @IsInt() @Min(0) index!: number;
}
```

`apps/api/src/loans/loans.controller.ts` — add import:

```ts
import { DismissFlaggedEntryDto } from './dto/dismiss-flagged-entry.dto';
```

Add routes after `resolveLoanByStaffId` (before the `// ── loan records import routes ──` comment):

```ts
  @Patch('import/:batchId/dismiss')
  @RequirePermission(AppModule.Loans, 'full')
  dismissFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.importService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Delete('import/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Loans, 'full')
  async deleteImportBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    await this.importService.deleteBatch(batchId, user.sub, user.displayName);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest loans/loans.import.service.spec.ts`
Expected: PASS (all tests)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/loans.import.service.ts apps/api/src/loans/loans.import.service.spec.ts apps/api/src/loans/loans.controller.ts apps/api/src/loans/dto/dismiss-flagged-entry.dto.ts
git commit -m "feat(api): add dismiss/delete for loan repayment import batches"
```

---

### Task 8: Loans (records-import) backend — dismiss/delete

**Files:**
- Modify: `apps/api/src/loans/loans.records.import.service.ts`
- Modify: `apps/api/src/loans/loans.controller.ts`
- Test: `apps/api/src/loans/loans.records.import.service.spec.ts` (extend existing)

**Interfaces:**
- Consumes: `DismissFlaggedEntryDto` from Task 7 (same NestJS module, `apps/api/src/loans/dto/dismiss-flagged-entry.dto.ts`).
- Produces: `LoansRecordsImportService.dismissFlaggedEntry(batchId, index, actorId, actorName): Promise<LoanRecordsImportBatchDocument>`, `.deleteBatch(batchId, actorId, actorName): Promise<void>`.
- New routes: `PATCH /loans/records-import/:batchId/dismiss`, `DELETE /loans/records-import/:batchId`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/loans/loans.records.import.service.spec.ts` (after the existing `describe(...)` block's closing `});`):

```ts
describe('LoansRecordsImportService — dismiss/delete', () => {
  let service: LoansRecordsImportService;
  const mockFindById = jest.fn();
  const mockFindByIdAndDelete = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansRecordsImportService,
        {
          provide: getModelToken(LoanRecordsImportBatch.name),
          useValue: {
            create: mockCreate, findByIdAndUpdate: mockFindByIdAndUpdate,
            findById: mockFindById, findByIdAndDelete: mockFindByIdAndDelete,
          },
        },
        { provide: LoansService, useValue: mockLoansService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ImportProgressService, useValue: mockProgressService },
      ],
    }).compile();
    service = module.get(LoansRecordsImportService);
    jest.clearAllMocks();
  });

  it('dismissFlaggedEntry removes the entry at the given index and decrements the count', async () => {
    const batch: any = {
      _id: 'b1',
      status: 'Pending',
      flaggedRows: 2,
      flaggedEntries: [
        { rowNumber: 2, staffId: 'S1', guarantorId: 'S2', principalAmount: 1000, disbursedDate: '2026-01-01', reason: 'Staff ID not found' },
        { rowNumber: 3, staffId: 'S3', guarantorId: 'S4', principalAmount: 2000, disbursedDate: '2026-01-01', reason: 'Staff ID not found' },
      ],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    const result = await service.dismissFlaggedEntry('b1', 0, 'actor-1', 'Actor');

    expect(result.flaggedEntries).toHaveLength(1);
    expect(result.flaggedEntries[0].staffId).toBe('S3');
    expect(result.flaggedRows).toBe(1);
    expect(batch.save).toHaveBeenCalled();
  });

  it('dismissFlaggedEntry throws BadRequestException on an out-of-range index', async () => {
    const batch: any = { _id: 'b1', flaggedRows: 1, flaggedEntries: [{ rowNumber: 2, staffId: 'S1', guarantorId: 'S2', principalAmount: 1, disbursedDate: '', reason: 'x' }], save: jest.fn() };
    mockFindById.mockReturnValue({ exec: jest.fn().mockResolvedValue(batch) });

    await expect(service.dismissFlaggedEntry('b1', 5, 'actor-1', 'Actor')).rejects.toThrow('Flagged entry index 5 out of range');
  });

  it('deleteBatch deletes and throws NotFoundException when missing', async () => {
    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'b1' }) });
    await expect(service.deleteBatch('b1', 'actor-1', 'Actor')).resolves.toBeUndefined();

    mockFindByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteBatch('missing', 'actor-1', 'Actor')).rejects.toThrow('Import batch missing not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest loans/loans.records.import.service.spec.ts`
Expected: FAIL — `dismissFlaggedEntry`/`deleteBatch` don't exist on `LoansRecordsImportService`.

- [ ] **Step 3: Implement**

`apps/api/src/loans/loans.records.import.service.ts` — add the two new methods at the end of the class (`BadRequestException`, `AuditAction`, `AuditEntity` already imported):

```ts
  async dismissFlaggedEntry(
    batchId: string, index: number, actorId: string, actorName: string,
  ): Promise<LoanRecordsImportBatchDocument> {
    const batch = await this.getBatch(batchId);
    if (index < 0 || index >= batch.flaggedEntries.length) {
      throw new BadRequestException(`Flagged entry index ${index} out of range`);
    }
    batch.flaggedEntries.splice(index, 1);
    batch.flaggedRows -= 1;
    batch.status = batch.flaggedEntries.length === 0 ? ImportBatchStatus.Completed : ImportBatchStatus.Pending;
    await batch.save();
    this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, batchId);
    return batch;
  }

  async deleteBatch(batchId: string, actorId: string, actorName: string): Promise<void> {
    const result = await this.batchModel.findByIdAndDelete(batchId).exec();
    if (!result) throw new NotFoundException(`Import batch ${batchId} not found`);
    this.auditService.log(actorId, actorName, AuditAction.Delete, AuditEntity.Loan, batchId);
  }
```

`apps/api/src/loans/loans.controller.ts` — add routes after `getLoanRecordsImportBatch` (before `@Delete('bulk')`):

```ts
  @Patch('records-import/:batchId/dismiss')
  @RequirePermission(AppModule.Loans, 'full')
  dismissLoanRecordsFlaggedEntry(
    @Param('batchId') batchId: string,
    @Body() dto: DismissFlaggedEntryDto,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    return this.recordsImportService.dismissFlaggedEntry(batchId, dto.index, user.sub, user.displayName);
  }

  @Delete('records-import/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(AppModule.Loans, 'full')
  async deleteLoanRecordsImportBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() user: { sub: string; displayName: string },
  ) {
    await this.recordsImportService.deleteBatch(batchId, user.sub, user.displayName);
  }
```

(`DismissFlaggedEntryDto` is already imported in this controller file from Task 7 — no new import statement needed, both handlers reuse the same DTO class.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest loans/loans.records.import.service.spec.ts`
Expected: PASS (all tests)

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors

Run the full API suite as a checkpoint before moving to frontend work:
Run: `cd apps/api && npx jest`
Expected: all suites pass

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/loans/loans.records.import.service.ts apps/api/src/loans/loans.records.import.service.spec.ts apps/api/src/loans/loans.controller.ts
git commit -m "feat(api): add dismiss/delete for loan records import batches"
```

---

### Task 9: Staff frontend — Dismiss + Delete

**Files:**
- Modify: `apps/web/src/lib/staff.ts`
- Modify: `apps/web/src/app/(dashboard)/staff/import/import-client.tsx`

**Interfaces:**
- Consumes: Task 5's `PATCH /staff/import/:batchId/dismiss`, `DELETE /staff/import/:batchId`; Task 2's `<ConfirmModal>`.
- Produces: `dismissStaffFlaggedEntry(batchId, index): Promise<IStaffImportBatch>`, `deleteStaffImportBatch(batchId): Promise<void>`.

- [ ] **Step 1: Add the lib functions**

`apps/web/src/lib/staff.ts` — add after `getStaffImportBatch` (before `bulkDeleteStaff`):

```ts
export async function dismissStaffFlaggedEntry(batchId: string, index: number): Promise<IStaffImportBatch> {
  const { data } = await apiClient.patch(`/staff/import/${batchId}/dismiss`, { index });
  return data;
}

export async function deleteStaffImportBatch(batchId: string): Promise<void> {
  await apiClient.delete(`/staff/import/${batchId}`);
}
```

- [ ] **Step 2: Wire Dismiss + Delete into the client**

`apps/web/src/app/(dashboard)/staff/import/import-client.tsx` — add imports:

```ts
import { importStaff, listStaffImportBatches, dismissStaffFlaggedEntry, deleteStaffImportBatch } from '@/lib/staff';
import { ConfirmModal } from '@/components/ui/confirm-modal';
```

(replace the existing `import { importStaff, listStaffImportBatches } from '@/lib/staff';` line with the one above)

Add a `deleteTarget` state (after `const [jobId, setJobId] = useState<string | null>(null);`):

```ts
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);
```

Add two mutations after the existing `progress` line:

```ts
  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissStaffFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['staff-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteStaffImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['staff-import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });
```

Add a Dismiss button column to the flagged-entries table — replace the `['Row', 'Staff ID', 'Full Name', 'Reason']` header array and the row mapping:

```tsx
                    {['Row', 'Staff ID', 'Full Name', 'Reason', ''].map((h) => (
```

and the row body (replace the existing `<tr key={entry.rowNumber} ...>...</tr>` inside the flagged-entries `tbody`):

```tsx
                  {activeBatch.flaggedEntries.map((entry, index) => (
                    <tr key={entry.rowNumber} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-400 text-xs">{entry.rowNumber}</td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">
                        {entry.staffId || '—'}
                      </td>
                      <td className="px-4 py-2 text-neutral-700">{entry.fullName || '—'}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.reason}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => dismissMutation.mutate(index)}
                          disabled={dismissMutation.isPending}
                          className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                        >
                          Dismiss
                        </button>
                      </td>
                    </tr>
                  ))}
```

Add a Delete button to the Import History row actions — replace the History table's action `<td>` (the one with `{batch.flaggedRows > 0 && (...View Flagged...)}`):

```tsx
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flaggedRows > 0 && (
                            <button
                              onClick={() => setActiveBatch(batch)}
                              className="text-primary-600 hover:underline text-xs font-medium"
                            >
                              View Flagged
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ batchId: batch._id, fileName: batch.fileName })}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
```

Add the confirm modal right before the closing `</div>` of the component's returned JSX:

```tsx
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this import?"
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Staff already created from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check**

Import a staff file with a bad row, open the flagged table, click Dismiss — confirm the row disappears and the count updates. Click Delete on any Import History row, confirm the modal, confirm the row disappears.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/staff.ts "apps/web/src/app/(dashboard)/staff/import/import-client.tsx"
git commit -m "feat(web): dismiss/delete flagged staff import entries and batches"
```

---

### Task 10: Contributions frontend — Dismiss + Delete

**Files:**
- Modify: `apps/web/src/lib/contributions.ts`
- Modify: `apps/web/src/app/(dashboard)/contributions/import/import-client.tsx`

**Interfaces:**
- Consumes: Task 6's `PATCH /contributions/import/:batchId/dismiss`, `DELETE /contributions/import/:batchId`; Task 2's `<ConfirmModal>`.
- Produces: `dismissContributionFlaggedEntry(batchId, index): Promise<IImportBatch>`, `deleteContributionImportBatch(batchId): Promise<void>`.

- [ ] **Step 1: Add the lib functions**

`apps/web/src/lib/contributions.ts` — add after `resolveContributionsByStaffId` (before `deleteContribution`):

```ts
export async function dismissContributionFlaggedEntry(batchId: string, index: number): Promise<IImportBatch> {
  const { data } = await apiClient.patch(`/contributions/import/${batchId}/dismiss`, { index });
  return data;
}

export async function deleteContributionImportBatch(batchId: string): Promise<void> {
  await apiClient.delete(`/contributions/import/${batchId}`);
}
```

- [ ] **Step 2: Wire Dismiss + Delete into the client**

`apps/web/src/app/(dashboard)/contributions/import/import-client.tsx` — replace the lib import line:

```ts
import { importContributions, listImportBatches, resolveFlaggedEntry, resolveContributionsByStaffId, dismissContributionFlaggedEntry, deleteContributionImportBatch } from '@/lib/contributions';
```

Add the `ConfirmModal` import (next to the existing `import { Modal } from '@/components/ui/modal';`):

```ts
import { ConfirmModal } from '@/components/ui/confirm-modal';
```

Add a `deleteTarget` state (next to `const [staffOptions, ...] = useState...`):

```ts
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);
```

Add two mutations after the `bulkResolveMutation` block:

```ts
  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissContributionFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteContributionImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });
```

Add a Dismiss action to the per-batch flagged-entries row (the one with the "Map to Staff" button) — replace that `<td>`:

```tsx
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <button onClick={() => setResolveTarget(entry.staffId)} className="text-primary-600 hover:underline text-xs font-medium">
                            Map to Staff
                          </button>
                          <button
                            onClick={() => dismissMutation.mutate(activeBatch!.flaggedEntries.indexOf(entry))}
                            disabled={dismissMutation.isPending}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
```

Add Delete to the Import History row — replace the History table's action `<td>`:

```tsx
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flaggedRows > 0 && (
                            <button onClick={() => setActiveBatch(batch)} className="text-primary-600 hover:underline text-xs font-medium">
                              Resolve
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ batchId: batch._id, fileName: batch.fileName })}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
```

Add the confirm modal before the component's closing `</div>`:

```tsx
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this import?"
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Contributions already recorded from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check**

Same manual pass as Task 9, on the Contributions import page — also confirm "Map to Staff" still works unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/contributions.ts "apps/web/src/app/(dashboard)/contributions/import/import-client.tsx"
git commit -m "feat(web): dismiss/delete flagged contribution import entries and batches"
```

---

### Task 11: Loans (repayment) frontend — Dismiss + Delete

**Files:**
- Modify: `apps/web/src/lib/loans.ts`
- Modify: `apps/web/src/app/(dashboard)/loans/import/import-client.tsx`

**Interfaces:**
- Consumes: Task 7's `PATCH /loans/import/:batchId/dismiss`, `DELETE /loans/import/:batchId`; Task 2's `<ConfirmModal>`.
- Produces: `dismissLoanFlaggedEntry(batchId, index): Promise<ILoanRepaymentImportBatch>`, `deleteLoanImportBatch(batchId): Promise<void>`.

- [ ] **Step 1: Add the lib functions**

`apps/web/src/lib/loans.ts` — add after `resolveLoanByStaffId` (before `export interface LoanRecordsImportResult`):

```ts
export async function dismissLoanFlaggedEntry(batchId: string, index: number): Promise<ILoanRepaymentImportBatch> {
  const { data } = await apiClient.patch(`/loans/import/${batchId}/dismiss`, { index });
  return data;
}

export async function deleteLoanImportBatch(batchId: string): Promise<void> {
  await apiClient.delete(`/loans/import/${batchId}`);
}
```

- [ ] **Step 2: Wire Dismiss + Delete into the client**

`apps/web/src/app/(dashboard)/loans/import/import-client.tsx` — replace the lib import block:

```ts
import {
  importLoanRepayments,
  listLoanImportBatches,
  resolveLoanFlaggedEntry,
  resolveLoanByStaffId,
  dismissLoanFlaggedEntry,
  deleteLoanImportBatch,
  listLoans,
} from '@/lib/loans';
```

Add the `ConfirmModal` import:

```ts
import { ConfirmModal } from '@/components/ui/confirm-modal';
```

Add a `deleteTarget` state (next to `const [jobId, setJobId] = useState<string | null>(null);`):

```ts
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);
```

Add two mutations after the `bulkResolveMutation` block:

```ts
  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissLoanFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['loan-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteLoanImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['loan-import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });
```

Add a Dismiss action to the per-batch flagged-entries row (the one with the "Resolve" button) — replace that `<td>`:

```tsx
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setResolveState({ batchId: activeBatch._id, rowNumber: entry.rowNumber, amount: entry.amount, paidDate: entry.paidDate })}
                            className="text-primary-600 hover:underline text-xs font-medium"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => dismissMutation.mutate(activeBatch!.flaggedEntries.indexOf(entry))}
                            disabled={dismissMutation.isPending}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
```

Add Delete to the Import History row:

```tsx
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flaggedRows > 0 && (
                            <button
                              onClick={() => setActiveBatch(batch)}
                              className="text-primary-600 hover:underline text-xs font-medium"
                            >
                              Resolve
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ batchId: batch._id, fileName: batch.fileName })}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
```

Add the confirm modal before the component's closing `</div>`:

```tsx
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this import?"
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Repayments already recorded from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check**

Same manual pass as Task 9, on the Loans repayment import page.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/loans.ts "apps/web/src/app/(dashboard)/loans/import/import-client.tsx"
git commit -m "feat(web): dismiss/delete flagged loan repayment import entries and batches"
```

---

### Task 12: Loans (records-import) frontend — Dismiss + Delete

**Files:**
- Modify: `apps/web/src/lib/loans.ts`
- Modify: `apps/web/src/app/(dashboard)/loans/records-import/import-client.tsx`

**Interfaces:**
- Consumes: Task 8's `PATCH /loans/records-import/:batchId/dismiss`, `DELETE /loans/records-import/:batchId`; Task 2's `<ConfirmModal>`.
- Produces: `dismissLoanRecordsFlaggedEntry(batchId, index): Promise<ILoanRecordsImportBatch>`, `deleteLoanRecordsImportBatch(batchId): Promise<void>`.

- [ ] **Step 1: Add the lib functions**

`apps/web/src/lib/loans.ts` — add after `getLoanRecordsImportBatch` (before `export async function deleteLoan`):

```ts
export async function dismissLoanRecordsFlaggedEntry(batchId: string, index: number): Promise<ILoanRecordsImportBatch> {
  const { data } = await apiClient.patch(`/loans/records-import/${batchId}/dismiss`, { index });
  return data;
}

export async function deleteLoanRecordsImportBatch(batchId: string): Promise<void> {
  await apiClient.delete(`/loans/records-import/${batchId}`);
}
```

- [ ] **Step 2: Wire Dismiss + Delete into the client**

`apps/web/src/app/(dashboard)/loans/records-import/import-client.tsx` — replace the lib import line:

```ts
import { importLoanRecords, listLoanRecordsImportBatches, dismissLoanRecordsFlaggedEntry, deleteLoanRecordsImportBatch } from '@/lib/loans';
```

Add the `ConfirmModal` import:

```ts
import { ConfirmModal } from '@/components/ui/confirm-modal';
```

Add a `deleteTarget` state (next to `const [jobId, setJobId] = useState<string | null>(null);`):

```ts
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);
```

Add two mutations after the `progress` line:

```ts
  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissLoanRecordsFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['loan-records-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteLoanRecordsImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['loan-records-import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });
```

Add a Dismiss column to the flagged-entries table — replace the header array:

```tsx
                    {['Row', 'Staff ID', 'Guarantor ID', 'Amount', 'Disbursed', 'Reason', ''].map((h) => (
```

and the row body:

```tsx
                  {activeBatch.flaggedEntries.map((entry, index) => (
                    <tr key={entry.rowNumber} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-400 text-xs">{entry.rowNumber}</td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.staffId || '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-neutral-600">{entry.guarantorId || '—'}</td>
                      <td className="px-4 py-2 font-mono tabular">{fmtGHS(Number(entry.principalAmount))}</td>
                      <td className="px-4 py-2 text-xs">{entry.disbursedDate ? fmtDate(entry.disbursedDate) : '—'}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.reason}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => dismissMutation.mutate(index)}
                          disabled={dismissMutation.isPending}
                          className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                        >
                          Dismiss
                        </button>
                      </td>
                    </tr>
                  ))}
```

Add Delete to the Import History row:

```tsx
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flaggedRows > 0 && (
                            <button
                              onClick={() => setActiveBatch(batch)}
                              className="text-primary-600 hover:underline text-xs font-medium"
                            >
                              View Flagged
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ batchId: batch._id, fileName: batch.fileName })}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
```

Add the confirm modal before the component's closing `</div>`:

```tsx
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this import?"
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Loans already created from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check**

Same manual pass as Task 9, on the Loan Records import page.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/loans.ts "apps/web/src/app/(dashboard)/loans/records-import/import-client.tsx"
git commit -m "feat(web): dismiss/delete flagged loan records import entries and batches"
```

---

### Task 13: Investments frontend — new Import History UI + Dismiss/Delete

**Files:**
- Modify: `apps/web/src/lib/investments.ts`
- Create: `apps/web/src/app/(dashboard)/investments/import/import-history.tsx`
- Modify: `apps/web/src/app/(dashboard)/investments/import/import-client.tsx`

**Interfaces:**
- Consumes: Task 1's `IInvestmentImportBatch`; Task 3's `GET /investments/import`, `GET /investments/import/:batchId`, `PATCH .../dismiss`, `DELETE .../:batchId`; Task 2's `<ConfirmModal>`.
- Produces: `listInvestmentImportBatches(page?, limit?)`, `getInvestmentImportBatch(batchId)`, `dismissInvestmentFlaggedEntry(batchId, index)`, `deleteInvestmentImportBatch(batchId)`; a new `<ImportHistory>` component rendered by `InvestmentsImportClient`.

- [ ] **Step 1: Add the lib functions**

`apps/web/src/lib/investments.ts` — add imports and functions (replace the top `import` line and add at the end of the file):

```ts
import { apiClient } from './api-client';
import type { IInvestmentRow, IInvestmentImportBatch, PaginatedResult } from '@welfare/shared';
```

```ts
export async function listInvestmentImportBatches(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<IInvestmentImportBatch>> {
  const { data } = await apiClient.get('/investments/import', { params: { page, limit } });
  return data;
}

export async function getInvestmentImportBatch(batchId: string): Promise<IInvestmentImportBatch> {
  const { data } = await apiClient.get(`/investments/import/${batchId}`);
  return data;
}

export async function dismissInvestmentFlaggedEntry(batchId: string, index: number): Promise<IInvestmentImportBatch> {
  const { data } = await apiClient.patch(`/investments/import/${batchId}/dismiss`, { index });
  return data;
}

export async function deleteInvestmentImportBatch(batchId: string): Promise<void> {
  await apiClient.delete(`/investments/import/${batchId}`);
}
```

- [ ] **Step 2: Build the Import History component**

```tsx
// apps/web/src/app/(dashboard)/investments/import/import-history.tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IInvestmentImportBatch } from '@welfare/shared';
import {
  listInvestmentImportBatches,
  dismissInvestmentFlaggedEntry,
  deleteInvestmentImportBatch,
} from '@/lib/investments';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { fmtDate } from '@/lib/format';

export function ImportHistory() {
  const qc = useQueryClient();
  const [activeBatch, setActiveBatch] = useState<IInvestmentImportBatch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);

  const { data: batchHistory } = useQuery({
    queryKey: ['investment-import-batches'],
    queryFn: () => listInvestmentImportBatches(),
  });

  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissInvestmentFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['investment-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteInvestmentImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['investment-import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });

  return (
    <>
      {activeBatch && activeBatch.flaggedRows.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries" subtitle={`${activeBatch.flaggedRows.length} rows could not be imported`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Row', 'Description', 'Reason', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedRows.map((entry, index) => (
                    <tr key={entry.rowNumber} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-400 text-xs">{entry.rowNumber}</td>
                      <td className="px-4 py-2 text-neutral-700">{entry.description || '—'}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.flagReason}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => dismissMutation.mutate(index)}
                          disabled={dismissMutation.isPending}
                          className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                        >
                          Dismiss
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

      <Card>
        <CardHeader title="Import History" />
        <CardBody noPadding>
          {!batchHistory?.data.length ? (
            <p className="px-5 py-4 text-sm text-neutral-400">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['File', 'Date', 'Imported', 'Flagged', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">{batch.fileName}</td>
                      <td className="px-4 py-2 text-neutral-500 text-xs font-mono">{fmtDate(batch.createdAt)}</td>
                      <td className="px-4 py-2 text-success-700 font-medium">{batch.imported}</td>
                      <td className="px-4 py-2 text-warning-700 font-medium">{batch.flagged}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flagged > 0 && (
                            <button
                              onClick={() => setActiveBatch(batch)}
                              className="text-primary-600 hover:underline text-xs font-medium"
                            >
                              View Flagged
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ batchId: batch._id, fileName: batch.fileName })}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Delete
                          </button>
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

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this import?"
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Investments already created from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
```

- [ ] **Step 3: Render it from the import client and refresh history after a new upload**

`apps/web/src/app/(dashboard)/investments/import/import-client.tsx` — add the import:

```ts
import { ImportHistory } from './import-history';
import { useQueryClient } from '@tanstack/react-query';
```

Add `const qc = useQueryClient();` inside the component (after `const router = useRouter();`), and invalidate the history query on successful import (add to the existing `onSuccess` callback of `mutation`):

```ts
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['investment-import-batches'] });
      if (data.flagged === 0) toast.success(`${data.imported} investments imported`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
```

Render `<ImportHistory />` after the existing result card, right before the component's closing `</div>`:

```tsx
      <ImportHistory />
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual check**

Go to Investments → Import, upload a file with at least one bad row, confirm the new "Import History" table now appears below the result card, "View Flagged" opens the flagged table, Dismiss removes a row, Delete removes the whole batch after confirming.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/investments.ts "apps/web/src/app/(dashboard)/investments/import/import-history.tsx" "apps/web/src/app/(dashboard)/investments/import/import-client.tsx"
git commit -m "feat(web): add Import History with dismiss/delete for investments"
```

---

### Task 14: Remittances frontend — new Import History UI + Dismiss/Delete

**Files:**
- Modify: `apps/web/src/lib/remittances.ts`
- Create: `apps/web/src/app/(dashboard)/remittances/import/import-history.tsx`
- Modify: `apps/web/src/app/(dashboard)/remittances/import/import-client.tsx`

**Interfaces:**
- Consumes: Task 1's `IRemittanceImportBatch`; Task 4's `GET /remittances/import`, `GET /remittances/import/:batchId`, `PATCH .../dismiss`, `DELETE .../:batchId`; Task 2's `<ConfirmModal>`.
- Produces: `listRemittanceImportBatches(page?, limit?)`, `getRemittanceImportBatch(batchId)`, `dismissRemittanceFlaggedEntry(batchId, index)`, `deleteRemittanceImportBatch(batchId)`; a new `<ImportHistory>` component rendered by `RemittancesImportClient`.

- [ ] **Step 1: Add the lib functions**

`apps/web/src/lib/remittances.ts` — replace the top import line:

```ts
import { apiClient } from './api-client';
import type { IRemittanceReport, IRemittanceImportBatch, PaginatedResult } from '@welfare/shared';
```

Add functions at the end of the file:

```ts
export async function listRemittanceImportBatches(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<IRemittanceImportBatch>> {
  const { data } = await apiClient.get('/remittances/import', { params: { page, limit } });
  return data;
}

export async function getRemittanceImportBatch(batchId: string): Promise<IRemittanceImportBatch> {
  const { data } = await apiClient.get(`/remittances/import/${batchId}`);
  return data;
}

export async function dismissRemittanceFlaggedEntry(batchId: string, index: number): Promise<IRemittanceImportBatch> {
  const { data } = await apiClient.patch(`/remittances/import/${batchId}/dismiss`, { index });
  return data;
}

export async function deleteRemittanceImportBatch(batchId: string): Promise<void> {
  await apiClient.delete(`/remittances/import/${batchId}`);
}
```

- [ ] **Step 2: Build the Import History component**

```tsx
// apps/web/src/app/(dashboard)/remittances/import/import-history.tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IRemittanceImportBatch } from '@welfare/shared';
import {
  listRemittanceImportBatches,
  dismissRemittanceFlaggedEntry,
  deleteRemittanceImportBatch,
} from '@/lib/remittances';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { fmtDate } from '@/lib/format';

export function ImportHistory() {
  const qc = useQueryClient();
  const [activeBatch, setActiveBatch] = useState<IRemittanceImportBatch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ batchId: string; fileName: string } | null>(null);

  const { data: batchHistory } = useQuery({
    queryKey: ['remittance-import-batches'],
    queryFn: () => listRemittanceImportBatches(),
  });

  const dismissMutation = useMutation({
    mutationFn: (index: number) => dismissRemittanceFlaggedEntry(activeBatch!._id, index),
    onSuccess: (updated) => {
      setActiveBatch(updated);
      qc.invalidateQueries({ queryKey: ['remittance-import-batches'] });
      toast.success('Entry dismissed');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Dismiss failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => deleteRemittanceImportBatch(batchId),
    onSuccess: () => {
      setDeleteTarget(null);
      if (activeBatch && deleteTarget?.batchId === activeBatch._id) setActiveBatch(null);
      qc.invalidateQueries({ queryKey: ['remittance-import-batches'] });
      toast.success('Import deleted');
    },
    onError: (err: unknown) => {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed');
    },
  });

  return (
    <>
      {activeBatch && activeBatch.flaggedRows.length > 0 && (
        <Card className="border-warning-300">
          <CardHeader title="Flagged Entries" subtitle={`${activeBatch.flaggedRows.length} rows could not be imported`} />
          <CardBody noPadding>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['Row', 'Period', 'Reason', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {activeBatch.flaggedRows.map((entry, index) => (
                    <tr key={entry.rowNumber} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-400 text-xs">{entry.rowNumber}</td>
                      <td className="px-4 py-2 text-neutral-700">{entry.month || '—'}/{entry.year || '—'}</td>
                      <td className="px-4 py-2 text-xs text-danger-600">{entry.flagReason}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => dismissMutation.mutate(index)}
                          disabled={dismissMutation.isPending}
                          className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                        >
                          Dismiss
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

      <Card>
        <CardHeader title="Import History" />
        <CardBody noPadding>
          {!batchHistory?.data.length ? (
            <p className="px-5 py-4 text-sm text-neutral-400">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    {['File', 'Date', 'Imported', 'Flagged', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {batchHistory.data.map((batch) => (
                    <tr key={batch._id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-700 truncate max-w-xs">{batch.fileName}</td>
                      <td className="px-4 py-2 text-neutral-500 text-xs font-mono">{fmtDate(batch.createdAt)}</td>
                      <td className="px-4 py-2 text-success-700 font-medium">{batch.imported}</td>
                      <td className="px-4 py-2 text-warning-700 font-medium">{batch.flagged}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {batch.flagged > 0 && (
                            <button
                              onClick={() => setActiveBatch(batch)}
                              className="text-primary-600 hover:underline text-xs font-medium"
                            >
                              View Flagged
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ batchId: batch._id, fileName: batch.fileName })}
                            className="text-neutral-500 hover:text-danger-600 hover:underline text-xs font-medium"
                          >
                            Delete
                          </button>
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

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete this import?"
        body={`This permanently removes "${deleteTarget?.fileName}" from Import History, including its flagged entries. Remittances already created from this import are not affected.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget!.batchId)}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
```

- [ ] **Step 3: Render it from the import client and refresh history after a new upload**

`apps/web/src/app/(dashboard)/remittances/import/import-client.tsx` — add imports:

```ts
import { ImportHistory } from './import-history';
import { useQueryClient } from '@tanstack/react-query';
```

Add `const qc = useQueryClient();` inside the component (after `const router = useRouter();`), and invalidate the history query on successful import:

```ts
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['remittance-import-batches'] });
      if (data.flagged === 0) toast.success(`${data.imported} remittances imported successfully`);
      else toast.warning(`${data.imported} imported, ${data.flagged} flagged`);
    },
```

Render `<ImportHistory />` right before the component's closing `</div>`:

```tsx
      <ImportHistory />
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual check**

Go to Remittances → Import, upload a file with at least one bad/duplicate row, confirm "Import History" appears, "View Flagged" opens the flagged table, Dismiss/Delete both work.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/remittances.ts "apps/web/src/app/(dashboard)/remittances/import/import-history.tsx" "apps/web/src/app/(dashboard)/remittances/import/import-client.tsx"
git commit -m "feat(web): add Import History with dismiss/delete for remittances"
```

---

## Final Verification

After Task 14, before finishing the branch:

Run: `cd apps/api && npx jest`
Expected: all suites pass (this repo's baseline was 180 tests across 28 suites before this plan; expect roughly +5 dismiss/delete tests per module × 6 modules, plus Task 3/4's extra list/get tests).

Run: `cd apps/api && npm run build`
Expected: exits 0 (NestJS compiles cleanly)

Run: `cd packages/shared && npm run build && cd ../../apps/web && npm run build`
Expected: exits 0 (production Next.js build compiles cleanly with the new shared types)

## Self-Review Notes

**Spec coverage:** Backend uniform pattern (§Backend) → Tasks 3–8. New investments/remittances list/get routes (§Backend table) → Tasks 3–4. Frontend shared button pattern (§Frontend) → Tasks 9–12. New Import History UI for investments/remittances (§Frontend) → Tasks 13–14. Confirm-before-delete UI requirement → Task 2 + every frontend task's Step 2/3. Error handling (400 on out-of-range index, 404 on missing batch) → every backend task's tests.

**Placeholder scan:** no TBD/TODO; every step has runnable code or an exact command.

**Type consistency:** `dismissFlaggedEntry(batchId, index, actorId, actorName)` and `deleteBatch(batchId, actorId, actorName)` signatures are identical across all 6 services (Tasks 3–8). `DismissFlaggedEntryDto { index }` / `DismissFlaggedRowDto { index }` (named per the module's own `flaggedEntries`/`flaggedRows` field terminology) are both `{ index: number }` at the wire level, matching what every frontend `dismiss*FlaggedEntry(batchId, index)` function sends. Every new `ConfirmModal` usage (Tasks 9–14) passes the same four props (`open`, `title`, `body`, `onConfirm`, `onClose`, `isPending`, `confirmLabel`) defined in Task 2.
