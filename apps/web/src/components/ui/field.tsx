'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, helper, error, required, children, className }: FieldProps) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-base font-medium text-neutral-700">
        {label}
        {required && (
          <span className="text-danger-500 ml-0.5" aria-hidden="true">*</span>
        )}
      </span>
      {children}
      {error ? (
        <span className="text-sm text-danger-700">{error}</span>
      ) : helper ? (
        <span className="text-sm text-neutral-500">{helper}</span>
      ) : null}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  mono?: boolean;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ prefix, suffix, mono, error, className, style, ...rest }, ref) => (
    <span
      className={cn(
        'inline-flex items-center w-full rounded-sm border bg-white text-base text-neutral-900 overflow-hidden',
        'h-[var(--row-default)]',
        error ? 'border-danger-500' : 'border-neutral-200',
        'focus-within:border-primary-500 focus-within:shadow-focus',
      )}
      style={style}
    >
      {prefix && (
        <span className="px-3 text-neutral-500 border-r border-neutral-200 h-full flex items-center shrink-0 bg-neutral-50 text-base">
          {prefix}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          'flex-1 px-3 h-full bg-transparent outline-none placeholder:text-neutral-400 text-base',
          mono && 'font-mono tabular',
          className,
        )}
        {...rest}
      />
      {suffix && (
        <span className="px-3 text-neutral-500 border-l border-neutral-200 h-full flex items-center shrink-0 bg-neutral-50 text-base">
          {suffix}
        </span>
      )}
    </span>
  ),
);
Input.displayName = 'Input';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  placeholder?: string;
  options: Array<{ value: string; label: string } | string>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, placeholder, options, className, style, ...rest }, ref) => (
    <span
      className={cn(
        'inline-flex items-center w-full rounded-sm border bg-white text-base text-neutral-900 overflow-hidden relative',
        'h-[var(--row-default)]',
        error ? 'border-danger-500' : 'border-neutral-200',
        'focus-within:border-primary-500 focus-within:shadow-focus',
      )}
      style={style}
    >
      <select
        ref={ref}
        className={cn(
          'flex-1 px-3 h-full bg-transparent outline-none appearance-none pr-8 cursor-pointer text-base',
          className,
        )}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const value = typeof o === 'string' ? o : o.value;
          const label = typeof o === 'string' ? o : o.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.75}
        className="absolute right-2.5 text-neutral-400 pointer-events-none"
      />
    </span>
  ),
);
Select.displayName = 'Select';
