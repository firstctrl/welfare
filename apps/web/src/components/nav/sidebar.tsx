'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard,
  Users,
  Landmark,
  FileBarChart2,
  Settings,
  ScrollText,
  Mail,
  Coins,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: boolean;
}

const navItems: NavItem[] = [
  { href: '/',               label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/staff',          label: 'Staff',        icon: Users,         matchPrefix: true },
  { href: '/contributions',  label: 'Contributions',icon: Coins,         matchPrefix: true },
  { href: '/loans',          label: 'Loans',        icon: Landmark,      matchPrefix: true },
  { href: '/reports',        label: 'Reports',      icon: FileBarChart2, matchPrefix: true },
  { href: '/audit',          label: 'Audit Log',    icon: ScrollText },
  { href: '/email-log',      label: 'Email Log',    icon: Mail },
  { href: '/settings',       label: 'Settings',     icon: Settings },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(item.href + '/');
  return pathname === item.href;
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-neutral-200 flex flex-col h-full">
      {/* Logo / brand */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-200">
        <div className="relative w-8 h-8 shrink-0">
          <Image
            src="/assets/ncc-logo.png"
            alt="NCC"
            fill
            className="object-contain"
            priority
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-900 leading-tight truncate">NCC Welfare</p>
          <p className="text-xs text-neutral-400 leading-tight truncate">Management System</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 rounded-sm text-base font-medium transition-colors duration-fast',
                'h-[var(--row-default)]',
                active
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
              )}
            >
              <item.icon
                size={18}
                strokeWidth={1.75}
                className={active ? 'text-primary-600' : 'text-neutral-400'}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-neutral-200">
        <p className="text-xs text-neutral-400">
          &copy; {new Date().getFullYear()} Narcotics Control Commission
        </p>
      </div>
    </aside>
  );
}
