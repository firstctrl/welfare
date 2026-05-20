import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

function EmptyIllustration() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <rect width="80" height="80" rx="40" fill="var(--surface-raised)" />
      <rect x="20" y="28" width="40" height="28" rx="3" stroke="var(--border-subtle)" strokeWidth="1.5" fill="none" />
      <path d="M20 36h40" stroke="var(--border-subtle)" strokeWidth="1.5" />
      <path d="M28 44h8M28 50h16" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="56" cy="24" r="8" fill="var(--surface-sunken)" stroke="var(--border-subtle)" strokeWidth="1.5" />
      <path d="M53 24h6M56 21v6" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface EmptyStateProps {
  heading: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ heading, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-4 py-16 px-8 text-center', className)}>
      <EmptyIllustration />
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-neutral-700">{heading}</h3>
        {body && <p className="text-base text-neutral-500 max-w-sm">{body}</p>}
      </div>
      {action}
    </div>
  );
}
