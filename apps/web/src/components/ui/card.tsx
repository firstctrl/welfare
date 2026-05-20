import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
    <section className={cn('bg-white border border-neutral-200 rounded-md', className)}>
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
