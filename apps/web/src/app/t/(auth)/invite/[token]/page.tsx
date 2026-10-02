'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  passwordSchema,
  personNameSchema,
  type InvitePreviewDto,
  type LoginResult,
} from '@tuello/shared';
import { Button, Field, Input, Skeleton } from '@tuello/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { AuthShell, FormMessage } from '@/components/auth-shell';
import { ApiError, get, post } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useAfterSignIn } from '@/lib/sign-in';

export default function AcceptInvitePage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const after = useAfterSignIn();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => get<InvitePreviewDto>(`/v1/invites/token/${token}`),
    retry: false,
  });
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<{ name?: string; password?: string; form?: string }>(
    {},
  );
  const accept = useMutation({
    mutationFn: () =>
      post<LoginResult>(`/v1/invites/token/${token}/accept`, { name: name || undefined, password }),
    onSuccess: after,
    onError: (err) =>
      setErrors({
        form: err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : String(err),
      }),
  });

  if (preview.isPending) {
    return (
      <AuthShell title={<Skeleton className="h-7 w-48" />}>
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </AuthShell>
    );
  }
  if (preview.isError) {
    return (
      <AuthShell title={t('problem.invalid_token')}>
        <Button asChild variant="secondary">
          <Link href="/login">{t('auth.login.submit')}</Link>
        </Button>
      </AuthShell>
    );
  }

  const inv = preview.data;
  const existing = inv.existingUser;
  return (
    <AuthShell
      title={t('auth.invite.title', { company: inv.tenantName })}
      subtitle={`${t('auth.invite.body', { role: t(`role.${inv.role}`) })} ${existing ? t('auth.invite.existing') : ''}`}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const next: typeof errors = {};
          if (!existing && !personNameSchema.safeParse(name).success)
            next.name = t('validation.required');
          if (!existing && !passwordSchema.safeParse(password).success)
            next.password = t('validation.password_min');
          if (existing && !password) next.password = t('validation.required');
          setErrors(next);
          if (Object.keys(next).length === 0) accept.mutate();
        }}
      >
        <Field label={t('auth.login.email')}>
          {(ids) => <Input {...ids} value={inv.email} readOnly disabled />}
        </Field>
        {!existing ? (
          <Field label={t('auth.signup.name')} error={errors.name}>
            {(ids) => (
              <Input
                {...ids}
                autoComplete="name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field
          label={t('auth.login.password')}
          hint={existing ? undefined : t('auth.signup.passwordHint')}
          error={errors.password}
        >
          {(ids) => (
            <Input
              {...ids}
              type="password"
              autoComplete={existing ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <FormMessage>{errors.form}</FormMessage>
        <Button type="submit" variant="accent" size="lg" loading={accept.isPending}>
          {t('auth.invite.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
