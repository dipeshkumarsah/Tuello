'use client';

import { can } from '@tuello/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { SETTINGS_NAV } from '@/lib/nav';
import { useMe } from '@/lib/session';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const me = useMe();
  const pathname = usePathname();
  const items = SETTINGS_NAV.filter((n) => can(me.membership.role, n.permission));
  return (
    <div>
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      <nav
        aria-label={t('settings.title')}
        className="mt-4 mb-8 flex gap-4 overflow-x-auto border-b border-border"
      >
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={pathname === n.href ? 'page' : undefined}
            className="-mb-px h-9 border-b-2 border-transparent px-0.5 pt-2 text-base font-medium whitespace-nowrap text-fg-muted hover:text-fg aria-[current=page]:border-fg aria-[current=page]:text-fg"
          >
            {t(n.label)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
