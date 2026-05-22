'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard,
  Users,
  UserCog,
  Landmark,
  FileBarChart2,
  Settings,
  ScrollText,
  Mail,
  Coins,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermission } from '../../hooks/use-permission';
import { AppModule } from '@welfare/shared';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: boolean;
  module?: AppModule;
}

const navItems: NavItem[] = [
  { href: '/',              label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/staff',         label: 'Staff',         icon: Users,         matchPrefix: true, module: AppModule.Staff },
  { href: '/contributions', label: 'Contributions', icon: Coins,         matchPrefix: true, module: AppModule.Contributions },
  { href: '/loans',         label: 'Loans',         icon: Landmark,      matchPrefix: true, module: AppModule.Loans },
  { href: '/reports',       label: 'Reports',       icon: FileBarChart2, matchPrefix: true, module: AppModule.Reports },
  { href: '/audit',         label: 'Audit Log',     icon: ScrollText,    module: AppModule.AuditLog },
  { href: '/email-log',     label: 'Email Log',     icon: Mail,          module: AppModule.EmailLog },
  { href: '/settings',      label: 'Settings',      icon: Settings,      module: AppModule.Settings },
  { href: '/users',         label: 'Users',         icon: UserCog,       matchPrefix: true, module: AppModule.UserManagement },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(item.href + '/');
  return pathname === item.href;
}

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const permission = usePermission(item.module!);
  if (permission === 'none') return null;
  const active = isActive(pathname, item);
  return (
    <Link
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
}

function DashboardLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  return (
    <Link
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
}

export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-neutral-200 flex flex-col h-full">
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
          <p className="text-sm font-bold text-neutral-900 leading-tight truncate">NACOC Welfare</p>
          <p className="text-xs text-neutral-400 leading-tight truncate">Management System</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) =>
          item.module ? (
            <NavLink key={item.href} item={item} />
          ) : (
            <DashboardLink key={item.href} item={item} />
          ),
        )}
      </nav>

      <div className="px-5 py-4 border-t border-neutral-200">
        <p className="text-xs text-neutral-400">
          &copy; {new Date().getFullYear()} Narcotics Control Commission
        </p>
      </div>
    </aside>
  );
}
