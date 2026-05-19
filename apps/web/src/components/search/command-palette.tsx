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
