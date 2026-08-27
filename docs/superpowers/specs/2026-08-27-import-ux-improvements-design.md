# Import UX Improvements — Design

## Problem

Three pain points reported using the Excel import flows (staff, contributions,
loans, loan-records, investments, remittances):

1. Large imports give no feedback while processing — the Import button just
   spins until the whole request completes.
2. Staff import preview shows "Date of Employment" as a raw XLSX serial
   number instead of a formatted date.
3. When a contribution/loan-repayment import flags rows because the staff
   record didn't exist yet, resolving those flags is one-batch-at-a-time and
   one-entry-at-a-time. If the same staff was missing from 12 months of
   contribution files (12 separate batches), the user must repeat the same
   staff search and click 12 times after creating the staff record.

## Scope

- Progress bar: all 6 import flows (staff, contributions, loans-repayment,
  loans-records-import, investments, remittances).
- Date of Employment preview fix: staff import only (also fixes Date of
  Birth's underlying value, which is masked so the bug is invisible but the
  same wrong value feeds the mask).
- Bulk "resolve by Staff ID" across all pending batches: contributions and
  loans-repayment only. Staff-import flags are row validation errors (there
  is nothing to "map"). Loan-records-import has no resolve endpoint at all
  today. Investments/remittances flag on unrelated keys (description /
  month-year, not staffId). Extending resolve to those is out of scope.

Out of scope: retrying/resuming a failed import mid-way, cancelling an
in-flight import, changing how any import matches/validates rows, WebSocket
or SSE push (polling is sufficient at this scale and this codebase has no
existing SSE/streaming infra to build on).

## 1. Progress bar

### Why polling with a client-generated job id

Every `processImport` today is one synchronous HTTP request: the controller
awaits the full row loop before responding, so there's no batch id to poll
until it's already done. Splitting into two HTTP round trips (create-batch,
then process) would work but touches every controller's contract. Instead,
the frontend generates the id up front and the backend is told to use it:

- Frontend generates a 24-hex-char Mongo-ObjectId-shaped string (`new
  Types.ObjectId()`-compatible) via a small `genJobId()` helper
  (`apps/web/src/lib/job-id.ts`, uses `crypto.getRandomValues`).
- FormData includes `jobId` alongside `file`.
- Each `processImport` accepts an optional `jobId` param; when creating the
  batch doc, passes `{ _id: new Types.ObjectId(jobId) }` if provided,
  otherwise lets Mongo generate one as today (keeps the signature
  backward-compatible for any caller that omits it).

### `ImportProgressService` (new, `apps/api/src/common/import-progress.service.ts`)

In-memory, single responsibility, no persistence:

```ts
@Injectable()
export class ImportProgressService {
  private readonly progress = new Map<string, { processed: number; total: number; done: boolean; updatedAt: number }>();

  start(jobId: string, total: number): void
  increment(jobId: string, by = 1): void
  complete(jobId: string): void
  get(jobId: string): { processed: number; total: number; done: boolean } | null
}
```

- `start` seeds the map entry. `increment` bumps `processed`. `complete` sets
  `done: true` (frontend stops polling on `done`).
- A `setInterval` sweep (every 60s) deletes entries older than 5 minutes
  (via `updatedAt`) so the map can't grow unbounded across many imports —
  this is the only cleanup mechanism needed since imports are synchronous
  and finish within the request lifetime; entries just need to survive long
  enough for the frontend's last poll after completion.
- Registered in a small `ImportProgressModule`, exported so the 6 import
  modules can inject it, plus its own controller.

### Endpoint

`GET /import-progress/:jobId` (new `ImportProgressController`, same
`JwtAuthGuard` as everything else — no extra permission check needed, a
jobId is an unguessable random id and only exposes a row count). Returns
`{ processed, total, done }` or 404 if unknown/expired (frontend treats 404
as "not started yet, keep polling" during the brief window before the
mutation's request has reached the server).

### Wiring into the 6 services

Each `processImport` gets three call sites added around its existing loop —
no change to matching/validation logic:

```ts
const batch = await this.batchModel.create({ _id: objectIdFrom(jobId), ...  });
this.progressService.start(batch._id.toString(), rows.length);
for (const row of rows) {
  // ...existing per-row logic...
  this.progressService.increment(batch._id.toString());
}
this.progressService.complete(batch._id.toString());
```

Wrapped so `complete()` still fires on a thrown error (try/finally) —
otherwise a failed import would leave the frontend polling forever until the
5-minute sweep.

### Frontend

New shared hook `apps/web/src/hooks/use-import-progress.ts`:

```ts
function useImportProgress(jobId: string | null): { processed: number; total: number; done: boolean } | null
```

Polls `GET /import-progress/:jobId` every 500ms via `setInterval` while
`jobId` is set and not `done`; stops on `done` or on unmount. Each of the 6
`import-client.tsx` files: generate `jobId` in `handleFileChange` (or right
before `importMutation.mutate()`), pass it through the existing
`import*(file, ...)` lib functions (new optional trailing param appended to
FormData), call `useImportProgress(pending ? jobId : null)`, render a
progress bar (`processed`/`total`) next to the existing Import button while
`importMutation.isPending`.

## 2. Date of Employment preview fix

`apps/web/src/app/(dashboard)/staff/import/import-client.tsx` currently does
`dateOfEmployment: String(r['Date of Employment'] ?? '')` — for a
date-formatted Excel cell, `sheet_to_json` returns a numeric serial, so this
stringifies e.g. `45678` instead of a date.

Fix: new `apps/web/src/lib/excel-date.ts`, a client-side mirror of the
existing server-only `apps/api/src/common/utils/excel-date.util.ts`
(`normalizeExcelDate`, using `XLSX.SSF.parse_date_code` — same `xlsx`
package is already a web dependency). Not extracted to `@welfare/shared`
because it depends on the `xlsx` package which the shared package doesn't
currently depend on, and duplicating ~15 lines is simpler than adding that
dependency edge.

In `handleFileChange`, apply `normalizeExcelDate()` to both
`row['Date of Employment']` and `row['Date of Birth']` before storing in
`PreviewRow` (both are raw cell values today, DOB's bug is just hidden by
`maskDate`). Render `dateOfEmployment` with the existing `fmtDate()` from
`@/lib/format` instead of the raw string. `maskDate` keeps working on DOB's
now-correct ISO string.

## 3. Bulk "resolve by Staff ID" across batches

### Backend

New method on both `ImportService` (contributions) and `LoansImportService`:

```ts
// contributions
async resolveByStaffId(originalStaffId: string, resolvedStaffMongoId: string, actorId: string, actorName: string):
  Promise<{ resolvedCount: number; batchesUpdated: number }>
```

Finds all batches with `status: { $ne: Completed }` where
`flaggedEntries.staffId === originalStaffId`, and for each one runs the same
per-entry resolution the existing `resolveFlagged` does (process payment,
splice entry, update counts/status, save) in a loop, accumulating counts.
Reuses the existing single-entry resolution logic by extracting it into a
private helper (`resolveOneEntry(batch, entryIndex, resolvedId, actorId,
actorName)`) called from both the existing per-batch `resolveFlagged` and
the new `resolveByStaffId`, so there's one code path for "what resolving an
entry does."

Loans version is the same shape but takes `resolvedLoanId` instead of
`resolvedStaffMongoId` (loan repayments resolve to a specific loan, not just
a staff — matches the existing per-entry loan resolve behavior).

### Endpoints

- `PATCH /contributions/import/resolve-by-staff-id` — body
  `{ originalStaffId, resolvedStaffMongoId }`.
- `PATCH /loans/import/resolve-by-staff-id` — body
  `{ originalStaffId, resolvedLoanId }`.

Both audit-log once per call (`AuditAction.Update`, `AuditEntity.ImportBatch`,
entity id = the staffId string, detail includes `resolvedCount`/
`batchesUpdated`) rather than once per batch, matching the "one user action"
granularity of every other bulk action in this codebase (`bulkDeleteX`).

### Frontend: aggregate flagged-entries view

Today's flagged-entries table only shows `activeBatch`'s entries (one batch
picked from Import History). Add a new always-visible section above the
history table, "Flagged Entries (All Pending Imports)":

- New query fetching all pending batches' flagged entries, flattened and
  grouped by `staffId`: reuses `listImportBatches` (already paginated, but
  only Pending/Resolved-status batches have flags — filter client-side for
  now, matching the existing pattern of that page not paginating for its
  own supplementary views) and flattens `flaggedEntries` client-side into
  `{ staffId, employeeName, occurrences: number, batchIds: string[] }[]`
  grouped via a `Map`.
- Table columns: Staff ID, Employee Name, Occurrences (e.g. "3 imports"),
  Action → "Map to Staff" opens the existing resolve modal, unchanged UI,
  but its confirm handler calls the new `resolveByStaffId` mutation instead
  of the per-batch `resolveFlaggedEntry`. On success, invalidate both
  `['import-batches']` and `['contribution-flagged-entries']` (new key) so
  the aggregate table and history counts refresh together.
- Existing per-batch "Resolve" flow (`activeBatch` view opened from Import
  History) stays as-is for users who prefer to resolve within one batch —
  the aggregate view is additive, not a replacement.
- Loans import client gets the equivalent aggregate section, calling
  `resolveByStaffId` with the loan-picker step unchanged (still searches
  staff, still lists that staff's active loans, but the chosen loan now
  applies to every matching flagged entry across batches).

## Data model changes

None — `ImportBatch`/`LoanRepaymentImportBatch` schemas are unchanged.
`ImportProgressService`'s map is in-memory only, not persisted (acceptable:
progress is inherently ephemeral, and losing it on an API restart mid-import
just means the frontend's progress bar stalls until the import's own
response arrives, no data loss).

## Error handling

- Progress endpoint 404 (unknown/expired jobId): frontend keeps polling
  silently rather than surfacing an error — this is the expected state in
  the brief window before the import request reaches the server, and after
  the 5-minute sweep for a long-abandoned poll (which shouldn't happen since
  polling stops on `done` or mutation settle).
- `resolveByStaffId` with a staffId matching zero flagged entries: returns
  `{ resolvedCount: 0, batchesUpdated: 0 }` rather than throwing — the
  aggregate view only offers staffIds that currently have flags, but a
  concurrent resolve from another user/tab makes zero a valid legitimate
  outcome, not an error.
- Existing per-entry resolve error handling (staff not found, etc.) is
  unchanged.

## Testing

- `ImportProgressService` unit tests: start/increment/get sequence, `done`
  after `complete`, sweep removes entries past TTL.
- `ImportService.resolveByStaffId` / `LoansImportService.resolveByStaffId`
  unit tests: resolves across multiple batches, skips
  `Completed`-status batches, correctly recomputes each batch's
  `status`/counts, returns accurate `resolvedCount`/`batchesUpdated`, and
  the shared `resolveOneEntry` helper still passes the existing
  single-entry resolve tests unchanged.
- Manual UI pass per import type: upload a large file, confirm the
  progress bar advances and completes; staff import preview shows a real
  date; create a staff record after several contribution imports flagged
  it, use "Map to Staff" from the aggregate view, confirm all matching
  batches resolve in one action and Import History reflects updated
  counts/status.
