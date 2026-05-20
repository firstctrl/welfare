import { cn } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeStyles: Record<AvatarSize, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-18 h-18 text-xl',
};

const palettes: [string, string][] = [
  ['bg-primary-50', 'text-primary-700'],
  ['bg-accent-50',  'text-accent-700'],
  ['bg-success-50', 'text-success-700'],
  ['bg-info-50',    'text-info-700'],
  ['bg-danger-50',  'text-danger-700'],
];

interface AvatarProps {
  name?: string;
  size?: AvatarSize;
  colorSeed?: number;
  className?: string;
}

export function Avatar({ name = '', size = 'md', colorSeed, className }: AvatarProps) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  const idx = (colorSeed ?? name.length) % palettes.length;
  const [bg, fg] = palettes[idx];

  return (
    <span
      className={cn(
        'rounded-pill inline-flex items-center justify-center font-semibold font-sans border border-neutral-200 shrink-0',
        sizeStyles[size],
        bg,
        fg,
        className,
      )}
      aria-label={name || 'User avatar'}
    >
      {initials || '—'}
    </span>
  );
}
