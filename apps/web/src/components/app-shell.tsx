'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { can } from '@tuello/shared';
import {
  Avatar,
  Button,
  CommandPalette,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  ThemeToggle,
  useCommandPaletteHotkey,
  type CommandAction,
} from '@tuello/ui';
import { LogOut, Menu, Search, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { post } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { MAIN_NAV, SETTINGS_NAV } from '@/lib/nav';
import { useMe } from '@/lib/session';

/** "g" then a key jumps to a section (coordinator shortcuts; extended in later phases). */
function useGoShortcuts(map: Record<string, string>) {
  const router = useRouter();
  React.useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        el.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
      )
        return;
      if (armed && map[e.key]) {
        e.preventDefault();
        armed = false;
        router.push(map[e.key]!);
        return;
      }
      armed = e.key === 'g';
      clearTimeout(timer);
      if (armed) timer = setTimeout(() => (armed = false), 1000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, router]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  useCommandPaletteHotkey(setPaletteOpen);

  const role = me.membership.role;
  const nav = MAIN_NAV.filter((n) => can(role, n.permission));
  const shortcuts = React.useMemo(
    () => Object.fromEntries(nav.filter((n) => n.key).map((n) => [n.key!, n.href])),
    [nav],
  );
  useGoShortcuts(shortcuts);

  const logout = useMutation({
    mutationFn: () => post('/v1/auth/logout'),
    onSettled: () => {
      qc.clear();
      router.replace('/login');
    },
  });

  const actions: CommandAction[] = [
    ...[...nav, ...SETTINGS_NAV.filter((n) => can(role, n.permission))]
      .filter((n, i, arr) => arr.findIndex((m) => m.href === n.href) === i)
      .map((n) => ({
        id: n.href,
        label: t(n.label),
        group: t('nav.command'),
        icon: n.icon,
        shortcut: n.key ? `G ${n.key.toUpperCase()}` : undefined,
        run: () => router.push(n.href),
      })),
    ...(can(role, 'invites.manage')
      ? [
          {
            id: 'invite',
            label: t('team.inviteTitle'),
            group: t('team.invite'),
            icon: UserPlus,
            run: () => router.push('/settings/team?invite=1'),
          },
        ]
      : []),
    {
      id: 'logout',
      label: t('common.signOut'),
      group: t('settings.profile'),
      icon: LogOut,
      run: () => logout.mutate(),
    },
  ];

  // The most specific nav entry that matches the path is the active one.
  const activeHref =
    nav
      .map((n) => n.href)
      .filter((h) =>
        h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`),
      )
      .sort((a, b) => b.length - a.length)[0] ??
    (pathname.startsWith('/settings') ? '/settings/company' : undefined);
  const isActive = (href: string) => href === activeHref;

  const navList = (
    <nav aria-label={t('nav.home')} className="flex flex-col gap-0.5">
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={() => setMobileOpen(false)}
          aria-current={isActive(n.href) ? 'page' : undefined}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-base text-fg-muted hover:bg-bg-muted hover:text-fg aria-[current=page]:bg-bg-muted aria-[current=page]:font-medium aria-[current=page]:text-fg"
        >
          <n.icon size={16} strokeWidth={1.5} aria-hidden />
          {t(n.label)}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-bg focus:p-2"
      >
        {t('common.skipToContent')}
      </a>
      <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r border-border bg-bg-subtle p-3 md:flex">
        <div className="truncate px-2 pt-1 text-md font-semibold">{me.tenant.name}</div>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-2 text-sm text-fg-muted hover:text-fg"
        >
          <Search size={16} strokeWidth={1.5} aria-hidden />
          <span className="flex-1 text-left">{t('common.search')}</span>
          <Kbd>⌘K</Kbd>
        </button>
        {navList}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-bg p-4 md:hidden">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-md font-semibold">{me.tenant.name}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('common.close')}
              onClick={() => setMobileOpen(false)}
            >
              <X size={20} strokeWidth={1.5} aria-hidden />
            </Button>
          </div>
          {navList}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-border px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t('nav.home')}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} strokeWidth={1.5} aria-hidden />
          </Button>
          <span className="truncate font-semibold md:hidden">{me.tenant.name}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={t('common.search')}
              onClick={() => setPaletteOpen(true)}
            >
              <Search size={16} strokeWidth={1.5} aria-hidden />
            </Button>
            <ThemeToggle
              labels={{ theme: 'Theme', system: 'System', light: 'Light', dark: 'Dark' }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label={me.user.name}>
                  <Avatar name={me.user.name} className="h-7 w-7" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <span className="block text-sm font-medium text-fg">{me.user.name}</span>
                  <span className="block">{t(`role.${role}`)}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push('/settings/profile')}>
                  {t('settings.profile')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logout.mutate()}>
                  <LogOut size={16} strokeWidth={1.5} aria-hidden /> {t('common.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={actions}
        placeholder={t('nav.command')}
      />
    </div>
  );
}
