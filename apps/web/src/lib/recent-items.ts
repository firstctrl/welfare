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
