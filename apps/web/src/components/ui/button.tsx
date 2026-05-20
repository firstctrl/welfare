'use client';

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

const base =
  'inline-flex items-center gap-1.5 rounded-sm font-sans font-medium cursor-pointer border border-transparent whitespace-nowrap leading-none disabled:cursor-not-allowed focus-visible:outline-none select-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 transition-colors duration-fast disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:shadow-focus',
  secondary:
    'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50 transition-colors duration-fast disabled:bg-neutral-100 disabled:text-neutral-400 focus-visible:shadow-focus',
  ghost:
    'bg-transparent text-neutral-700 hover:bg-neutral-100 transition-colors duration-fast disabled:text-neutral-400 focus-visible:shadow-focus',
  danger:
    'bg-danger-500 text-white hover:bg-danger-700 disabled:bg-neutral-200 disabled:text-neutral-400',
  // danger: no transition — friction is deliberate per spec
};

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3.5 py-2 text-base',
  lg: 'px-4 py-2.5 text-md',
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
      destructive: _destructive,
      children,
      className,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const sz = iconSizes[size];
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...rest}
      >
        {Icon && <Icon size={sz} strokeWidth={1.75} aria-hidden="true" />}
        {loading ? <span className="opacity-60">Loading...</span> : <span>{children}</span>}
        {IconRight && <IconRight size={sz} strokeWidth={1.75} aria-hidden="true" />}
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
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
