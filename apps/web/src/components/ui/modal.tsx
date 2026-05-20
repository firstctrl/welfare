'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ModalSize = 'sm' | 'md' | 'lg';
type IconKind = 'info' | 'warning' | 'danger' | 'success';

const sizeWidths: Record<ModalSize, string> = {
  sm: 'max-w-[480px]',
  md: 'max-w-[640px]',
  lg: 'max-w-[800px]',
};

const iconKindStyles: Record<IconKind, string> = {
  info:    'bg-info-50 text-info-700',
  warning: 'bg-warning-50 text-warning-700',
  danger:  'bg-danger-50 text-danger-700',
  success: 'bg-success-50 text-success-700',
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  icon?: ReactNode;
  iconKind?: IconKind;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  icon,
  iconKind = 'info',
}: ModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-modal)' as string }}
    >
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-neutral-900/60"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative bg-white rounded-md w-full shadow-modal',
          '[animation:modalIn_200ms_cubic-bezier(0,0,0.2,1)_both]',
          sizeWidths[size],
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-xs text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors duration-fast"
        >
          <X size={16} strokeWidth={1.75} />
        </button>

        <div className="flex gap-4 px-6 pt-6 pb-4">
          {icon && (
            <div
              className={cn(
                'w-10 h-10 rounded-md flex items-center justify-center shrink-0',
                iconKindStyles[iconKind],
              )}
            >
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0 pr-6">
            <h3 id="modal-title" className="text-lg font-semibold text-neutral-900">
              {title}
            </h3>
            <div className="mt-2 text-base text-neutral-600">{children}</div>
          </div>
        </div>

        {footer && (
          <div className="px-6 py-4 border-t border-neutral-200 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
