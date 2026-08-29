# Claims Module — Design

Date: 2026-08-29

## Overview

New "Claims" module: staff can claim welfare benefits (Marriage, Birth, Funeral,
Cessation). Claim amounts reduce a staff member's available balance against
their total contributions. Two intake paths: (1) bulk legacy-data upload
(mirrors the contributions payroll-import pattern), (2) manual create going
forward via a form with an approval workflow. Reports (contribution
statement, fund summary) are updated to surface claims.

Mirrors the existing `contributions` module's architecture throughout —
schema conventions, import/flagging pattern, permission gating, report
rendering — so this doc calls out contributions' precedent at each step
rather than re-deriving conventions from scratch.

## Data model

### Enums (`packages/shared/src/enums/`)

- `claim-type.enum.ts` — `ClaimType { Marriage, Birth, Funeral, Cessation }`
- `cessation-reason.enum.ts` — `CessationReason { Resignation, Termination, Death }`
- `claim-status.enum.ts` — `ClaimStatus { Pending, Approved, Rejected }`
- `claim-source.enum.ts` — `ClaimSource { LegacyImport, ManualEntry }`
- `app-module.enum.ts` — add `Claims = 'claims'` value; wire into `PERMISSIONS` matrix
  (`packages/shared/src/constants/permissions.ts`) with `readonly`/`full` tiers,
  same shape as `Contributions`.

### Schemas (`apps/api/src/claims/schemas/`)

`claim.schema.ts`:
```
Claim {
  staffId: string          // Mongo _id of Staff, same FK convention as Contribution.staffId
  claimType: ClaimType
  subReason?: CessationReason   // only meaningful when claimType === Cessation
  month: number             // 1-12
  year: number               // >= 2000
  amount: number
  status: ClaimStatus
  source: ClaimSource
  importBatchId?: string
  approvedBy?: string
  approvedAt?: Date
  rejectedReason?: string
  recordedBy: string
  timestamps: true
}
```
Indexes: `{staffId}`, `{status}`, `{year, claimType}`.

`claim-import-batch.schema.ts` — same shape as `import-batch.schema.ts` in
contributions (`FlaggedEntry {staffId, employeeName, amount, reason}`,
`ImportBatch {fileName, uploadedBy, totalRows, matchedRows, flaggedRows,
flaggedEntries[], status: ImportBatchStatus}`), separate `claim_import_batches`
collection.

### Balance calculation

`availableBalance(staffId) = totalPaidContributions(staffId) − sum(amount of Approved claims for staffId)`

Only `Approved` claims count. `Pending`/`Rejected` claims never affect
balance or any report totals. This is a derived, report-time calculation —
no ledger/debit rows are written against the `Contribution` collection.

## Backend module (`apps/api/src/claims/`)

Mirrors `apps/api/src/contributions/` file layout:

- `claims.module.ts` — imports `StaffModule`, `ContributionsModule` (for
  balance lookups), `MulterModule.register({})`; registers `Claim` and
  `ClaimImportBatch` schemas; exports `ClaimsService`.
- `claims.service.ts`
  - `createClaim(dto)` — hard-blocks (`BadRequestException`) if
    `dto.amount > availableBalance(dto.staffId)`; saves `status: Pending`,
    `source: ManualEntry`.
  - `approveClaim(id, approverId)` — re-checks balance at approval time
    (balance may have drifted since submission); if now insufficient,
    reject the approve action with `BadRequestException`. On success sets
    `status: Approved, approvedBy, approvedAt`.
  - `rejectClaim(id, reason)` — sets `status: Rejected, rejectedReason`.
  - `getStaffBalance(staffId)`, `getStaffClaims(staffId)`,
    `listClaims(query)` (paginated, filters: status, claimType, year, staffId).
  - `deleteClaim(id)`.
- `import.service.ts` — same shape as contributions' `import.service.ts`:
  - Parses uploaded `.xlsx`/`.xls` via `xlsx`, expects columns `Staff ID`,
    `Full Name`, `Claim Type`, `Month`, `Year`, `Amount`, optional
    `Sub Reason` (required only when `Claim Type` = Cessation).
  - `Full Name` column is informational only — not validated or stored;
    canonical name always comes from `staff.fullName` at read time. Row
    matching uses `staffId` alone via `staffService.findByStaffId`.
  - Flagging (pushed to `flaggedEntries`, row not persisted), same reasons
    pattern as contributions: `Missing Staff ID`, `Staff ID not found`,
    `Invalid or missing Claim Type`, `Invalid or missing Month/Year`,
    `Missing Sub Reason for Cessation claim`.
  - Matched rows are saved directly as `status: Approved, source:
    LegacyImport` — no approval gate on historical data, mirroring
    contributions' payroll import needing no review step. No hard balance
    block on import (historical fact must land regardless), but if a row
    would push a staff member's balance negative, flag it as a soft
    warning (`reason: "Exceeds staff balance — review"`) — the row still
    imports, flag is for admin visibility only, resolved/dismissed the
    same way as other flagged entries.
  - Reuses `ImportProgressService` for real-time progress via client
    `jobId`, and `AuditService` logging on flagged-entry resolve/dismiss.
  - Batch status: `Pending` while flagged rows remain, `Completed` once
    zero flagged rows or all cleared — same as contributions.
- `claims.controller.ts` — routes, all `@RequirePermission(AppModule.Claims,
  'readonly'|'full')`:
  - `POST /claims/import`, `GET /claims/import`, `GET /claims/import/:batchId`
  - `PATCH /claims/import/:batchId/resolve`, `PATCH
    /claims/import/resolve-by-staff-id`, `PATCH
    /claims/import/:batchId/dismiss`, `PATCH
    /claims/import/:batchId/clear-flagged`
  - `POST /claims` (manual create, 'full')
  - `PATCH /claims/:id/approve`, `PATCH /claims/:id/reject` ('full')
  - `GET /claims` (paginated list), `GET /claims/staff/:staffId`, `GET
    /claims/staff/:staffId/balance`
  - `DELETE /claims/:id` ('full')

### Shared DTOs (`packages/shared/src/dto/`)

- `claim.dto.ts` — `CreateClaimDto`, `ClaimResponseDto`, `ApproveClaimDto`,
  `RejectClaimDto` (response-shape interfaces, mirrors `contribution.dto.ts`).
- `claim-import-batch.dto.ts` — mirrors `import-batch.dto.ts`.
- API-local `class-validator` DTOs live in `apps/api/src/claims/dto/`
  (`create-claim.dto.ts`, `claim-query.dto.ts`, `resolve-flagged.dto.ts`,
  etc.) — same split as contributions.

## Reports integration

### Contribution statement (`getStaffContributionStatement` + PDF + web view)

- New query: fetch staff's `Approved` claims grouped by year:
  `claimRows: [{ year, claims: [{ claimType, amount }] }]`.
- New table rendered below the existing year×month crosstab, in both the
  Puppeteer PDF HTML template (`reports.service.ts`) and the React JSX view
  (`StaffStatementPanel`):
  - Columns: `Year | Claim Type | Amount`.
  - One row per claim; when a year has multiple claims, the `Year` cell
    uses `rowspan` (native `<td rowspan={n}>` in both PDF HTML and JSX)
    spanning that year's claim rows instead of repeating.
  - Footer row: `Total Welfare Claims` = sum across all years.
- Statement KPIs gain `totalClaims`; existing KPI strip gains
  `netContribution = totalPaid − totalClaims`.

### Fund summary (`getFundSummary`)

- `IFundSummaryReport` gains `claims: { totalAmount, count, byType: Record<ClaimType, number> }`.
- New collapsible "Welfare Claims Breakdown" section in
  `fund-summary-panel.tsx` (by type, by year), same CSV/PDF sub-route
  pattern as the existing Contributions/Loans Breakdown blocks
  (`GET /reports/fund-summary/claims?format=csv|pdf`).

### New claims report page

- New sidebar section in `ReportsClient` ("Claims") — a claims-list panel
  reusing `ReportTable`, filters (staff, type, year, status), and a
  per-staff claim-history view (mirrors the loan-statement
  borrower→instalment cascading pattern).

### Balance visibility

- `availableBalance` surfaced in: staff statement KPI strip, the manual
  claim-create form (live balance next to amount field).

## Frontend (`apps/web/src/app/(dashboard)/claims/`)

Mirrors `contributions/` page structure:

- `page.tsx` + `claims-list-client.tsx` — paginated list (TanStack Table,
  server pagination), filters (staffId, claimType, status, year),
  approve/reject row actions gated on `usePermission(AppModule.Claims) ===
  'full'`, `Badge` for status, `ConfirmModal` for reject (reason required).
- `import/import-client.tsx` — drag-drop upload, client-side `.xlsx`
  preview table, month/year override inputs, `useImportProgress(jobId)`
  progress bar, post-import flagged-entries table with "Map to Staff"
  (searchable staff picker) / "Dismiss", cross-batch flagged-entry
  resolution, import history table — identical UX to contributions import.
- `create/create-client.tsx` — manual claim form: staff picker
  (`searchStaff`), claim-type select, conditional sub-reason select
  (visible only when type = Cessation), month/year, amount, live balance
  display, submit → Pending.
- `lib/claims.ts` — axios API client wrapper (mirrors `lib/contributions.ts`).
- Nav: add "Claims" entry to sidebar; `AppModule.Claims` wired into
  `use-permission.ts` consumers.

## Error handling

- Balance hard-block: `BadRequestException` — `"Claim amount exceeds
  available balance of GHS {balance}"` — raised at both `createClaim` and
  `approveClaim`.
- Import flagging: never throws — invalid/unmatched/over-balance rows are
  collected into `flaggedEntries` on the batch and surfaced for manual
  resolution, matching contributions' import UX exactly.
- Reject requires a `rejectedReason` (validated non-empty).

## Testing

- `claims.service.spec.ts` — balance calculation, create/approve/reject
  transitions, hard-block at create and re-check at approve.
- `import.service.spec.ts` — column parsing, staffId matching, flagging
  reasons (missing/invalid columns, staff not found, missing sub-reason,
  over-balance soft-flag), batch status transitions.
- `claims.controller` e2e — route permission gating (`readonly` vs `full`),
  import upload round-trip.
- `reports.service.spec.ts` additions — statement claims table/rowspan
  grouping logic, fund-summary claims aggregate shape.

## Scope notes / explicitly deferred

- No ledger/ledger-reversal entries against `Contribution` — claims are a
  derived deduction, computed at read time only.
- No email notifications on claim approve/reject in this phase (contrast
  with loan-schedule emails) — can follow the existing `EmailModule`
  pattern later if needed.
- No bulk-send/export job for claims in this phase.
