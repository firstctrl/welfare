import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeKind =
  | 'success' | 'warning' | 'danger' | 'info'
  | 'neutral' | 'neutral-dark' | 'accent' | 'baddebt';

const kindStyles: Record<BadgeKind, string> = {
  success:        'bg-success-50 text-success-700',
  warning:        'bg-warning-50 text-warning-700',
  danger:         'bg-danger-50 text-danger-700',
  info:           'bg-info-50 text-info-700',
  neutral:        'bg-neutral-100 text-neutral-700',
  'neutral-dark': 'bg-neutral-100 text-neutral-800',
  accent:         'bg-accent-50 text-accent-700',
  baddebt:        'bg-[#2E1916] text-[#F2BCB7]',
};

interface BadgeProps {
  kind?: BadgeKind;
  dot?: boolean;
  children: ReactNode;
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
  BadDebt:            'baddebt',
  WrittenOff:         'neutral',
  'Written off':      'neutral',
  'Written Off':      'neutral',
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
