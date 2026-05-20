# Welfare Management Design System Implementation

**Date:** 2026-05-20  
**Branch:** main  
**Stack:** Next.js 14, Tailwind CSS 3, Recharts 2, lucide-react (to install), no shadcn/ui

---

## 1. Scope

All 10 screens implemented with the Welfare Management Design System tokens. Live API data is preserved; only the visual layer changes.

Screens in scope:
- Dashboard
- Staff list + Staff detail
- Loans list + Loan detail + New loan form
- Contributions (import)
- Reports
- Settings
- Audit log (no specific design mock — follow general patterns)
- Email log (no specific design mock — follow general patterns)

---

## 2. Approach: Option C — Tailwind config extension + design-system CSS layer

### 2.1 Why hybrid

The design system has tokens that Tailwind cannot natively model:
- Four discrete elevation levels (box-shadow values)
- Motion tokens (duration + easing)
- Density row heights (36px / 48px / 56px)

Tailwind handles colors, fonts, spacing, and radius. A thin `design-system.css` handles the rest.

### 2.2 New dependencies

```
lucide-react   — icon library (required by spec)
clsx           — conditional class merging
tailwind-merge — Tailwind class conflict resolution
```

No shadcn/ui.

---

## 3. Foundation layer

### 3.1 Fonts

Copy from handoff bundle to `apps/web/public/fonts/`:
- Nunito: Regular (400), Medium (500), SemiBold (600), Bold (700), ExtraBold (800), Black (900) + italics
- JetBrains Mono: Regular (400), Medium (500), SemiBold (600), Bold (700)

### 3.2 `apps/web/src/styles/design-system.css`

New file. Contents:
1. `@font-face` declarations for Nunito and JetBrains Mono (paths: `/fonts/Nunito-*.ttf`, `/fonts/JetBrainsMono-*.ttf`)
2. `:root` block with semantic CSS custom properties:
   - Surface: `--surface-sunken: #F7F9FC`, `--surface: #FFFFFF`, `--surface-overlay: #FFFFFF`, `--surface-inverse: #101928`
   - Borders: `--border-subtle: #F0F2F5`, `--border-default: #E4E7EC`, `--border-strong: #D0D5DD`
   - Text: `--text-primary: #101928`, `--text-secondary: #475367`, `--text-tertiary: #98A2B3`, `--text-inverse: #FFFFFF`, `--text-link: #720026`
   - Elevation: `--shadow-flat: none`, `--shadow-raised: 0 1px 2px 0 rgba(16,24,40,0.06)`, `--shadow-floating: 0 4px 8px -2px rgba(16,24,40,0.08), 0 2px 4px -2px rgba(16,24,40,0.04)`, `--shadow-modal: 0 20px 32px -8px rgba(16,24,40,0.16), 0 8px 16px -4px rgba(16,24,40,0.08)`
   - Motion: `--motion-hover: 100ms ease-out`, `--motion-modal-in: 200ms ease-out`, `--motion-modal-out: 100ms ease-in`, `--motion-sidebar: 300ms ease-in-out`, `--motion-toast: 200ms`
   - Density: `--row-compact: 36px`, `--row-default: 48px`, `--row-relaxed: 56px`
   - Icon sizes: `--icon-xs: 12px`, `--icon-sm: 16px`, `--icon-md: 20px`, `--icon-lg: 24px`, `--icon-xl: 32px`
   - Chart palette: `--chart-1: #720026` (contributions), `--chart-2: #B7791F` (loan active), `--chart-3: #0F973D` (completed), `--chart-4: #CB1A14` (defaulted/bad debt), `--chart-5: #7C3AED` (aux purple), `--chart-6: #0E9384` (aux teal), `--chart-7: #98A2B3` (baseline), `--chart-8: #344054` (hero series)
   - Z-index stack: sidebar 200, topbar 300, dropdown 400, modal 500, toast 600

Imported in `apps/web/src/app/globals.css` before Tailwind directives.

### 3.3 `tailwind.config.js` extensions

```js
theme: {
  extend: {
    colors: {
      primary:  { 50:'#FBE9EE', 100:'#F5C7D2', 200:'#EBA0B3', 300:'#D26285', 400:'#A41E48', 500:'#720026', 600:'#5C001E', 700:'#470017', 800:'#330010', 900:'#1F0009' },
      accent:   { 50:'#FEF6E7', 100:'#FCE5B6', 200:'#F9D285', 300:'#F6BB52', 400:'#E8A332', 500:'#B7791F', 600:'#92611A', 700:'#6D4A14' },
      neutral:  { 0:'#FFFFFF', 25:'#FCFCFD', 50:'#F9FAFB', 75:'#F7F9FC', 100:'#F0F2F5', 200:'#E4E7EC', 300:'#D0D5DD', 400:'#98A2B3', 500:'#667085', 600:'#475367', 700:'#344054', 800:'#1D2739', 900:'#101928', 950:'#0A101D' },
      success:  { 50:'#E7F6EC', 100:'#BAEDC7', 300:'#40B869', 500:'#0F973D', 700:'#036B26', 900:'#014A18' },
      warning:  { 50:'#FEF6E7', 100:'#FBE2B6', 300:'#F7C164', 500:'#D69E2E', 700:'#8B5A00', 900:'#523300' },
      danger:   { 50:'#FBEAE9', 100:'#F2BCB7', 300:'#E26E6A', 500:'#CB1A14', 700:'#9E0A07', 900:'#591000' },
      info:     { 50:'#E3EFFC', 100:'#B7D4F8', 300:'#5EA0E8', 500:'#1671D9', 700:'#0E4F9C', 900:'#052561' },
    },
    fontFamily: {
      sans: ['Nunito', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
    },
    borderRadius: {
      xs: '4px', sm: '6px', md: '8px',
    },
    fontSize: {
      '2xs': ['10px', '14px'],
      xs:  ['11px', '16px'],
      sm:  ['12px', '16px'],
      base:['13px', '18px'],
      md:  ['14px', '20px'],
      lg:  ['16px', '24px'],
      xl:  ['18px', '26px'],
      '2xl':['20px', '28px'],
      kpi: ['28px', '34px'],
    },
    minWidth: { '1280': '1280px' },
  }
}
```

### 3.4 `src/lib/utils.ts`

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

### 3.5 Format helpers (`src/lib/format.ts`)

```ts
export function fmtGHS(n: number | null | undefined): string
// → '₵12,450.00' (cedi symbol + comma thousands + 2 decimals, tabular-nums via CSS)
// Negative: '−₵1,200.00' (minus sign, not dash)

export function fmtDate(d: string | Date | null | undefined): string
// → '20/05/2026' (DD/MM/YYYY per user preference)

export function fmtTime(d: string | Date | null | undefined, withSeconds = false): string
// → '14:32' or '14:32:05' (HH:mm or HH:mm:ss per user preference)

export function fmtDateTime(d: string | Date | null | undefined): string
// → '20/05/2026 14:32'
```

---

## 4. Shared primitive components (`src/components/ui/`)

### 4.1 Button (`button.tsx`)

Props: `variant: 'primary'|'secondary'|'ghost'|'danger'`, `size: 'sm'|'md'|'lg'`, `icon?: string`, `iconRight?: string`, `loading?: boolean`, `disabled?: boolean`, `destructive?: boolean`, standard button attrs.

Visual rules:
- Primary: `bg-primary-500 text-white`, hover `bg-primary-600`
- Secondary: `bg-white border border-neutral-200 text-neutral-700`, hover `bg-neutral-50`
- Ghost: no border/bg, `text-neutral-600`, hover `bg-neutral-100`
- Danger: `bg-danger-500 text-white`. Destructive buttons: **no hover transition** (friction is deliberate per spec)
- All non-destructive: `transition-colors` at `var(--motion-hover)`
- Radius: `rounded-sm` (6px). No shadow. No translate on press.
- Icon: Lucide component, 16px (`--icon-sm`), `stroke-width={1.75}`

### 4.2 Badge / StatusBadge (`badge.tsx`)

Props: `kind: 'success'|'warning'|'danger'|'info'|'neutral'|'accent'|'baddebt'|'neutral-dark'`, `dot?: boolean`

Radius: `rounded-xs` (4px). Always shows dot + label (never color alone).

Status → kind map:
```
Active → success,  Resigned → neutral,  Retired → info,  Dismissed → danger,  Deceased → neutral-dark
Loan-Active → info,  Completed → success,  Defaulted → danger,  Bad debt → baddebt,  Written off → neutral
Pending → neutral,  Paid → success,  Partial → warning,  Overdue → danger,  Waived → info
Missed → danger,  Carried forward → accent,  Sent → success,  Failed → danger,  Bounced → warning
```

### 4.3 Avatar (`avatar.tsx`)

Circular, 1px `border-neutral-200` ring. Initials (max 2 letters) on colored bg from 5-palette rotation (primary-50, accent-50, success-50, info-50, danger-50). Sizes: `sm: 28px`, `md: 36px`, `lg: 48px`.

### 4.4 Card (`card.tsx`)

`bg-white border border-neutral-200 rounded-md`. No shadow by default. `Card.Header` (title + optional subtitle + optional action slot). `Card.Body` with padding.

### 4.5 KpiCard (`kpi-card.tsx`)

Extends Card. Relaxed density. Icon (24px, `--icon-lg`) top-right in `text-neutral-400`. Value in `text-kpi font-semibold font-mono tabular-nums`. Trend: `↑` or `↓` unicode with success/danger coloring. Sub-label below trend.

### 4.6 Input / Select / Field (`input.tsx`)

- `Field`: wraps label + input/select + helper/error text. Label sentence case, required `*` in danger-500.
- `Input`: 48px default height (`--row-default`), `rounded-sm`, `border-neutral-200`, focus `border-primary-500 ring-2 ring-primary-100`. Prefix/suffix slots. Mono prop for `font-mono`. Error state: `border-danger-500`.
- `Select`: same container, native `<select>`, chevron-down icon.

### 4.7 Modal (`modal.tsx`)

- Scrim: `bg-neutral-900/60` fixed overlay
- Modal: `bg-white rounded-md` with `var(--shadow-modal)`, max-width `sm:480px | md:640px | lg:800px`
- Entry animation: 200ms fade + 4px Y translate. Exit: 100ms.
- Header: optional icon in colored circle (info/warning/danger kinds). Title + body.
- Footer: right-aligned button group.
- Close X top-right.

### 4.8 Toast (`toast.tsx`)

Fully opaque white. Left border 4px in kind color. `var(--shadow-floating)`. Fixed to bottom-right. Stack of up to 5. Entry: 200ms slide-in from right. Auto-dismiss 5s. Icon + title + optional description + X dismiss.

### 4.9 DataTable (`data-table.tsx`)

Built on `@tanstack/react-table` (already installed). Features:
- Compact rows: `h-[var(--row-compact)]` (36px)
- Column headers: ALL-CAPS, `tracking-[0.04em]`, `text-2xs text-neutral-500`, `bg-neutral-50`, sticky with `var(--shadow-raised)`
- Row hover: `hover:bg-neutral-50` 
- Sortable: `chevron-up`/`chevron-down` Lucide icons in header
- Pagination: page numbers + prev/next
- Loading state: SkeletonLoader rows

### 4.10 EmptyState (`empty-state.tsx`)

Abstract SVG line illustration (single stroke, `text-neutral-400`) in `bg-neutral-50 rounded-[16px] w-[240px] h-[180px]`. Short factual heading (`text-lg font-semibold text-neutral-700`). One-sentence body (`text-sm text-neutral-500`). Optional CTA button.

### 4.11 SkeletonLoader (`skeleton.tsx`)

`bg-neutral-100` bars with shimmer gradient animation. 500ms loop, ease-in-out on gradient position.

### 4.12 RepaymentBar (`repayment-bar.tsx`)

Track `bg-neutral-100 rounded-full h-2`. Fill: `bg-success-500` (ok) / `bg-warning-500` (partial) / `bg-danger-500` (overdue). Label above (left: "Repayment progress", right: `₵paid of ₵total`). Percentage below.

---

## 5. Chrome components

### 5.1 Sidebar (`src/components/nav/sidebar.tsx`) — full rewrite

- Fixed left, `w-[220px]` expanded → `w-[56px]` collapsed
- Width transition: `transition-[width] duration-300 ease-in-out`
- `bg-white border-r border-neutral-200`
- Brand section: NCC logo (SVG crest from `public/assets/ncc-logo.png`) + "Welfare Department" title + "Narcotics Control Commission" subtitle. Collapsed: logo only.
- Toggle: small `w-6 h-6` circle button on right edge, `chevron-left` / `chevron-right`
- Section label: "OPERATIONS", `text-[10px] tracking-widest text-neutral-400 uppercase`
- Nav items: icon (20px, `--icon-md`) + label (hidden when collapsed). Active: `bg-primary-50 border-l-[3px] border-primary-500 text-primary-700`. Hover: `bg-primary-50/60`.
- Alert dot on Contributions item (amber)
- Footer: Settings + Sign out

Nav links:
```
/ → layout-dashboard → Dashboard
/staff → users → Staff
/contributions → wallet → Contributions (+ alert count badge)
/loans → banknote → Loans
/reports → bar-chart-2 → Reports
--- footer ---
/settings → settings → Settings
/logout → log-out → Sign out
```

### 5.2 Topbar (`src/components/nav/topbar.tsx`) — full rewrite

- Fixed top, `h-[60px]`, full content width, `bg-white`, `shadow-[var(--shadow-raised)]`
- Breadcrumb left: parent segments `text-neutral-400`, current `text-neutral-900 font-semibold`
- Search center: button styled as input, `bg-neutral-50 border border-neutral-200 rounded-sm px-3 py-2`, "Search staff, loans, or contributions" placeholder, `⌘K` kbd chip
- Right: bell with dot + Avatar (current user initials) + name + role + chevron-down dropdown trigger
- Keeps existing ⌘K → CommandPalette behavior

### 5.3 Layout shell (`src/app/(dashboard)/layout.tsx`)

```tsx
<div className="flex min-h-screen min-w-[1280px] bg-[var(--surface-sunken)] font-sans">
  <Sidebar />
  <div className="flex-1 flex flex-col overflow-hidden">
    <Topbar />
    <main className="flex-1 overflow-y-auto px-8 pt-6">{children}</main>
  </div>
</div>
```

---

## 6. Screen implementations

### 6.1 Dashboard

Layout: page heading area → KPI row (4 cards, `grid grid-cols-4 gap-4`) → 2-col charts row → attention table card → activity feed card.

KPI cards:
- Active loans (count, `banknote` icon, trend vs last month)
- Total disbursed (`₵` amount, `circle-dollar-sign` icon)
- Monthly contributions (`₵`, `wallet` icon)
- Overdue loans (count, `alert-circle` icon, danger coloring if > 0)

Charts (Recharts):
- Left: `LineChart` contributions over 12 months, `--chart-1` color (primary-500)
- Right: `PieChart`/`DonutChart` loans by status, `--chart-*` data-vis palette

Attention table: DataTable (compact) of top overdue loans — loan number, staff, days overdue, balance. No pagination (top 10 only).

Activity feed: Card with scrollable list of recent actions, timestamp in `fmtDateTime()`, icon per action type.

### 6.2 Staff list

Filter bar: search Input + Status Select + Station Select + Rank Select, right-aligned "Add staff" Button (primary).

DataTable columns: Avatar+Name, Staff ID (`font-mono`), Rank, Station, Status badge, Outstanding balance (`font-mono tabular-nums`).

Click row → `/staff/[id]`.

### 6.3 Staff detail

Profile header: large Avatar (48px) + name + Staff ID (mono) + rank + station + StatusBadge.

Two cards below: Loan history table (compact), Contribution history table (compact).

### 6.4 Loans list

Filter bar: search + Status + Date range. "New loan" Button top-right.

DataTable columns: Loan no. (mono), Staff name, Amount (`fmtGHS`), Disbursed date (`fmtDate`), Tenure, Status badge, RepaymentBar (narrow, 120px wide).

Click row → `/loans/[id]`.

### 6.5 Loan detail

Profile header: staff avatar + name + loan number (mono) + status badge.

RepaymentBar: full-width card.

Record payment panel (Card): amount Input (prefix `₵`), date Input, method Select, "Record payment" Button. Success → Toast "Payment recorded."

Full repayment schedule: DataTable — installment #, due date, amount, paid date, status badge.

Write-off modal (destructive): "Write off this loan?" title. Body states remaining balance + consequence. Footer: "Cancel" (secondary) + "Write off loan" (danger, **no transition**).

Settlement panel (shown if staff is inactive): separate Card with settlement amount calculation.

### 6.6 New loan form

2-col layout: left 60% form, right 40% sticky schedule preview.

Form fields: Staff (search/select), Loan amount (₵ prefix), Tenure (months), Disbursement date, Guarantor 1 + Guarantor 2.

Schedule preview: Card (sticky top-6), recalculates on amount/tenure change, shows monthly installment + total interest + full schedule table.

Submit: "Save loan" Button → Toast "Loan recorded." → redirect to loan detail.

### 6.7 Contributions (import)

Dropzone: large dashed-border area (`border-2 border-dashed border-neutral-200 rounded-md`). Drag-over state: `border-primary-300 bg-primary-50`. Icon `upload` (32px). Label + sub-label.

After import: import result Card (rows imported, flagged count, errors).

Flagged entries: DataTable with accept/reject action per row.

### 6.8 Reports

Left panel (`w-[240px]` fixed): grouped list of report types (Monthly / Quarterly / Operational). Selected item: `bg-primary-50 border-l-[3px] border-primary-500`.

Right panel: filter bar (station + date range) + 4 stat chips + bar chart (Recharts, stations × metric) + station detail DataTable + "Generate report" Button + "Export CSV" ghost Button.

### 6.9 Settings

Left section nav (`w-[220px]`): Loan defaults, Interest & fees, Approval workflow, Required documents, Automation, Danger zone.

Right: stacked form Cards per section. Each Card has a title, description, form fields, and a "Save changes" Button.

Danger zone Card: red border (`border-danger-200`), destructive action buttons with confirmation modals.

### 6.10 Audit log

DataTable: timestamp (`fmtDateTime`), actor, action, entity type, entity ID (mono), IP address. Filter bar: date range + actor + action type. No specific mock — follow DataTable patterns.

### 6.11 Email log

DataTable: sent at (`fmtDateTime`), recipient, subject, status badge (Sent/Failed/Bounced), delivery timestamp. Filter bar: date range + status. Follow same patterns.

---

## 7. Copy & content rules (non-negotiable)

- Sentence case everywhere except table column headers (ALL-CAPS) and sidebar section labels
- No emoji. No exclamation marks. No "we" / "you".
- Currency: `₵12,450.00` only. Never `GH₵` or `12,450 GHS`.
- Dates: `DD/MM/YYYY` (e.g. `20/05/2026`) — user preference overrides design spec's `12 Mar 2025`
- Times: `HH:mm` or `HH:mm:ss` (user preference)
- Status badges: always color + label, never color alone

---

## 8. Non-goals

- Mobile/responsive layouts — desktop-only (1280px min-width)
- shadcn/ui integration
- Any API changes
- Authentication flow changes
- New features beyond the design mocks
