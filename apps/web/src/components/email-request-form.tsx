'use client';

import { useMutation } from '@tanstack/react-query';
import { emailSchema } from '@tuello/shared';
import { Button, Field, Input } from '@tuello/ui';
import Link from 'next/link';
import * as React from 'react';
import { AuthShell, FormMessage } from '@/components/auth-shell';
import { post } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Shared by "forgot password" and "email me a link": same shape, different endpoint and copy. */
export function EmailRequestForm({ kind }: { kind: 'reset' | 'magic' }) {
  const t = useT();
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const req = useMutation({
    mutationFn: () =>
      post(kind === 'reset' ? '/v1/auth/password-reset' : '/v1/auth/magic-link', { email }),
  });
  const copy =
    kind === 'reset'
      ? {
          title: t('auth.forgot.title'),
          body: t('auth.forgot.body'),
          submit: t('auth.forgot.submit'),
          sent: t('auth.forgot.sent', { email }),
        }
      : {
          title: t('auth.magic.title'),
          body: t('auth.magic.body'),
          submit: t('auth.magic.submit'),
          sent: t('auth.magic.sent', { email }),
        };
  return (
    <AuthShell title={copy.title} subtitle={copy.body}>
      {req.isSuccess ? (
        <FormMessage tone="info">{copy.sent}</FormMessage>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!emailSchema.safeParse(email).success) return setError(t('validation.email'));
            setError(undefined);
            req.mutate();
          }}
        >
          <Field label={t('auth.login.email')} error={error}>
            {(ids) => (
              <Input
                {...ids}
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <FormMessage>{req.isError ? t('problem.rate_limited') : null}</FormMessage>
          <Button type="submit" variant="accent" size="lg" loading={req.isPending}>
            {copy.submit}
          </Button>
        </form>
      )}
      <Link href="/login" className="mt-6 inline-block text-base underline underline-offset-4">
        {t('common.back')}
      </Link>
    </AuthShell>
  );
}
