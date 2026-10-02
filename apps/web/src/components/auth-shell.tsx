'use client';

import { useQuery } from '@tanstack/react-query';
import type { PublicTenantDto } from '@tuello/shared';
import { Skeleton } from '@tuello/ui';
import * as React from 'react';
import { get } from '@/lib/api';
import { useT } from '@/lib/i18n';

export function usePublicTenant() {
  return useQuery({
    queryKey: ['public-tenant'],
    queryFn: () => get<PublicTenantDto>('/v1/tenant/public'),
    staleTime: 300_000,
  });
}

/**
 * Centered card used by every sign-in screen on a tenant host. Shows the TENANT's logo/name and
 * applies its accent colour; never the Tuello brand.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const tenant = usePublicTenant();
  const accent = tenant.data?.branding.accentColor;
  const style = accent
    ? ({
        '--tu-accent': accent,
        '--tu-accent-fg': tenant.data?.branding.accentTextColor ?? '#FFFFFF',
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      style={style}
      className="flex min-h-dvh flex-col items-center justify-center bg-bg-subtle px-4 py-12"
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-md focus:bg-bg focus:p-2"
      >
        {t('common.skipToContent')}
      </a>
      <main id="main" className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {tenant.isPending ? (
            <Skeleton className="h-10 w-40" />
          ) : tenant.data?.branding.logoUrl ? (
            <img
              src={tenant.data.branding.logoUrl}
              alt={tenant.data.name}
              className="h-10 max-w-[200px] object-contain"
            />
          ) : tenant.data ? (
            <span className="text-lg font-semibold">{tenant.data.name}</span>
          ) : null}
        </div>
        <div className="rounded-md border border-border bg-bg p-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle ? <p className="mt-1 text-base text-fg-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function FormMessage({
  children,
  tone = 'error',
}: {
  children?: React.ReactNode;
  tone?: 'error' | 'info';
}) {
  if (!children) return null;
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error' ? 'text-sm text-danger' : 'text-sm text-fg-muted'}
    >
      {children}
    </p>
  );
}
