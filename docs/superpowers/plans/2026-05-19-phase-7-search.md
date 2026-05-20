# Phase 7 — Meilisearch Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global search across staff and loans via Meilisearch, exposed as a unified API endpoint and a Cmd+K command palette in the web UI.

**Architecture:** LoansService gains a fire-and-forget `syncLoanToMeilisearch` method (mirrors the existing `StaffService.syncToMeilisearch` pattern). A new `SearchService` queries both Meilisearch indexes in parallel and returns typed `{type, id, title, subtitle, url}` results from `GET /search?q=`. The web adds a `cmdk`-powered command palette triggered by Cmd+K/Ctrl+K, with 200 ms debounce, grouped results, and recent items via localStorage.

**Tech Stack:** NestJS, MeiliSearch JS SDK (`meilisearch` already installed), Next.js 14, `cmdk` (to install), Tailwind CSS, `apiClient` (axios instance at `apps/web/src/lib/api-client.ts`)

---

## File Map

**Create:**
- `apps/api/src/search/search.service.ts` — unified multi-index search logic
- `apps/web/src/lib/recent-items.ts` — localStorage recent items helpers
- `apps/web/src/components/search/command-palette.tsx` — cmdk command palette component

**Modify:**
- `apps/api/src/loans/loans.service.ts` — inject MeiliSearch client, add `onModuleInit`, `syncLoanToMeilisearch`, call sync in `create`, `checkAndCompleteIfDone`, `exitSettle`
- `apps/api/src/search/search.controller.ts` — rewrite to use SearchService, return typed results
- `apps/api/src/search/search.module.ts` — add SearchService provider
- `apps/web/src/components/nav/topbar.tsx` — add search button, keyboard shortcut, render CommandPalette

---

## Task 1: Loans Meilisearch sync

**Files:**
- Modify: `apps/api/src/loans/loans.service.ts`
- Create: `apps/api/src/search/search.service.spec.ts` (tests in Task 2)

- [ ] **Step 1: Write the failing test for SearchService (loans index configured)**

Create `apps/api/src/search/search.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { MEILISEARCH_CLIENT } from './meilisearch.module';

const mockStaffIndex = {
  search: jest.fn(),
};
const mockLoansIndex = {
  search: jest.fn(),
};
const mockMeili = {
  index: jest.fn((name: string) => (name === 'staff' ? mockStaffIndex : mockLoansIndex)),
};

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: MEILISEARCH_CLIENT, useValue: mockMeili },
      ],
    }).compile();
    service = module.get<SearchService>(SearchService);
    jest.clearAllMocks();
  });

  it('queries both indexes in parallel', async () => {
    mockStaffIndex.search.mockResolvedValue({
      hits: [{ id: 's1', fullName: 'John Doe', staffId: 'STF001', level: 'GL10', status: 'Active' }],
      estimatedTotalHits: 1,
    });
    mockLoansIndex.search.mockResolvedValue({
      hits: [{ id: 'l1', staffName: 'Jane Smith', staffId: 'STF002', principalAmount: 50000, status: 'Active', disbursedDate: '2025-01-01' }],
      estimatedTotalHits: 1,
    });

    const result = await service.search('doe');

    expect(mockStaffIndex.search).toHaveBeenCalledWith('doe', { limit: 5 });
    expect(mockLoansIndex.search).toHaveBeenCalledWith('doe', { limit: 5 });
    expect(result.results).toHaveLength(2);
    const staffResult = result.results.find(r => r.type === 'staff');
    expect(staffResult).toMatchObject({ type: 'staff', id: 's1', title: 'John Doe', url: '/staff/s1' });
    const loanResult = result.results.find(r => r.type === 'loan');
    expect(loanResult).toMatchObject({ type: 'loan', id: 'l1', url: '/loans/l1' });
  });

  it('returns empty results when query is blank', async () => {
    const result = await service.search('');
    expect(mockStaffIndex.search).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd apps/api && npx jest search.service.spec --no-coverage --no-passWithNoTests
```

Expected: FAIL — `Cannot find module './search.service'`

- [ ] **Step 3: Add Meilisearch inject + loans index setup to LoansService**

In `apps/api/src/loans/loans.service.ts`, add to imports at top:
```typescript
import { MeiliSearch } from 'meilisearch';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';
```

Add `OnModuleInit` to the NestJS imports line (already has other imports from `@nestjs/common`):
```typescript
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
```

Change the class declaration:
```typescript
export class LoansService implements OnModuleInit {
```

Add `@Inject(MEILISEARCH_CLIENT) private readonly meiliClient: MeiliSearch,` to the constructor (after the existing `loanScheduleSender` param).

Add these two methods after the constructor (before `// ───────── CREATE LOAN`):

```typescript
async onModuleInit() {
  await this.meiliClient
    .index('loans')
    .updateSettings({
      searchableAttributes: ['staffName', 'staffId'],
      filterableAttributes: ['status'],
      sortableAttributes: ['disbursedDate', 'principalAmount'],
    })
    .catch(() => { /* non-fatal */ });
}

private syncLoanToMeilisearch(loan: LoanDocument, staffName: string): void {
  const doc = {
    id: loan._id.toString(),
    staffId: loan.staffId,
    staffName,
    principalAmount: loan.principalAmount,
    status: loan.status,
    disbursedDate: loan.disbursedDate,
  };
  this.meiliClient
    .index('loans')
    .addDocuments([doc])
    .catch(() => { /* fire-and-forget */ });
}
```

- [ ] **Step 4: Call syncLoanToMeilisearch in `create`**

In the `create` method, after `const loanId = loan._id.toString();` and before the schedule array, add:
```typescript
this.syncLoanToMeilisearch(loan, staff.fullName);
```

(`staff` is already in scope — fetched earlier via `this.staffService.findById(dto.staffId)`)

- [ ] **Step 5: Call sync in `checkAndCompleteIfDone`**

Inside `checkAndCompleteIfDone`, after the `findByIdAndUpdate` call, add sync. The method currently doesn't have the staff name, so re-fetch the loan then staff. Replace the body's `if (remaining.length === 0)` block:

```typescript
if (remaining.length === 0) {
  const completedLoan = await this.loanModel
    .findByIdAndUpdate(loanId, { $set: { status: LoanStatus.Completed } }, { new: true })
    .exec();
  this.auditService.log(actorId, actorName, AuditAction.Update, AuditEntity.Loan, loanId, undefined, {
    status: LoanStatus.Completed,
  });
  if (completedLoan) {
    const staff = await this.staffService.findById(completedLoan.staffId);
    this.syncLoanToMeilisearch(completedLoan, staff.fullName);
  }
}
```

- [ ] **Step 6: Call sync in `exitSettle`**

At the end of `exitSettle`, after the `findByIdAndUpdate` call (before `return updated!`), add:
```typescript
if (updated) {
  const staff = await this.staffService.findById(updated.staffId);
  this.syncLoanToMeilisearch(updated, staff.fullName);
}
```

- [ ] **Step 7: Run API tests to confirm no regressions**

```
cd apps/api && npx jest --no-coverage
```

Expected: all 63 tests pass

- [ ] **Step 8: Commit**

```
git add apps/api/src/loans/loans.service.ts apps/api/src/search/search.service.spec.ts
git commit -m "feat(search): add loans Meilisearch index setup and sync hooks"
```

---

## Task 2: Unified search endpoint

**Files:**
- Create: `apps/api/src/search/search.service.ts`
- Modify: `apps/api/src/search/search.controller.ts`
- Modify: `apps/api/src/search/search.module.ts`

- [ ] **Step 1: Create SearchService**

Create `apps/api/src/search/search.service.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { MEILISEARCH_CLIENT } from './meilisearch.module';

export interface SearchResultItem {
  type: 'staff' | 'loan';
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(MEILISEARCH_CLIENT) private readonly meili: MeiliSearch,
  ) {}

  async search(q: string): Promise<{ results: SearchResultItem[] }> {
    if (!q || !q.trim()) return { results: [] };

    const [staffRes, loansRes] = await Promise.all([
      this.meili.index('staff').search(q, { limit: 5 }),
      this.meili.index('loans').search(q, { limit: 5 }),
    ]);

    const staffItems: SearchResultItem[] = staffRes.hits.map((h: any) => ({
      type: 'staff',
      id: h.id,
      title: h.fullName,
      subtitle: `${h.staffId} · ${h.level} · ${h.status}`,
      url: `/staff/${h.id}`,
    }));

    const loanItems: SearchResultItem[] = loansRes.hits.map((h: any) => ({
      type: 'loan',
      id: h.id,
      title: `${h.staffName} — ₦${Number(h.principalAmount).toLocaleString()}`,
      subtitle: `${h.status} · ${new Date(h.disbursedDate).toLocaleDateString('en-GB')}`,
      url: `/loans/${h.id}`,
    }));

    return { results: [...staffItems, ...loanItems] };
  }
}
```

- [ ] **Step 2: Run the failing test from Task 1**

```
cd apps/api && npx jest search.service.spec --no-coverage
```

Expected: PASS (SearchService now exists and matches test expectations)

- [ ] **Step 3: Rewrite SearchController**

Replace entire content of `apps/api/src/search/search.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query('q') q: string = '') {
    return this.searchService.search(q);
  }
}
```

- [ ] **Step 4: Update SearchModule**

Replace entire content of `apps/api/src/search/search.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
```

- [ ] **Step 5: Run all API tests**

```
cd apps/api && npx jest --no-coverage
```

Expected: all tests pass (including search.service.spec)

- [ ] **Step 6: Commit**

```
git add apps/api/src/search/
git commit -m "feat(search): unified GET /search?q= endpoint returning typed staff+loan results"
```

---

## Task 3: Web — install cmdk + recent items util

**Files:**
- Create: `apps/web/src/lib/recent-items.ts`

- [ ] **Step 1: Install cmdk**

```
cd apps/web && npm install cmdk
```

Expected: `cmdk` added to `apps/web/package.json` dependencies

- [ ] **Step 2: Create recent items localStorage utility**

Create `apps/web/src/lib/recent-items.ts`:

```typescript
export interface RecentItem {
  type: 'staff' | 'loan';
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

const KEY = 'welfare:recent-items';
const MAX = 5;

export function getRecentItems(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function pushRecentItem(item: RecentItem): void {
  if (typeof window === 'undefined') return;
  const existing = getRecentItems().filter(r => r.url !== item.url);
  localStorage.setItem(KEY, JSON.stringify([item, ...existing].slice(0, MAX)));
}
```

- [ ] **Step 3: Verify web type-check still clean**

```
cd apps/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add apps/web/package.json apps/web/package-lock.json apps/web/src/lib/recent-items.ts
git commit -m "feat(search): install cmdk, add recent-items localStorage util"
```

---

## Task 4: Web — command palette component

**Files:**
- Create: `apps/web/src/components/search/command-palette.tsx`

- [ ] **Step 1: Create CommandPalette component**

Create `apps/web/src/components/search/command-palette.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { apiClient } from '../../lib/api-client';
import { getRecentItems, pushRecentItem, type RecentItem } from '../../lib/recent-items';

interface SearchResult {
  type: 'staff' | 'loan';
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setRecent(getRecentItems());
      setQuery('');
      setResults([]);
    }
  }, [open]);

  const fetchResults = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    apiClient.get<{ results: SearchResult[] }>('/search', { params: { q } })
      .then(({ data }) => setResults(data.results))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchResults(query), 200);
    return () => clearTimeout(timer);
  }, [query, fetchResults]);

  function navigate(item: SearchResult | RecentItem) {
    pushRecentItem(item);
    onClose();
    startTransition(() => router.push(item.url));
  }

  if (!open) return null;

  const staffResults = results.filter(r => r.type === 'staff');
  const loanResults = results.filter(r => r.type === 'loan');
  const showRecent = !query.trim() && recent.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden">
        <Command shouldFilter={false} className="flex flex-col">
          <div className="flex items-center border-b px-4">
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
            </svg>
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search staff or loans…"
              className="flex-1 px-3 py-4 text-sm outline-none bg-transparent placeholder:text-gray-400"
              autoFocus
            />
            {loading && <span className="text-xs text-gray-400">searching…</span>}
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            {showRecent && (
              <Command.Group heading={<span className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent</span>}>
                {recent.map(item => (
                  <ResultRow key={item.url} item={item} onSelect={() => navigate(item)} />
                ))}
              </Command.Group>
            )}
            {query.trim() && !loading && results.length === 0 && (
              <Command.Empty className="py-8 text-center text-sm text-gray-400">No results for &ldquo;{query}&rdquo;</Command.Empty>
            )}
            {staffResults.length > 0 && (
              <Command.Group heading={<span className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Staff</span>}>
                {staffResults.map(item => (
                  <ResultRow key={item.id} item={item} onSelect={() => navigate(item)} />
                ))}
              </Command.Group>
            )}
            {loanResults.length > 0 && (
              <Command.Group heading={<span className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Loans</span>}>
                {loanResults.map(item => (
                  <ResultRow key={item.id} item={item} onSelect={() => navigate(item)} />
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function ResultRow({ item, onSelect }: { item: SearchResult | RecentItem; onSelect: () => void }) {
  return (
    <Command.Item
      value={item.url}
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer aria-selected:bg-blue-50 text-sm"
    >
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${item.type === 'staff' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
        {item.type === 'staff' ? 'Staff' : 'Loan'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-medium text-gray-900 truncate">{item.title}</span>
        <span className="block text-xs text-gray-500 truncate">{item.subtitle}</span>
      </span>
    </Command.Item>
  );
}
```

- [ ] **Step 2: Run web type-check**

```
cd apps/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```
git add apps/web/src/components/search/
git commit -m "feat(search): CommandPalette component with cmdk, debounced search, recent items"
```

---

## Task 5: Web — wire keyboard shortcut in Topbar

**Files:**
- Modify: `apps/web/src/components/nav/topbar.tsx`

- [ ] **Step 1: Rewrite Topbar to include search trigger**

Replace entire content of `apps/web/src/components/nav/topbar.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '../../lib/auth';
import { CommandPalette } from '../search/command-palette';

export function Topbar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
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
      <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Welfare Management System</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
            </svg>
            <span>Search</span>
            <kbd className="ml-1 text-xs bg-white border border-gray-300 rounded px-1 py-0.5 font-mono">⌘K</kbd>
          </button>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: Run web type-check**

```
cd apps/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run API tests one final time**

```
cd apps/api && npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 4: Final commit**

```
git add apps/web/src/components/nav/topbar.tsx
git commit -m "feat(search): wire Cmd+K search trigger in Topbar, complete Phase 7"
```
