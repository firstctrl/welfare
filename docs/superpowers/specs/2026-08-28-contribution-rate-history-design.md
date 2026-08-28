# Contribution Rate History — Design Spec

## Problem

`MONTHLY_CONTRIBUTION_AMOUNT` is stored as a single flat value in
`ConfigSetting`. Every write that stamps a contribution's
`expectedAmount` — manual entry, live import, lump sum, and resolving a
flagged import entry — reads *today's* value regardless of which
month/year the contribution is for.

Once a contribution document exists, its `expectedAmount` is
snapshotted and stays correct forever. The bug only bites on writes for
**past** periods made **after** the rate has since changed: a flagged
entry from March resolved in August, or a late import for an old month,
gets judged against the current rate instead of the rate that applied
in March. A fully-paid month can end up wrongly marked Partial.

## Goal

Let admins define a rate schedule (amount + effective-from month/year)
instead of a single current value. Every write path resolves the rate
that applied to the *target* month/year, not "now".

## Data model

New collection `contribution_rates`, owned by the `contributions`
module:

```ts
@Schema({ timestamps: true, collection: 'contribution_rates' })
class ContributionRate {
  month!: number;        // 1–12
  year!: number;          // >= 2000
  amount!: number;        // > 0
  effectiveKey!: number;  // year * 12 + month, stored for indexed sort
  createdBy!: string;
}
```

- Unique index on `(year, month)` — one rate per period, no ambiguity.
- Index on `effectiveKey` descending — `getRateFor(month, year)` does
  `findOne({ effectiveKey: { $lte: targetKey } }).sort({ effectiveKey: -1 })`.
- No `updatedAt`/edit path — changing a rate means deleting the entry
  and adding a new one (keeps history unambiguous; no silent
  overwrite of what an entry "used to be").

## Service: `ContributionRatesService`

- `getRateFor(month, year): Promise<number>` — resolves the schedule
  entry, throws `BadRequestException` naming the missing period if
  none covers it (blocks the write, per the earlier decision — no
  silent fallback to the oldest or newest rate).
- `list(): Promise<ContributionRateDocument[]>` — sorted newest-first,
  for the Settings UI table.
- `create({ month, year, amount }, actorId, actorName)` — validates
  ranges, rejects a duplicate `(month, year)` with `ConflictException`
  ("a rate already exists for that period — delete it first to
  change it"), audit-logs the addition.
- `delete(id, actorId, actorName)` — refuses if it's the only
  remaining entry (`ConflictException` — the schedule can never go
  fully empty, since that would block every future write too), audit
  logs the removal.

## Migration (on module init)

`ContributionRatesService.onModuleInit()`: if `contribution_rates` is
empty, seed one entry:
- **Amount:** the current `MONTHLY_CONTRIBUTION_AMOUNT` config value if
  present, else `100` (matching `SystemConfigService`'s own seed
  default — avoids depending on module init order between the two
  services).
- **Effective-from:** the earliest `(month, year)` found across
  existing `contributions` documents; if none exist, the current
  month/year.
- `createdBy: 'system-migration'`.

This guarantees every historical contribution record and any
currently-flagged import entry is covered on day one — nothing that
already imports/resolves cleanly today starts throwing after this
ships. The old `ConfigSetting` document for
`MONTHLY_CONTRIBUTION_AMOUNT` is left in place, unused — no need to
clean it up.

## Wiring into `ContributionsService`

- `getExpectedAmount()` → `getExpectedAmount(month, year)`, delegating
  to `ContributionRatesService.getRateFor`. Drops the `configService`
  dependency for this value (still unused elsewhere in this file).
- `processPayment(staffId, month, year, ...)` — already has the target
  month/year in scope; passes them through. This is the single call
  site behind manual entry, live import rows, and flagged-entry
  resolve (`resolveOneEntry` in `contributions/import.service.ts`
  already calls `processPayment(..., batch.month, batch.year, ...)`)
  — no changes needed there beyond the signature change rippling
  through.
- `processLumpSum(...)` — the per-month backfill loop already tracks
  `current.month`/`current.year`; calls `getExpectedAmount(current.month, current.year)`
  inside the loop instead of once outside it, since the rate can
  legitimately change mid-backfill.

## Config cleanup

Remove `MonthlyContributionAmount` from:
- `packages/shared/src/enums/config-key.enum.ts`
- `SEED_DEFAULTS` in `system-config.service.ts`
- the `validateUpdates` switch in `system-config.service.ts`

## API routes (on `ContributionsController`)

Registered before the generic `:id` param routes, same convention
already used for `import`:

```
GET    /contributions/rates            readonly
POST   /contributions/rates            full
DELETE /contributions/rates/:id        full
```

Guarded with `AppModule.Settings` (not `AppModule.Contributions`) —
this is edited from the Settings page, matching how the existing
single-value Contributions section is gated today.

## Frontend

`settings-client.tsx`'s `ContributionsSection` changes from a single
dirty/save input to a small immediate-commit widget:
- Table: Month/Year, Amount, Added By, Date — sorted newest-first.
- Inline add row: month select, year number input, amount input, "Add"
  button — commits immediately via `createContributionRate`, no
  staged dirty state (matches how dismiss/clear already work
  elsewhere in this app).
- Per-row delete button with `ConfirmModal` (reuse the existing
  component), disabled when it's the only row (mirrors the backend
  guard, avoids a round-trip error for the obvious case).
- `lib/contributions.ts` gains `listContributionRates`,
  `createContributionRate`, `deleteContributionRate`.

## Error handling

- Blocked write (`getRateFor` throws): the existing error-toast plumbing
  in every import/manual-entry/resolve mutation already surfaces
  `err.response.data.message` — the `BadRequestException` message
  ("No contribution rate defined for 3/2024 — add one in Settings
  before importing or resolving this period.") shows as-is, no new
  UI needed.
- Duplicate period on create: `ConflictException` surfaces the same
  way, toast reads naturally.
- Delete-the-last-entry: blocked client-side (button disabled) and
  server-side (defense in depth).

## Testing

- `ContributionRatesService` unit tests: resolves the correct entry
  for a period inside range, for a period after the latest entry
  (uses latest), throws for a period before the earliest entry,
  rejects duplicate `(month, year)` on create, rejects deleting the
  sole remaining entry, migration seeds correctly (empty rates +
  config present, empty rates + no config → fallback 100, non-empty
  rates → migration skipped).
- `contributions.service.spec.ts`: update the existing mocks from a
  flat `configService.getAll()` stub to a `ContributionRatesService`
  mock; add a case proving `processPayment` for a past month with a
  since-changed rate uses the historical rate, not the current one;
  same for `processLumpSum`'s per-month lookup.
- `import.service.spec.ts` (contributions) — no changes expected;
  `resolveOneEntry` already passes `batch.month`/`batch.year` through
  unchanged, verify existing tests still pass.
- Frontend: no automated test runner in this repo for the web app
  (established convention) — verified via `tsc --noEmit` and a manual
  pass in the browser (add a rate, delete a rate, confirm the
  disabled-when-sole-entry state, confirm a blocked resolve shows the
  toast).
