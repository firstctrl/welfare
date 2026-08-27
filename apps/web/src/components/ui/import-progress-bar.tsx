import { cn } from '@/lib/utils';

interface ImportProgressBarProps {
  processed: number;
  total: number;
  className?: string;
}

export function ImportProgressBar({ processed, total, className }: ImportProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex justify-between text-sm text-neutral-500">
        <span>Importing…</span>
        <span className="font-mono tabular">{processed} of {total} rows</span>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-primary-500 transition-all duration-fast"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
