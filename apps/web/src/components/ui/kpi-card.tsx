import type { ReactNode, ElementType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

type Trend = 'up' | 'down' | 'flat';
type TrendSentiment = 'positive' | 'negative' | 'neutral';

interface KpiCardProps {
  label: string;
  value: string;
  title?: string;
  subtext?: string;
  trend?: Trend;
  trendLabel?: string;
  trendSentiment?: TrendSentiment;
  icon?: LucideIcon;
  iconKind?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
  children?: ReactNode;
}

const trendIcons: Record<Trend, ElementType> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

const sentimentColors: Record<TrendSentiment, string> = {
  positive: 'text-success-600',
  negative: 'text-danger-600',
  neutral:  'text-neutral-500',
};

const iconKindStyles: Record<NonNullable<KpiCardProps['iconKind']>, string> = {
  primary: 'bg-primary-50 text-primary-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger:  'bg-danger-50 text-danger-700',
  info:    'bg-info-50 text-info-700',
};

export function KpiCard({
  label,
  value,
  title,
  subtext,
  trend,
  trendLabel,
  trendSentiment = 'neutral',
  icon: Icon,
  iconKind = 'primary',
  className,
  children,
}: KpiCardProps) {
  const TrendIcon = trend ? trendIcons[trend] : null;
  const trendColor = sentimentColors[trendSentiment];

  return (
    <div className={cn('bg-white border border-neutral-200 rounded-md p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-neutral-500 font-medium">{label}</p>
          <p className="mt-1 text-kpi font-bold text-neutral-900 font-mono tabular leading-none" title={title}>
            {value}
          </p>
          {(TrendIcon || subtext) && (
            <div className="mt-2 flex items-center gap-1.5">
              {TrendIcon && (
                <TrendIcon size={14} strokeWidth={1.75} className={trendColor} />
              )}
              {trendLabel && (
                <span className={cn('text-sm font-medium', trendColor)}>{trendLabel}</span>
              )}
              {subtext && (
                <span className="text-sm text-neutral-500">{subtext}</span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <div
            className={cn(
              'w-10 h-10 rounded-md flex items-center justify-center shrink-0',
              iconKindStyles[iconKind],
            )}
          >
            <Icon size={20} strokeWidth={1.75} />
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
