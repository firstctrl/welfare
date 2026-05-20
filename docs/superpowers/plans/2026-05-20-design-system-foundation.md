# Design System Foundation & Components — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Welfare Management Design System tokens into the Next.js app and build all shared primitive components and chrome (sidebar, topbar, layout) so every screen can be rethemed in Plan 2.

**Architecture:** Option C — Tailwind config extension for colors/fonts/radius + a thin `design-system.css` for elevation, motion, density, and chart tokens. Shared components live in `src/components/ui/`. Chrome components are full rewrites of sidebar and topbar. No shadcn/ui.

**Tech Stack:** Next.js 14, Tailwind CSS 3 (TypeScript config), lucide-react (new), clsx + tailwind-merge (new), sonner (existing — restyled), @tanstack/react-table (existing), vitest (new — format.ts unit tests only).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/web/public/fonts/` | Nunito + JetBrains Mono TTF files |
| Create | `apps/web/public/assets/ncc-logo.png` | NCC crest logo |
| Create | `apps/web/src/styles/design-system.css` | Font faces, CSS custom properties (semantic tokens, elevation, motion, density, chart palette, z-index) |
| Modify | `apps/web/src/app/globals.css` | Import design-system.css; set base font + bg |
| Modify | `apps/web/tailwind.config.ts` | Extend with full color ramps, fonts, radius, fontSize |
| Create | `apps/web/src/lib/format.ts` | `fmtGHS`, `fmtDate`, `fmtTime`, `fmtDateTime` |
| Create | `apps/web/src/lib/format.test.ts` | Vitest unit tests for all format helpers |
| Create | `apps/web/src/lib/utils.ts` | `cn()` helper (clsx + tailwind-merge) |
| Rewrite | `apps/web/src/components/ui/button.tsx` | Brand Button component |
| Create | `apps/web/src/components/ui/badge.tsx` | Badge + StatusBadge |
| Create | `apps/web/src/components/ui/avatar.tsx` | Avatar with initials fallback |
| Create | `apps/web/src/components/ui/card.tsx` | Card + Card.Header + Card.Body |
| Create | `apps/web/src/components/ui/kpi-card.tsx` | KPI metric card |
| Create | `apps/web/src/components/ui/field.tsx` | Field + Input + Select form primitives |
| Create | `apps/web/src/components/ui/modal.tsx` | Modal with scrim + animation |
| Create | `apps/web/src/components/ui/repayment-bar.tsx` | Repayment progress bar |
| Rewrite | `apps/web/src/components/ui/skeleton.tsx` | Shimmer skeleton |
| Rewrite | `apps/web/src/components/ui/empty-state.tsx` | Empty state with SVG illustration |
| Create | `apps/web/src/components/ui/data-table.tsx` | DataTable wrapper on @tanstack/react-table |
| Rewrite | `apps/web/src/components/nav/sidebar.tsx` | Brand sidebar with collapse |
| Rewrite | `apps/web/src/components/nav/topbar.tsx` | Brand topbar with breadcrumb |
| Modify | `apps/web/src/app/(dashboard)/layout.tsx` | Apply shell layout tokens |
| Modify | `apps/web/src/app/layout.tsx` | Apply font-sans on body |

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install new npm packages**

```bash
cd apps/web
npm install lucide-react clsx tailwind-merge
npm install -D vitest
```

Expected output: packages added to `node_modules`, `package.json` updated.

- [ ] **Step 2: Verify installs**

```bash
node -e "require('lucide-react'); require('clsx'); require('tailwind-merge'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd ../..
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore: install lucide-react, clsx, tailwind-merge, vitest"
```

---

### Task 2: Copy font and asset files

**Files:**
- Create: `apps/web/public/fonts/` (18 Nunito TTF + 4 JetBrains Mono TTF)
- Create: `apps/web/public/assets/ncc-logo.png`

- [ ] **Step 1: Create public directories**

```bash
mkdir -p apps/web/public/fonts apps/web/public/assets
```

- [ ] **Step 2: Copy Nunito fonts**

```bash
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-Regular.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-Italic.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-Medium.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-MediumItalic.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-SemiBold.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-SemiBoldItalic.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-Bold.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-BoldItalic.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-ExtraBold.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-ExtraBoldItalic.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-Black.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/Nunito-BlackItalic.ttf apps/web/public/fonts/
```

- [ ] **Step 3: Copy JetBrains Mono fonts**

```bash
cp docs/design-handoff/welfare-management-design-system/project/fonts/JetBrainsMono-Regular.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/JetBrainsMono-Medium.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/JetBrainsMono-SemiBold.ttf apps/web/public/fonts/
cp docs/design-handoff/welfare-management-design-system/project/fonts/JetBrainsMono-Bold.ttf apps/web/public/fonts/
```

- [ ] **Step 4: Copy logo asset**

```bash
cp docs/design-handoff/welfare-management-design-system/project/assets/ncc-logo.png apps/web/public/assets/
```

- [ ] **Step 5: Verify files exist**

```bash
ls apps/web/public/fonts/ | wc -l
```

Expected: `16` (12 Nunito + 4 JetBrains Mono)

- [ ] **Step 6: Commit**

```bash
git add apps/web/public/
git commit -m "feat: add Nunito and JetBrains Mono brand fonts and NCC logo asset"
```

---

### Task 3: Design token CSS layer

**Files:**
- Create: `apps/web/src/styles/design-system.css`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Create `src/styles/` directory**

```bash
mkdir -p apps/web/src/styles
```

- [ ] **Step 2: Create `design-system.css`**

Create `apps/web/src/styles/design-system.css`:

```css
/* ============================================================
   WELFARE MANAGEMENT DESIGN SYSTEM — CSS custom properties
   Import this file first. All tokens live here.
   ============================================================ */

/* ---- Font faces ---- */
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-Regular.ttf") format("truetype"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-Italic.ttf") format("truetype"); font-weight: 400; font-style: italic; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-Medium.ttf") format("truetype"); font-weight: 500; font-style: normal; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-MediumItalic.ttf") format("truetype"); font-weight: 500; font-style: italic; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-SemiBold.ttf") format("truetype"); font-weight: 600; font-style: normal; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-SemiBoldItalic.ttf") format("truetype"); font-weight: 600; font-style: italic; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-Bold.ttf") format("truetype"); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-BoldItalic.ttf") format("truetype"); font-weight: 700; font-style: italic; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-ExtraBold.ttf") format("truetype"); font-weight: 800; font-style: normal; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-ExtraBoldItalic.ttf") format("truetype"); font-weight: 800; font-style: italic; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-Black.ttf") format("truetype"); font-weight: 900; font-style: normal; font-display: swap; }
@font-face { font-family: "Nunito"; src: url("/fonts/Nunito-BlackItalic.ttf") format("truetype"); font-weight: 900; font-style: italic; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("/fonts/JetBrainsMono-Regular.ttf") format("truetype"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("/fonts/JetBrainsMono-Medium.ttf") format("truetype"); font-weight: 500; font-style: normal; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("/fonts/JetBrainsMono-SemiBold.ttf") format("truetype"); font-weight: 600; font-style: normal; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("/fonts/JetBrainsMono-Bold.ttf") format("truetype"); font-weight: 700; font-style: normal; font-display: swap; }

:root {
  /* Surface hierarchy */
  --surface-sunken:  #F7F9FC;
  --surface:         #FFFFFF;
  --surface-overlay: #FFFFFF;
  --surface-inverse: #101928;

  /* Borders */
  --border-subtle:  #F0F2F5;
  --border-default: #E4E7EC;
  --border-strong:  #D0D5DD;
  --border-focus:   #720026;

  /* Text */
  --text-primary:   #101928;
  --text-secondary: #667085;
  --text-tertiary:  #98A2B3;
  --text-disabled:  #D0D5DD;
  --text-inverse:   #FFFFFF;
  --text-on-primary:#FFFFFF;
  --text-link:      #720026;
  --text-danger:    #9E0A07;
  --text-success:   #036B26;

  /* Elevation — 4 discrete levels, never interpolate */
  --elev-flat:     none;
  --elev-raised:   0 1px 2px 0 rgba(16, 24, 40, 0.06);
  --elev-floating: 0 4px 8px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.04);
  --elev-modal:    0 20px 32px -8px rgba(16, 24, 40, 0.16), 0 8px 16px -4px rgba(16, 24, 40, 0.08);
  --focus-ring:    0 0 0 3px rgba(114, 0, 38, 0.20);

  /* Motion */
  --duration-fast:      100ms;
  --duration-normal:    200ms;
  --duration-slow:      300ms;
  --ease-out:  cubic-bezier(0, 0, 0.2, 1);
  --ease-in:   cubic-bezier(0.4, 0, 1, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

  /* Density row heights */
  --row-compact:  36px;
  --row-default:  48px;
  --row-relaxed:  56px;

  /* Icon sizes */
  --icon-xs: 12px;
  --icon-sm: 16px;
  --icon-md: 20px;
  --icon-lg: 24px;
  --icon-xl: 32px;

  /* Chart palette — all AAA on white */
  --chart-1: #720026;
  --chart-2: #B7791F;
  --chart-3: #0F973D;
  --chart-4: #CB1A14;
  --chart-5: #7C3AED;
  --chart-6: #0E9384;
  --chart-7: #98A2B3;
  --chart-8: #344054;

  /* Z-index stack */
  --z-sidebar:  200;
  --z-topbar:   300;
  --z-dropdown: 400;
  --z-modal:    500;
  --z-toast:    600;
}

/* Shimmer animation for skeletons */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}

.wm-shimmer {
  background: linear-gradient(90deg, #F0F2F5 25%, #E4E7EC 50%, #F0F2F5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
```

- [ ] **Step 3: Update `globals.css`**

Replace the entire contents of `apps/web/src/app/globals.css` with:

```css
@import '../styles/design-system.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html,
  body {
    font-family: "Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background-color: var(--surface-sunken);
    color: var(--text-primary);
    min-width: 1280px;
    -webkit-font-smoothing: antialiased;
  }

  * {
    box-sizing: border-box;
  }

  /* Tabular numerals on all currency/numeric cells */
  .tabular {
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/ apps/web/src/app/globals.css
git commit -m "feat: add design system CSS token layer and font declarations"
```

---

### Task 4: Extend Tailwind config

**Files:**
- Modify: `apps/web/tailwind.config.ts`

- [ ] **Step 1: Replace tailwind config**

Replace the entire contents of `apps/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#FBE9EE',
          100: '#F5C7D2',
          200: '#EBA0B3',
          300: '#D26285',
          400: '#A41E48',
          500: '#720026',
          600: '#5C001E',
          700: '#470017',
          800: '#330010',
          900: '#1F0009',
        },
        accent: {
          50:  '#FEF6E7',
          100: '#FCE5B6',
          200: '#F9D285',
          300: '#F6BB52',
          400: '#E8A332',
          500: '#B7791F',
          600: '#92611A',
          700: '#6D4A14',
        },
        neutral: {
          0:   '#FFFFFF',
          25:  '#FCFCFD',
          50:  '#F9FAFB',
          75:  '#F7F9FC',
          100: '#F0F2F5',
          200: '#E4E7EC',
          300: '#D0D5DD',
          400: '#98A2B3',
          500: '#667085',
          600: '#475367',
          700: '#344054',
          800: '#1D2739',
          900: '#101928',
          950: '#0A101D',
        },
        success: {
          50:  '#E7F6EC',
          100: '#BAEDC7',
          300: '#40B869',
          500: '#0F973D',
          700: '#036B26',
          900: '#014A18',
        },
        warning: {
          50:  '#FEF6E7',
          100: '#FBE2B6',
          300: '#F7C164',
          500: '#D69E2E',
          700: '#8B5A00',
          900: '#523300',
        },
        danger: {
          50:  '#FBEAE9',
          100: '#F2BCB7',
          300: '#E26E6A',
          500: '#CB1A14',
          700: '#9E0A07',
          900: '#591000',
        },
        info: {
          50:  '#E3EFFC',
          100: '#B7D4F8',
          300: '#5EA0E8',
          500: '#1671D9',
          700: '#0E4F9C',
          900: '#052561',
        },
        baddebt: {
          bg:  '#2E1916',
          fg:  '#F2BCB7',
        },
      },
      fontFamily: {
        sans: ['Nunito', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xs:   '4px',
        sm:   '6px',
        md:   '8px',
        lg:   '12px',
        pill: '999px',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs:    ['11px', { lineHeight: '16px' }],
        sm:    ['12px', { lineHeight: '16px' }],
        base:  ['13px', { lineHeight: '18px' }],
        md:    ['14px', { lineHeight: '20px' }],
        lg:    ['16px', { lineHeight: '24px' }],
        xl:    ['18px', { lineHeight: '26px' }],
        '2xl': ['20px', { lineHeight: '28px' }],
        kpi:   ['28px', { lineHeight: '34px' }],
      },
      boxShadow: {
        raised:   '0 1px 2px 0 rgba(16, 24, 40, 0.06)',
        floating: '0 4px 8px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.04)',
        modal:    '0 20px 32px -8px rgba(16, 24, 40, 0.16), 0 8px 16px -4px rgba(16, 24, 40, 0.08)',
        focus:    '0 0 0 3px rgba(114, 0, 38, 0.20)',
      },
      transitionDuration: {
        fast:   '100ms',
        normal: '200ms',
        slow:   '300ms',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: Verify Tailwind picks up new tokens by running dev server briefly**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3000` — app should load without CSS errors. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add apps/web/tailwind.config.ts
git commit -m "feat: extend Tailwind config with design system color ramps, fonts, radius, shadows"
```

---

### Task 5: Format helpers with unit tests (TDD)

**Files:**
- Create: `apps/web/src/lib/format.test.ts`
- Create: `apps/web/src/lib/format.ts`

- [ ] **Step 1: Write failing tests first**

Create `apps/web/src/lib/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtGHS, fmtDate, fmtTime, fmtDateTime } from './format';

describe('fmtGHS', () => {
  it('formats positive amount with cedi symbol and two decimals', () => {
    expect(fmtGHS(12450)).toBe('₵12,450.00');
  });
  it('formats zero', () => {
    expect(fmtGHS(0)).toBe('₵0.00');
  });
  it('formats negative with minus sign not dash', () => {
    expect(fmtGHS(-1200)).toBe('−₵1,200.00');
  });
  it('formats null as em-dash', () => {
    expect(fmtGHS(null)).toBe('₵—');
  });
  it('formats undefined as em-dash', () => {
    expect(fmtGHS(undefined)).toBe('₵—');
  });
  it('formats decimal amount', () => {
    expect(fmtGHS(1234.5)).toBe('₵1,234.50');
  });
  it('formats large amount with comma separator', () => {
    expect(fmtGHS(1000000)).toBe('₵1,000,000.00');
  });
});

describe('fmtDate', () => {
  it('formats date string as DD/MM/YYYY', () => {
    expect(fmtDate('2026-05-20')).toBe('20/05/2026');
  });
  it('formats Date object', () => {
    expect(fmtDate(new Date(2026, 4, 20))).toBe('20/05/2026');
  });
  it('returns dash for null', () => {
    expect(fmtDate(null)).toBe('—');
  });
  it('returns dash for undefined', () => {
    expect(fmtDate(undefined)).toBe('—');
  });
  it('pads single-digit day and month', () => {
    expect(fmtDate('2026-01-05')).toBe('05/01/2026');
  });
});

describe('fmtTime', () => {
  it('formats as HH:mm by default', () => {
    const d = new Date('2026-05-20T14:32:05Z');
    const result = fmtTime(d);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
  it('formats as HH:mm:ss when withSeconds=true', () => {
    const d = new Date('2026-05-20T14:32:05Z');
    const result = fmtTime(d, true);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
  it('returns dash for null', () => {
    expect(fmtTime(null)).toBe('—');
  });
});

describe('fmtDateTime', () => {
  it('combines date and time with a space', () => {
    const d = new Date(2026, 4, 20, 14, 32, 5);
    const result = fmtDateTime(d);
    expect(result).toMatch(/^20\/05\/2026 \d{2}:\d{2}$/);
  });
  it('returns dash for null', () => {
    expect(fmtDateTime(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
cd apps/web && npx vitest run src/lib/format.test.ts
```

Expected: FAIL — `format.ts` does not exist yet.

- [ ] **Step 3: Implement `format.ts`**

Create `apps/web/src/lib/format.ts`:

```ts
export function fmtGHS(n: number | null | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '₵—';
  const abs = Math.abs(n).toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? '−' : ''}₵${abs}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const day   = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year  = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function fmtTime(d: string | Date | null | undefined, withSeconds = false): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (!withSeconds) return `${hh}:${mm}`;
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return `${fmtDate(d)} ${fmtTime(d)}`;
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npx vitest run src/lib/format.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ../..
git add apps/web/src/lib/format.ts apps/web/src/lib/format.test.ts
git commit -m "feat: add fmtGHS, fmtDate, fmtTime, fmtDateTime helpers with unit tests"
```

---

### Task 6: `cn()` utility

**Files:**
- Create: `apps/web/src/lib/utils.ts`

- [ ] **Step 1: Create `utils.ts`**

Create `apps/web/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/utils.ts
git commit -m "feat: add cn() class merging utility"
```

---

### Task 7: Button component

**Files:**
- Rewrite: `apps/web/src/components/ui/button.tsx`

- [ ] **Step 1: Rewrite button.tsx**

```tsx
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  Icon?: LucideIcon;
  IconRight?: LucideIcon;
  loading?: boolean;
  destructive?: boolean;
  children?: ReactNode;
}

const baseStyles =
  'inline-flex items-center gap-1.5 rounded-sm font-sans font-medium cursor-pointer border border-transparent whitespace-nowrap leading-none disabled:cursor-not-allowed focus-visible:outline-none';

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 transition-colors duration-fast disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:shadow-focus',
  secondary:
    'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50 transition-colors duration-fast disabled:bg-neutral-100 disabled:text-neutral-400 focus-visible:shadow-focus',
  ghost:
    'bg-transparent text-neutral-700 hover:bg-neutral-100 transition-colors duration-fast disabled:text-neutral-400 focus-visible:shadow-focus',
  danger:
    'bg-danger-500 text-white hover:bg-danger-700 disabled:bg-neutral-200 disabled:text-neutral-400',
  // danger has no transition — friction is deliberate
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3.5 py-2 text-base',
  lg: 'px-4.5 py-2.5 text-md',
};

const iconSizes: Record<Size, number> = { sm: 14, md: 16, lg: 16 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      Icon,
      IconRight,
      loading = false,
      destructive,
      children,
      className,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const iconSize = iconSizes[size];
    return (
      <button
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        disabled={disabled || loading}
        {...rest}
      >
        {Icon && <Icon size={iconSize} strokeWidth={1.75} />}
        {loading ? <span className="opacity-60">Loading...</span> : <span>{children}</span>}
        {IconRight && <IconRight size={iconSize} strokeWidth={1.75} />}
      </button>
    );
  },
);

Button.displayName = 'Button';

export function IconButton({
  icon: Icon,
  label,
  onClick,
  danger = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'w-7 h-7 rounded-xs border-none inline-flex items-center justify-center text-neutral-500 cursor-pointer transition-colors duration-fast',
        danger
          ? 'hover:bg-danger-50 hover:text-danger-700'
          : 'hover:bg-neutral-100 hover:text-neutral-700',
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.75} />
    </button>
  );
}
```

- [ ] **Step 2: Verify by starting dev server, navigating to any page**

```bash
cd apps/web && npm run dev
```

Check that no TypeScript errors appear in the terminal. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
cd ../..
git add apps/web/src/components/ui/button.tsx
git commit -m "feat: add branded Button and IconButton components"
```

---

### Task 8: Badge and StatusBadge

**Files:**
- Create: `apps/web/src/components/ui/badge.tsx`

- [ ] **Step 1: Create `badge.tsx`**

```tsx
import { cn } from '@/lib/utils';

type BadgeKind =
  | 'success' | 'warning' | 'danger' | 'info'
  | 'neutral' | 'neutral-dark' | 'accent' | 'baddebt';

const kindStyles: Record<BadgeKind, string> = {
  success:       'bg-success-50 text-success-700',
  warning:       'bg-warning-50 text-warning-700',
  danger:        'bg-danger-50 text-danger-700',
  info:          'bg-info-50 text-info-700',
  neutral:       'bg-neutral-100 text-neutral-700',
  'neutral-dark':'bg-neutral-100 text-neutral-800',
  accent:        'bg-accent-50 text-accent-700',
  baddebt:       'bg-[#2E1916] text-[#F2BCB7]',
};

interface BadgeProps {
  kind?: BadgeKind;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ kind = 'neutral', dot = true, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-xs font-semibold font-sans leading-tight',
        kindStyles[kind],
        className,
      )}
    >
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-current opacity-65 shrink-0"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

const STATUS_KIND: Record<string, BadgeKind> = {
  Active:             'success',
  Resigned:           'neutral',
  Retired:            'info',
  Dismissed:          'danger',
  Deceased:           'neutral-dark',
  'Loan-Active':      'info',
  Completed:          'success',
  Defaulted:          'danger',
  'Bad debt':         'baddebt',
  'WrittenOff':       'neutral',
  'Written off':      'neutral',
  Pending:            'neutral',
  Paid:               'success',
  Partial:            'warning',
  Overdue:            'danger',
  Waived:             'info',
  Missed:             'danger',
  'Carried forward':  'accent',
  Sent:               'success',
  Failed:             'danger',
  Bounced:            'warning',
};

export function StatusBadge({ status }: { status: string }) {
  const kind = STATUS_KIND[status] ?? 'neutral';
  return <Badge kind={kind}>{status}</Badge>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/badge.tsx
git commit -m "feat: add Badge and StatusBadge components"
```

---

### Task 9: Avatar

**Files:**
- Create: `apps/web/src/components/ui/avatar.tsx`

- [ ] **Step 1: Create `avatar.tsx`**

```tsx
import { cn } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeStyles: Record<AvatarSize, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-18 h-18 text-xl',
};

const palettes: [string, string][] = [
  ['bg-primary-50', 'text-primary-700'],
  ['bg-accent-50',  'text-accent-700'],
  ['bg-success-50', 'text-success-700'],
  ['bg-info-50',    'text-info-700'],
  ['bg-danger-50',  'text-danger-700'],
];

interface AvatarProps {
  name?: string;
  size?: AvatarSize;
  colorSeed?: number;
  className?: string;
}

export function Avatar({ name = '', size = 'md', colorSeed, className }: AvatarProps) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  const idx = (colorSeed ?? name.length) % palettes.length;
  const [bg, fg] = palettes[idx];

  return (
    <span
      className={cn(
        'rounded-pill inline-flex items-center justify-center font-semibold font-sans border border-neutral-200 shrink-0',
        sizeStyles[size],
        bg,
        fg,
        className,
      )}
      aria-label={name || 'User avatar'}
    >
      {initials || '—'}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/avatar.tsx
git commit -m "feat: add Avatar component with initials fallback"
```

---

### Task 10: Card

**Files:**
- Create: `apps/web/src/components/ui/card.tsx`

- [ ] **Step 1: Create `card.tsx`**

```tsx
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

interface CardBodyProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function Card({ children, className }: CardProps) {
  return (
    <section
      className={cn(
        'bg-white border border-neutral-200 rounded-md',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action, className }: CardHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-start justify-between px-5 py-4 border-b border-neutral-200',
        className,
      )}
    >
      <div>
        <h3 className="text-md font-semibold text-neutral-900">{title}</h3>
        {subtitle && <p className="text-sm text-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="ml-4 shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ children, className, noPadding = false }: CardBodyProps) {
  return (
    <div className={cn(!noPadding && 'px-5 py-4', className)}>{children}</div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/card.tsx
git commit -m "feat: add Card, CardHeader, CardBody components"
```

---

### Task 11: Form primitives — Field, Input, Select

**Files:**
- Create: `apps/web/src/components/ui/field.tsx`

- [ ] **Step 1: Create `field.tsx`**

```tsx
'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, helper, error, required, children, className }: FieldProps) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-base font-medium text-neutral-700">
        {label}
        {required && (
          <span className="text-danger-500 ml-0.5" aria-hidden="true">*</span>
        )}
      </span>
      {children}
      {error ? (
        <span className="text-sm text-danger-700">{error}</span>
      ) : helper ? (
        <span className="text-sm text-neutral-500">{helper}</span>
      ) : null}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  mono?: boolean;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ prefix, suffix, mono, error, className, ...rest }, ref) => (
    <span
      className={cn(
        'inline-flex items-center w-full rounded-sm border bg-white text-base text-neutral-900 h-[var(--row-default)] overflow-hidden',
        error ? 'border-danger-500' : 'border-neutral-200',
        'focus-within:border-primary-500 focus-within:shadow-focus',
      )}
    >
      {prefix && (
        <span className="px-3 text-neutral-500 border-r border-neutral-200 h-full flex items-center shrink-0 bg-neutral-50">
          {prefix}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          'flex-1 px-3 h-full bg-transparent outline-none placeholder:text-neutral-400',
          mono && 'font-mono tabular',
          className,
        )}
        {...rest}
      />
      {suffix && (
        <span className="px-3 text-neutral-500 border-l border-neutral-200 h-full flex items-center shrink-0 bg-neutral-50">
          {suffix}
        </span>
      )}
    </span>
  ),
);
Input.displayName = 'Input';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  placeholder?: string;
  options: Array<{ value: string; label: string } | string>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, placeholder, options, className, ...rest }, ref) => (
    <span
      className={cn(
        'inline-flex items-center w-full rounded-sm border bg-white text-base text-neutral-900 h-[var(--row-default)] overflow-hidden relative',
        error ? 'border-danger-500' : 'border-neutral-200',
        'focus-within:border-primary-500 focus-within:shadow-focus',
      )}
    >
      <select
        ref={ref}
        className={cn(
          'flex-1 px-3 h-full bg-transparent outline-none appearance-none pr-8 cursor-pointer',
          className,
        )}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const value = typeof o === 'string' ? o : o.value;
          const label = typeof o === 'string' ? o : o.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.75}
        className="absolute right-2.5 text-neutral-400 pointer-events-none"
      />
    </span>
  ),
);
Select.displayName = 'Select';
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/field.tsx
git commit -m "feat: add Field, Input, Select form primitives"
```

---

### Task 12: Modal

**Files:**
- Create: `apps/web/src/components/ui/modal.tsx`

- [ ] **Step 1: Create `modal.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ModalSize = 'sm' | 'md' | 'lg';
type IconKind = 'info' | 'warning' | 'danger' | 'success';

const sizeWidths: Record<ModalSize, string> = {
  sm: 'max-w-[480px]',
  md: 'max-w-[640px]',
  lg: 'max-w-[800px]',
};

const iconKindStyles: Record<IconKind, string> = {
  info:    'bg-info-50 text-info-700',
  warning: 'bg-warning-50 text-warning-700',
  danger:  'bg-danger-50 text-danger-700',
  success: 'bg-success-50 text-success-700',
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  icon?: ReactNode;
  iconKind?: IconKind;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  icon,
  iconKind = 'info',
}: ModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-modal)' }}
    >
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-neutral-900/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative bg-white rounded-md w-full shadow-modal',
          'animate-[modalIn_200ms_cubic-bezier(0,0,0.2,1)_both]',
          sizeWidths[size],
        )}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-xs text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors duration-fast"
        >
          <X size={16} strokeWidth={1.75} />
        </button>

        {/* Header */}
        <div className="flex gap-4 px-6 pt-6 pb-4">
          {icon && (
            <div
              className={cn(
                'w-10 h-10 rounded-md flex items-center justify-center shrink-0',
                iconKindStyles[iconKind],
              )}
            >
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 id="modal-title" className="text-lg font-semibold text-neutral-900">
              {title}
            </h3>
            <div className="mt-2 text-base text-neutral-600">{children}</div>
          </div>
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-4 border-t border-neutral-200 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `modalIn` keyframe to `design-system.css`**

Add this block at the end of `apps/web/src/styles/design-system.css`:

```css
@keyframes modalIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/modal.tsx apps/web/src/styles/design-system.css
git commit -m "feat: add Modal component with scrim and slide-in animation"
```

---

### Task 13: Toast — restyle Sonner

Sonner is already installed and used across the app. Style it to match the design spec (opaque white, colored left border, floating shadow) rather than replacing it.

**Files:**
- Modify: `apps/web/src/styles/design-system.css`
- Modify: `apps/web/src/components/providers.tsx`

- [ ] **Step 1: Read current providers.tsx**

Read `apps/web/src/components/providers.tsx` to see if `<Toaster>` is already mounted.

- [ ] **Step 2: Add Sonner CSS overrides to `design-system.css`**

Add at the end of `apps/web/src/styles/design-system.css`:

```css
/* ---- Sonner toast reskin ---- */
[data-sonner-toaster] {
  --width: 360px;
}

[data-sonner-toast] {
  background: #FFFFFF !important;
  border: 1px solid var(--border-default) !important;
  box-shadow: var(--elev-floating) !important;
  border-radius: 6px !important;
  font-family: "Nunito", sans-serif !important;
  font-size: 13px !important;
  padding: 14px 16px !important;
  border-left-width: 4px !important;
}

[data-sonner-toast][data-type="success"] { border-left-color: #0F973D !important; }
[data-sonner-toast][data-type="error"]   { border-left-color: #CB1A14 !important; }
[data-sonner-toast][data-type="warning"] { border-left-color: #D69E2E !important; }
[data-sonner-toast][data-type="info"]    { border-left-color: #1671D9 !important; }
[data-sonner-toast]:not([data-type])     { border-left-color: var(--border-default) !important; }

[data-sonner-toast] [data-title] {
  color: var(--text-primary) !important;
  font-weight: 600 !important;
}

[data-sonner-toast] [data-description] {
  color: var(--text-secondary) !important;
  font-size: 12px !important;
}
```

- [ ] **Step 3: Ensure `<Toaster>` is mounted in providers with correct position**

Open `apps/web/src/components/providers.tsx`. If `<Toaster>` is present, update its props. If absent, add it. The file should include:

```tsx
import { Toaster } from 'sonner';

// inside the providers JSX:
<Toaster position="bottom-right" richColors={false} closeButton />
```

Full `providers.tsx` (preserve existing providers, just update/add Toaster):

```tsx
'use client';

import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '../lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        richColors={false}
        closeButton
        toastOptions={{ duration: 5000 }}
      />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/design-system.css apps/web/src/components/providers.tsx
git commit -m "feat: restyle Sonner toasts to match design system (white + left border + floating shadow)"
```

---

### Task 14: RepaymentBar

**Files:**
- Create: `apps/web/src/components/ui/repayment-bar.tsx`

- [ ] **Step 1: Create `repayment-bar.tsx`**

```tsx
import { cn } from '@/lib/utils';
import { fmtGHS } from '@/lib/format';

interface RepaymentBarProps {
  paid: number;
  total: number;
  overdue?: boolean;
  partial?: boolean;
  className?: string;
}

export function RepaymentBar({ paid, total, overdue, partial, className }: RepaymentBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

  const fillColor = overdue
    ? 'bg-danger-500'
    : partial
    ? 'bg-warning-500'
    : 'bg-success-500';

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex justify-between text-sm text-neutral-500">
        <span>Repayment progress</span>
        <span className="font-mono tabular">
          {fmtGHS(paid)} of {fmtGHS(total)}
        </span>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-none', fillColor)}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="text-sm text-neutral-500">{pct}% repaid</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/repayment-bar.tsx
git commit -m "feat: add RepaymentBar component"
```

---

### Task 15: Skeleton loader

**Files:**
- Rewrite: `apps/web/src/components/ui/skeleton.tsx`

- [ ] **Step 1: Rewrite `skeleton.tsx`**

```tsx
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn('rounded-xs wm-shimmer', className)}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-neutral-100">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 h-[var(--row-compact)] items-center">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn('h-3 flex-1', c === 0 && 'max-w-[32px] rounded-pill')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-white border border-neutral-200 rounded-md p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="bg-white border border-neutral-200 rounded-md p-5 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/skeleton.tsx
git commit -m "feat: restyle skeleton loader with shimmer animation"
```

---

### Task 16: EmptyState

**Files:**
- Rewrite: `apps/web/src/components/ui/empty-state.tsx`

- [ ] **Step 1: Rewrite `empty-state.tsx`**

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  heading: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}

function EmptyIllustration() {
  return (
    <div className="w-[240px] h-[180px] bg-neutral-50 rounded-lg flex items-center justify-center">
      <svg
        width="80"
        height="80"
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect x="10" y="20" width="60" height="45" rx="4" stroke="#98A2B3" strokeWidth="1.75" />
        <line x1="10" y1="32" x2="70" y2="32" stroke="#98A2B3" strokeWidth="1.75" />
        <line x1="20" y1="44" x2="50" y2="44" stroke="#98A2B3" strokeWidth="1.75" strokeLinecap="round" />
        <line x1="20" y1="53" x2="44" y2="53" stroke="#98A2B3" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="60" cy="58" r="10" fill="#F7F9FC" stroke="#98A2B3" strokeWidth="1.75" />
        <line x1="60" y1="54" x2="60" y2="58" stroke="#98A2B3" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="60" cy="61" r="1" fill="#98A2B3" />
      </svg>
    </div>
  );
}

export function EmptyState({ heading, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 py-16 px-8 text-center',
        className,
      )}
    >
      <EmptyIllustration />
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-neutral-700">{heading}</h3>
        {body && <p className="text-base text-neutral-500 max-w-sm">{body}</p>}
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/empty-state.tsx
git commit -m "feat: restyle EmptyState with SVG illustration and design tokens"
```

---

### Task 17: KpiCard

**Files:**
- Create: `apps/web/src/components/ui/kpi-card.tsx`

- [ ] **Step 1: Create `kpi-card.tsx`**

```tsx
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: string;
  trendDirection?: 'up' | 'down';
  sub?: string;
  danger?: boolean;
  className?: string;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  trend,
  trendDirection,
  sub,
  danger,
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'bg-white border border-neutral-200 rounded-md px-5 py-4 flex flex-col gap-1 relative',
        className,
      )}
    >
      {Icon && (
        <div className="absolute top-4 right-4 text-neutral-400">
          <Icon size={24} strokeWidth={1.75} />
        </div>
      )}
      <span className="text-2xs font-semibold text-neutral-500 uppercase tracking-widest">
        {label}
      </span>
      <span
        className={cn(
          'text-kpi font-semibold font-sans tabular',
          danger ? 'text-danger-700' : 'text-neutral-900',
        )}
      >
        {value}
      </span>
      <div className="flex items-center gap-2 mt-0.5">
        {trend && (
          <span
            className={cn(
              'text-sm font-semibold',
              trendDirection === 'down' ? 'text-danger-700' : 'text-success-700',
            )}
          >
            {trendDirection === 'down' ? '↓' : '↑'} {trend}
          </span>
        )}
        {sub && <span className="text-sm text-neutral-400">{sub}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/kpi-card.tsx
git commit -m "feat: add KpiCard component"
```

---

### Task 18: DataTable

**Files:**
- Create: `apps/web/src/components/ui/data-table.tsx`

- [ ] **Step 1: Create `data-table.tsx`**

```tsx
'use client';

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TableSkeleton } from './skeleton';
import { EmptyState } from './empty-state';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  isLoading?: boolean;
  emptyHeading?: string;
  emptyBody?: string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  isLoading,
  emptyHeading = 'No records to display',
  emptyBody,
  onRowClick,
  pageSize = 20,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-neutral-50 shadow-raised sticky top-0 z-10">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 text-left text-2xs font-semibold text-neutral-500 uppercase tracking-[0.04em] border-b border-neutral-200 h-[var(--row-compact)] whitespace-nowrap"
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        className={cn(
                          'inline-flex items-center gap-1',
                          header.column.getCanSort() && 'cursor-pointer hover:text-neutral-700',
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                        type="button"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && (
                          <ChevronUp size={10} strokeWidth={2} />
                        )}
                        {header.column.getIsSorted() === 'desc' && (
                          <ChevronDown size={10} strokeWidth={2} />
                        )}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <TableSkeleton rows={6} cols={columns.length} />
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState heading={emptyHeading} body={emptyBody} />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-neutral-100 h-[var(--row-compact)]',
                    onRowClick && 'cursor-pointer hover:bg-neutral-50',
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 text-base text-neutral-700 whitespace-nowrap"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200 text-sm text-neutral-500">
          <span>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-3 py-1 rounded-xs border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast"
            >
              Previous
            </button>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-3 py-1 rounded-xs border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/data-table.tsx
git commit -m "feat: add DataTable component with sorting, pagination, empty and loading states"
```

---

### Task 19: Sidebar rewrite

**Files:**
- Rewrite: `apps/web/src/components/nav/sidebar.tsx`

- [ ] **Step 1: Rewrite `sidebar.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Wallet, Banknote,
  BarChart2, Settings, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';

const NAV_ITEMS = [
  { href: '/',              icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/staff',         icon: Users,           label: 'Staff' },
  { href: '/contributions', icon: Wallet,          label: 'Contributions', alertKey: 'contributions' as const },
  { href: '/loans',         icon: Banknote,        label: 'Loans' },
  { href: '/reports',       icon: BarChart2,       label: 'Reports' },
];

const FOOTER_ITEMS = [
  { href: '/settings', icon: Settings, label: 'Settings' },
];

interface SidebarProps {
  alerts?: { contributions?: number };
}

export function Sidebar({ alerts }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <aside
      className={cn(
        'relative flex flex-col bg-white border-r border-neutral-200 shrink-0 transition-[width] ease-in-out',
        collapsed ? 'w-14' : 'w-[220px]',
      )}
      style={{
        zIndex: 'var(--z-sidebar)',
        transitionDuration: 'var(--duration-slow)',
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-[60px] border-b border-neutral-200 overflow-hidden shrink-0">
        <Image
          src="/assets/ncc-logo.png"
          alt="NCC Ghana crest"
          width={28}
          height={28}
          className="shrink-0"
        />
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="text-base font-semibold text-neutral-900 leading-tight truncate">
              Welfare Department
            </div>
            <div className="text-2xs text-neutral-500 leading-tight truncate">
              Narcotics Control Commission
            </div>
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-[72px] w-6 h-6 bg-white border border-neutral-200 rounded-pill flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:border-neutral-300 transition-colors duration-fast shadow-raised"
        style={{ zIndex: 'calc(var(--z-sidebar) + 1)' }}
      >
        {collapsed ? (
          <ChevronRight size={12} strokeWidth={1.75} />
        ) : (
          <ChevronLeft size={12} strokeWidth={1.75} />
        )}
      </button>

      {/* Section label */}
      {!collapsed && (
        <div className="px-4 pt-5 pb-2 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
          Operations
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 px-2 py-2 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label, alertKey }) => {
          const active = isActive(href);
          const alertCount = alertKey ? alerts?.[alertKey] : undefined;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-2 h-9 rounded-xs text-base font-medium transition-colors duration-fast relative',
                active
                  ? 'bg-primary-50 text-primary-700 border-l-[3px] border-primary-500 pl-[5px]'
                  : 'text-neutral-600 hover:bg-primary-50/60 hover:text-primary-700',
              )}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} strokeWidth={1.75} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
              {!collapsed && alertCount ? (
                <span className="ml-auto bg-accent-500 text-white text-xs font-semibold rounded-pill px-1.5 py-0.5 leading-tight">
                  {alertCount}
                </span>
              ) : null}
              {collapsed && alertCount ? (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-pill bg-accent-500" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-2 border-t border-neutral-200 flex flex-col gap-0.5">
        {FOOTER_ITEMS.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-2 h-9 rounded-xs text-base font-medium transition-colors duration-fast',
              isActive(href)
                ? 'bg-primary-50 text-primary-700 border-l-[3px] border-primary-500 pl-[5px]'
                : 'text-neutral-600 hover:bg-primary-50/60 hover:text-primary-700',
            )}
            title={collapsed ? label : undefined}
          >
            <Icon size={20} strokeWidth={1.75} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        ))}
        <button
          onClick={clearAuth}
          className="flex items-center gap-3 px-2 h-9 rounded-xs text-base font-medium text-neutral-600 hover:bg-primary-50/60 hover:text-primary-700 transition-colors duration-fast w-full text-left"
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={20} strokeWidth={1.75} className="shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/nav/sidebar.tsx
git commit -m "feat: rewrite Sidebar with brand tokens, collapse/expand, and active state"
```

---

### Task 20: Topbar rewrite

**Files:**
- Rewrite: `apps/web/src/components/nav/topbar.tsx`

- [ ] **Step 1: Rewrite `topbar.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, Bell } from 'lucide-react';
import { logout } from '@/lib/auth';
import { CommandPalette } from '@/components/search/command-palette';
import { Avatar } from '@/components/ui/avatar';
import { useAuthStore } from '@/store/auth.store';

const BREADCRUMB_MAP: Record<string, string[]> = {
  '/':                 ['Dashboard'],
  '/staff':            ['Staff'],
  '/contributions':    ['Contributions'],
  '/contributions/import': ['Contributions', 'Import'],
  '/contributions/manual': ['Contributions', 'Manual entry'],
  '/loans':            ['Loans'],
  '/loans/new':        ['Loans', 'New loan'],
  '/reports':          ['Reports'],
  '/settings':         ['Settings'],
  '/audit':            ['Audit log'],
  '/email-log':        ['Email log'],
};

function useBreadcrumb(pathname: string): string[] {
  if (BREADCRUMB_MAP[pathname]) return BREADCRUMB_MAP[pathname];
  if (pathname.startsWith('/loans/')) return ['Loans', 'Loan detail'];
  if (pathname.startsWith('/staff/')) return ['Staff', 'Staff detail'];
  return [pathname.split('/').filter(Boolean).join(' / ')];
}

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const breadcrumb = useBreadcrumb(pathname);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <>
      <header
        className="flex items-center gap-4 px-8 bg-white border-b border-neutral-200 h-[60px] shrink-0"
        style={{ boxShadow: 'var(--elev-raised)', zIndex: 'var(--z-topbar)' }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-base font-medium flex-1 min-w-0">
          {breadcrumb.map((segment, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-neutral-300">/</span>}
              <span
                className={
                  i === breadcrumb.length - 1
                    ? 'text-neutral-900 font-semibold'
                    : 'text-neutral-400'
                }
              >
                {segment}
              </span>
            </span>
          ))}
        </div>

        {/* Search trigger */}
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-3 h-9 bg-neutral-50 border border-neutral-200 rounded-sm text-neutral-400 text-base hover:border-neutral-300 transition-colors duration-fast"
          style={{ minWidth: 240 }}
        >
          <Search size={14} strokeWidth={1.75} />
          <span className="flex-1 text-left">Search staff, loans, or contributions</span>
          <kbd className="text-xs bg-white border border-neutral-200 rounded px-1 py-0.5 font-mono text-neutral-400">
            ⌘K
          </kbd>
        </button>

        {/* Right: bell + user */}
        <div className="flex items-center gap-3">
          <button
            className="relative w-9 h-9 flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xs transition-colors duration-fast"
            aria-label="Notifications"
          >
            <Bell size={18} strokeWidth={1.75} />
            <span className="absolute top-2 right-2 w-2 h-2 bg-danger-500 rounded-pill" />
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 hover:bg-neutral-50 rounded-xs px-2 py-1 transition-colors duration-fast"
            title="Sign out"
          >
            <Avatar name={user?.name ?? ''} size="sm" />
            <div className="text-left hidden xl:block">
              <div className="text-base font-medium text-neutral-900 leading-tight">
                {user?.name ?? 'User'}
              </div>
              <div className="text-2xs text-neutral-500 leading-tight capitalize">
                {user?.role ?? 'Officer'}
              </div>
            </div>
          </button>
        </div>
      </header>

      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/nav/topbar.tsx
git commit -m "feat: rewrite Topbar with breadcrumb, branded search trigger, user avatar"
```

---

### Task 21: Layout shell and root layout

**Files:**
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Update dashboard layout**

Replace `apps/web/src/app/(dashboard)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/nav/sidebar';
import { Topbar } from '@/components/nav/topbar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen min-w-[1280px]" style={{ background: 'var(--surface-sunken)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-8 pt-6 pb-8">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update root layout to apply font**

Replace `apps/web/src/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'Welfare Management System',
  description: 'Staff welfare contribution and loan management — Narcotics Control Commission',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Start dev server and verify chrome renders correctly**

```bash
cd apps/web && npm run dev
```

Navigate to `http://localhost:3000`. Verify:
- Sidebar shows NCC logo + "Welfare Department" brand
- Sidebar collapse toggle works (chevron button)
- Active nav item has crimson left border + primary-50 bg
- Topbar shows breadcrumb + search + bell + user avatar
- App background is `#F7F9FC` (slightly cool white)
- Font is Nunito (rounded characters, not default system font)

Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add apps/web/src/app/\(dashboard\)/layout.tsx apps/web/src/app/layout.tsx
git commit -m "feat: apply design system layout shell — branded sidebar, topbar, surface background"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered in task |
|---|---|
| 3.1 Fonts | Task 2 (copy) + Task 3 (font-face declarations) |
| 3.2 design-system.css | Task 3 |
| 3.3 Tailwind config | Task 4 |
| 3.4 cn() | Task 6 |
| 3.5 Format helpers | Task 5 |
| 4.1 Button | Task 7 |
| 4.2 Badge/StatusBadge | Task 8 |
| 4.3 Avatar | Task 9 |
| 4.4 Card | Task 10 |
| 4.5 KpiCard | Task 17 |
| 4.6 Input/Select/Field | Task 11 |
| 4.7 Modal | Task 12 |
| 4.8 Toast | Task 13 |
| 4.9 DataTable | Task 18 |
| 4.10 EmptyState | Task 16 |
| 4.11 SkeletonLoader | Task 15 |
| 4.12 RepaymentBar | Task 14 |
| 5.1 Sidebar | Task 19 |
| 5.2 Topbar | Task 20 |
| 5.3 Layout shell | Task 21 |

All sections covered. No gaps found.

**Placeholder scan:** No TBD, TODO, or "implement later" patterns found.

**Type consistency:**
- `cn()` used consistently across all components
- `LucideIcon` type from `lucide-react` used for icon props in Button, IconButton, KpiCard
- `BadgeKind` defined in badge.tsx and used internally (not exported — correct, StatusBadge handles the mapping)
- `DataTableProps<T>` uses `ColumnDef<T, unknown>` which matches @tanstack/react-table v8 API
- `useAuthStore` referenced in sidebar.tsx and topbar.tsx — same import path `@/store/auth.store`
