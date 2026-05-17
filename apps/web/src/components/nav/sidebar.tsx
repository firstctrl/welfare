'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navLinks = [
  { href: '/', label: 'Dashboard' },
  { href: '/staff', label: 'Staff' },
  { href: '/contributions', label: 'Contributions' },
  { href: '/loans', label: 'Loans' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 bg-white shadow-sm flex flex-col">
      <div className="p-4 border-b">
        <h2 className="font-bold text-lg">Welfare System</h2>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === link.href
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
