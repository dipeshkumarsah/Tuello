'use client';

import { useMutation } from '@tanstack/react-query';
import { passwordSchema } from '@tuello/shared';
import { Button, Field, Input } from '@tuello/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { AuthShell, FormMessage } from '@/components/auth-shell';
import { ApiError, post } from '@/lib/api';
import { useT } from '@/lib/i18n';

function ResetForm() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const reset = useMutation({
    mutationFn: () => post('/v1/auth/password-reset/confirm', { token, password }),
    onError: (err) => setError(err instanceof ApiError ? err.problem.title : String(err)),
  });
  if (reset.isSuccess) {
    return (
      <AuthShell title={t('auth.reset.title')}>
        <FormMessage tone="info">{t('auth.reset.done')}</FormMessage>
        <Button asChild variant="accent" size="lg" className="mt-6 w-full">
          <Link href="/login">{t('auth.login.submit')}</Link>
        </Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t('auth.reset.title')}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!passwordSchema.safeParse(password).success)
            return setError(t('validation.password_min'));
          reset.mutate();
        }}
      >
        <Field label={t('auth.reset.password')} hint={t('auth.signup.passwordHint')} error={error}>
          {(ids) => (
            <Input
              {...ids}
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="accent" size="lg" loading={reset.isPending}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense>
      <ResetForm />
    </React.Suspense>
  );
}
