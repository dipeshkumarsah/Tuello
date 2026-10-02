'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { loginSchema, totpCodeSchema, type LoginResult } from '@tuello/shared';
import { Button, Field, Input } from '@tuello/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthShell, FormMessage, usePublicTenant } from '@/components/auth-shell';
import { ApiError, post } from '@/lib/api';
import { applyProblem, fieldMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useAfterSignIn } from '@/lib/sign-in';

type LoginValues = z.input<typeof loginSchema>;

function PasswordStep() {
  const t = useT();
  const tenant = usePublicTenant();
  const after = useAfterSignIn();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const login = useMutation({
    mutationFn: (v: LoginValues) => post<LoginResult>('/v1/auth/login', v),
    onSuccess: after,
    onError: (err) => setError(applyProblem(err, form.setError)),
  });
  return (
    <AuthShell title={t('auth.login.title', { company: tenant.data?.name ?? '' })}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={form.handleSubmit((v) => login.mutate(v))}
      >
        <Field
          label={t('auth.login.email')}
          error={fieldMessage(form.formState.errors.email?.message)}
        >
          {(ids) => (
            <Input
              {...ids}
              type="email"
              autoComplete="username"
              autoFocus
              {...form.register('email')}
            />
          )}
        </Field>
        <Field
          label={t('auth.login.password')}
          error={fieldMessage(form.formState.errors.password?.message)}
        >
          {(ids) => (
            <Input
              {...ids}
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
          )}
        </Field>
        <FormMessage>{error}</FormMessage>
        <Button type="submit" variant="accent" size="lg" loading={login.isPending}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-base">
        <Link href="/forgot-password" className="underline underline-offset-4">
          {t('auth.login.forgot')}
        </Link>
        <Link href="/magic" className="underline underline-offset-4">
          {t('auth.login.magic')}
        </Link>
      </div>
    </AuthShell>
  );
}

function MfaStep() {
  const t = useT();
  const after = useAfterSignIn();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const mfa = useMutation({
    mutationFn: () =>
      post<LoginResult>('/v1/auth/mfa', {
        challengeToken: sessionStorage.getItem('tuello-mfa') ?? '',
        code,
      }),
    onSuccess: (r) => {
      sessionStorage.removeItem('tuello-mfa');
      after(r);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : String(err)),
  });
  return (
    <AuthShell title={t('auth.mfa.title')} subtitle={t('auth.mfa.body')}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!totpCodeSchema.safeParse(code).success) return setError(t('validation.totp_code'));
          mfa.mutate();
        }}
      >
        <Field label={t('auth.mfa.code')} error={error ?? undefined}>
          {(ids) => (
            <Input
              {...ids}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className="tabular tracking-widest"
            />
          )}
        </Field>
        <Button type="submit" variant="accent" size="lg" loading={mfa.isPending}>
          {t('auth.mfa.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}

function LoginRouter() {
  const step = useSearchParams().get('step');
  return step === 'mfa' ? <MfaStep /> : <PasswordStep />;
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginRouter />
    </React.Suspense>
  );
}
