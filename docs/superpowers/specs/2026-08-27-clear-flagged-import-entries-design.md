# Clear Flagged Import Entries — Design

## Problem

Once an Excel import flags a row (bad data, staff not found, duplicate
period, etc.) there is no way to get rid of it short of resolving it to a
real staff/loan/record. If the underlying issue was actually a mistake in
the source file — wrong staff ID typo'd twice, a duplicate upload, a test
import — the flagged entry (and the whole batch) sits in Import History
forever with no way to clear it.

Two clearing mechanisms are needed:
- **Dismiss** a single flagged row — drops it from the batch's flagged
  list without creating any downstream record. Nothing was salvageable in
  that row; the user just wants it gone.
- **Delete** an entire import batch — removes the batch record (and
  whatever flagged entries it has) from history entirely. For a botched
  or duplicate upload the user wants wiped out completely.

## Scope

All 6 import flows: staff, contributions, loans (repayment), loans
(records-import), investments, remittances.

Investments and remittances currently have **no** Import History UI at
all — `apps/web/src/app/(dashboard)/investments/import/import-client.tsx`
and the remittances equivalent only show a one-time toast + result card
right after upload, with no persisted batch list and no backend routes
beyond `POST .../import` (confirmed: their controllers have no `GET`
list/detail routes today). Building that history view (mirroring the
existing loan-records-import pattern, which also has no resolve step) is
part of this work — without it, Delete/Dismiss have nowhere to live for
those two.

Out of scope: undoing a batch's already-*matched* rows. Deleting a batch
only removes the tracking record — any contribution/loan/investment/
remittance already created from that import's successful rows stays
exactly as it is. A batch is metadata about an import run, not the
source of truth for the records it created.

## Backend

### Uniform pattern, keyed by array index

Every flagged-entries array (`flaggedEntries` on staff/contributions/
loans/loan-records, `flaggedRows` on investments/remittances) is keyed
differently per module today — `staffId` for contributions,
`rowNumber` for the rest — and none of those keys are guaranteed unique
within a batch (two rows can fail with the same missing Staff ID, or the
same invalid month/year). Array **index** is always unique and correct
regardless of shape, so both new operations are index-based:

```ts
// added to each of the 6 *ImportService classes
async dismissFlaggedEntry(
  batchId: string, index: number, actorId: string, actorName: string,
): Promise<BatchDocument> {
  const batch = await this.getBatch(batchId); // throws NotFoundException if missing
  if (index < 0 || index >= batch.flaggedEntries.length) {
    throw new BadRequestException(`Flagged entry index ${index} out of range`);
  }
  batch.flaggedEntries.splice(index, 1);
  batch.flaggedRows -= 1; // or `batch.flagged -= 1` for investments/remittances
  // staff/contributions/loans/loan-records only — investments/remittances have no status field:
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

Both methods follow the exact shape of each service's existing
`getBatch`/`resolveFlagged` (error types, audit-log call signature). For
loans-repayment, `resolveFlagged`'s existing convention of setting
`status = Resolved` (not `Completed`) when `flaggedRows` reaches 0 is
preserved for consistency with that service's current behavior.

Investments and remittances services don't inject `AuditService` today —
it's a `@Global()` module (`apps/api/src/audit/audit.module.ts`), so
adding it to their constructors needs no module-import change, just the
constructor param.

### New/extended endpoints per module

| Module | Dismiss | Delete | List (new) | Get one (new) |
|---|---|---|---|---|
| staff | `PATCH /staff/import/:batchId/dismiss` | `DELETE /staff/import/:batchId` | exists | exists |
| contributions | `PATCH /contributions/import/:batchId/dismiss` | `DELETE /contributions/import/:batchId` | exists | exists |
| loans (repayment) | `PATCH /loans/import/:batchId/dismiss` | `DELETE /loans/import/:batchId` | exists | exists |
| loans (records) | `PATCH /loans/records-import/:batchId/dismiss` | `DELETE /loans/records-import/:batchId` | exists | exists |
| investments | `PATCH /investments/import/:batchId/dismiss` | `DELETE /investments/import/:batchId` | **new** `GET /investments/import` | **new** `GET /investments/import/:batchId` |
| remittances | `PATCH /remittances/import/:batchId/dismiss` | `DELETE /remittances/import/:batchId` | **new** `GET /remittances/import` | **new** `GET /remittances/import/:batchId` |

All gated `@RequirePermission(AppModule.X, 'full')`, matching every other
mutating route in each controller. Dismiss body: `DismissFlaggedEntryDto
{ index: number }` (`@IsInt() @Min(0)`), one new DTO file per module
(4 new — staff/contributions/loans-repayment/loans-records reuse the same
shape but each module already keeps its own DTOs, so this follows the
existing per-module DTO convention rather than sharing one).

Investments/remittances `listBatches`/`getBatch` mirror the existing
pattern verbatim from `LoansRecordsImportService` (`find().sort({createdAt:-1}).skip().limit()` / `findById` +
`NotFoundException`).

## Frontend

### Shared button pattern (staff, contributions, loans×2)

Each flagged-entries table row gets a "Dismiss" button (alongside the
existing "Map to Staff"/"Resolve" where those exist, alone where they
don't — staff and loan-records have no resolve concept today, just a
reason column). Each Import History row gets a "Delete" button next to
the existing "Resolve"/"View Flagged" link, available on every batch
regardless of flagged count.

New lib functions per module (`dismissFlaggedEntry(batchId, index)` →
`PATCH .../dismiss`, `deleteImportBatch(batchId)` → `DELETE ...`), each
wired to a `useMutation` that invalidates the same query key the existing
import/resolve mutations already invalidate (`['import-batches']`,
`['staff-import-batches']`, etc.) — no new query keys needed.

Delete needs a confirmation step (irreversible, removes history) —
reuses the existing `Modal` component with a plain confirm dialog
(title "Delete this import?", body naming the file, Cancel/Delete
buttons), matching the confirm-modal pattern already used elsewhere in
this app (e.g. investments' delete-reason flow) rather than a bare
`window.confirm`.

### New: Import History for investments & remittances

Net-new section in both `import-client.tsx` files, structurally copied
from `LoanRecordsImportClient` (no resolve step, just a reason column):
a `useQuery` fetching `listInvestmentImportBatches()` /
`listRemittanceImportBatches()`, a history table (File / Date / Imported
/ Flagged / Actions: "View Flagged" + "Delete"), and a flagged-entries
card shown for the selected `activeBatch` (columns: Row, Description
or Month/Year, Reason, Dismiss). No status Badge — these two schemas
have no `status` field and adding one is out of scope (YAGNI); "flagged
> 0" is enough to decide whether "View Flagged" shows.

New shared types (matching the existing `ILoanRecordsImportBatch`
pattern): `IInvestmentFlaggedRow`/`IInvestmentImportBatch` and
`IRemittanceFlaggedRow`/`IRemittanceImportBatch` in
`packages/shared/src/interfaces/`, exported from the package barrel.

## Data model

No schema field changes — `flaggedEntries`/`flaggedRows` arrays and
counts already exist everywhere; dismiss/delete only read and mutate
what's there.

## Error handling

- Dismiss with an out-of-range index: `400 Bad Request` (the array
  changed under the user, e.g. two browser tabs) — frontend shows the
  error toast and refetches so the table reflects reality.
- Delete/dismiss on an already-deleted batch: `404 Not Found`, same
  toast-and-refetch handling.
- Delete requires confirmation in the UI; the backend performs it
  unconditionally once called (no soft-delete/undo — matches how the
  rest of this app's hard-deletes work, e.g. `bulkDeleteContributions`).

## Testing

- Backend unit tests per service (6×): `dismissFlaggedEntry` removes the
  right index, decrements the counter, recomputes status where
  applicable, 400s on out-of-range index; `deleteBatch` calls
  `findByIdAndDelete`, 404s when not found.
- Investments/remittances also get new `listBatches`/`getBatch` tests
  mirroring the existing `LoansRecordsImportService` test shape.
- Manual UI pass: dismiss one flagged row from a batch and confirm the
  count/table update; delete a batch and confirm it disappears from
  history; for investments/remittances specifically, confirm the new
  history view populates after an import and both actions work there.
