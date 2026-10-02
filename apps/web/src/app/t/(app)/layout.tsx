'use client';

import { can } from '@tuello/shared';
import { Skeleton } from '@tuello/ui';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { AppShell } from '@/components/app-shell';
import { QueryError } from '@/components/page';
import { ApiError } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n';
import { MeProvider, useMeQuery } from '@/lib/session';

function ShellSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-dvh">
      <div className="hidden w-56 border-r border-border bg-bg-subtle p-3 md:block">
        <Skeleton className="h-6 w-32" />
        <div className="mt-6 flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    </div>
  );
}

/** Signed-in area: loads /v1/me once, applies tenant formats, sends unfinished owners to onboarding. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMeQuery();
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  const needsOnboarding =
    !!me.data &&
    !me.data.tenant.onboardingCompletedAt &&
    can(me.data.membership.role, 'tenant.update') &&
    pathname !== '/onboarding';

  React.useEffect(() => {
    if (unauthenticated) router.replace('/login');
    else if (needsOnboarding) router.replace('/onboarding');
  }, [unauthenticated, needsOnboarding, router]);

  if (me.isPending || unauthenticated || needsOnboarding) return <ShellSkeleton />;
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <QueryError onRetry={() => void me.refetch()} />
      </div>
    );
  }
  const tenant = me.data.tenant;
  return (
    <MeProvider me={me.data}>
      <I18nProvider
        settings={{
          locale: tenant.locale,
          currency: tenant.currency,
          timeZone: tenant.timeZone,
          measurementUnit: tenant.measurementUnit,
        }}
      >
        {pathname === '/onboarding' ? children : <AppShell>{children}</AppShell>}
      </I18nProvider>
    </MeProvider>
  );
}
