'use client';

import { useMutation } from '@tanstack/react-query';
import type { LoginResult } from '@tuello/shared';
import { Button, Skeleton } from '@tuello/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { AuthShell, FormMessage } from '@/components/auth-shell';
import { post } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useAfterSignIn } from '@/lib/sign-in';

/**
 * Landing page for a one-time link (?token=...): consumes it once, then signs in.
 * Consumption is a POST triggered by the page, never by a GET, so link scanners cannot burn it.
 */
function Landing({ endpoint, title }: { endpoint: string; title: string }) {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const after = useAfterSignIn();
  const consume = useMutation({
    mutationFn: () => post<LoginResult>(endpoint, { token }),
    onSuccess: after,
  });
  const started = React.useRef(false);
  React.useEffect(() => {
    if (!started.current && token) {
      started.current = true;
      consume.mutate();
    }
  }, [token, consume]);

  return (
    <AuthShell title={title}>
      {consume.isError || !token ? (
        <div className="flex flex-col gap-4">
          <FormMessage>{t('problem.invalid_token')}</FormMessage>
          <Button asChild variant="secondary">
            <Link href="/login">{t('auth.login.submit')}</Link>
          </Button>
        </div>
      ) : (
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </AuthShell>
  );
}

export function TokenLanding(props: { endpoint: string; title: string }) {
  return (
    <React.Suspense>
      <Landing {...props} />
    </React.Suspense>
  );
}
