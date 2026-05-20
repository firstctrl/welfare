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
          className={cn('h-full rounded-full', fillColor)}
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
