'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passwordSchema, TOTP_ROLES, type SessionDto } from '@tuello/shared';
import { Badge, Button, Card, CardHeader, Field, Input, SkeletonRows, toast } from '@tuello/ui';
import * as React from 'react';
import { FormMessage } from '@/components/auth-shell';
import { QueryError } from '@/components/page';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ME_KEY, useMe } from '@/lib/session';

const errText = (err: unknown) =>
  err instanceof ApiError
    ? (err.problem.detail ?? err.problem.errors?.[0]?.message ?? err.problem.title)
    : String(err);

function ProfileCard() {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const [name, setName] = React.useState(me.user.name);
  const save = useMutation({
    mutationFn: () => patch('/v1/me', { name }),
    onSuccess: () => {
      toast({ title: t('settings.saved'), tone: 'success' });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
  return (
    <Card>
      <CardHeader title={t('profile.title')} />
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('profile.name')}>
          {(ids) => <Input {...ids} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('profile.email')}>
          {(ids) => <Input {...ids} value={me.user.email} readOnly disabled />}
        </Field>
        <div>
          <Button type="submit" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactorCard() {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const [setup, setSetup] = React.useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const done = () => {
    setSetup(null);
    setCode('');
    setPassword('');
    setError(null);
    void qc.invalidateQueries({ queryKey: ME_KEY });
  };
  const start = useMutation({
    mutationFn: () => post<{ secret: string; qrSvg: string }>('/v1/me/totp/setup'),
    onSuccess: setSetup,
    onError: (e) => setError(errText(e)),
  });
  const confirm = useMutation({
    mutationFn: () => post('/v1/me/totp/confirm', { code }),
    onSuccess: done,
    onError: (e) => setError(errText(e)),
  });
  const disable = useMutation({
    mutationFn: () => post('/v1/me/totp/disable', { code, password }),
    onSuccess: done,
    onError: (e) => setError(errText(e)),
  });

  if (!TOTP_ROLES.includes(me.membership.role)) return null;
  const enabled = me.user.twoFactorEnabled;
  return (
    <Card>
      <CardHeader
        title={t('security.twoFactor')}
        description={enabled ? t('security.twoFactorOn') : t('security.twoFactorOff')}
        action={enabled ? <Badge>{t('team.twoFactor')}</Badge> : undefined}
      />
      <div className="flex flex-col gap-4 p-5">
        {!enabled && !setup ? (
          <div>
            <Button variant="secondary" loading={start.isPending} onClick={() => start.mutate()}>
              {t('security.enable')}
            </Button>
          </div>
        ) : null}
        {setup ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-fg-muted">{t('security.scan')}</p>
            {/* QR is generated server-side as monochrome SVG. */}
            <div
              className="w-44 rounded-md border border-border bg-white p-2"
              dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-fg-muted">{t('security.secret')}</span>
              <code className="font-mono text-sm break-all">{setup.secret}</code>
            </div>
          </div>
        ) : null}
        {setup || enabled ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (enabled) disable.mutate();
              else confirm.mutate();
            }}
          >
            <Field label={t('auth.mfa.code')} className="w-40">
              {(ids) => (
                <Input
                  {...ids}
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="tabular tracking-widest"
                />
              )}
            </Field>
            {enabled ? (
              <Field label={t('auth.login.password')} className="w-56">
                {(ids) => (
                  <Input
                    {...ids}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            <Button
              type="submit"
              variant={enabled ? 'danger' : 'primary'}
              loading={confirm.isPending || disable.isPending}
            >
              {enabled ? t('security.disable') : t('security.enable')}
            </Button>
          </form>
        ) : null}
        <FormMessage>{error}</FormMessage>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useI18n();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => post('/v1/me/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      toast({ title: t('settings.saved'), tone: 'success' });
    },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Card>
      <CardHeader title={t('auth.reset.title')} />
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!passwordSchema.safeParse(next).success)
            return setError(t('validation.password_min'));
          setError(null);
          change.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('auth.login.password')}>
            {(ids) => (
              <Input
                {...ids}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('auth.reset.password')} hint={t('auth.signup.passwordHint')}>
            {(ids) => (
              <Input
                {...ids}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </Field>
        </div>
        <FormMessage>{error}</FormMessage>
        <div>
          <Button type="submit" variant="secondary" loading={change.isPending}>
            {t('auth.reset.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => get<{ items: SessionDto[] }>('/v1/me/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/v1/me/sessions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <Card>
      <CardHeader title={t('security.sessions')} />
      <div className="p-5">
        {sessions.isPending ? (
          <SkeletonRows rows={2} label={t('common.loading')} />
        ) : sessions.isError ? (
          <QueryError onRetry={() => void sessions.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {sessions.data.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-base">{s.userAgent ?? '—'}</span>
                  <span className="text-sm text-fg-muted tabular">
                    {s.ip ?? ''} · {dateTime(s.lastSeenAt)}
                  </span>
                </div>
                {s.current ? (
                  <Badge>{t('security.thisDevice')}</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                    {t('common.revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <ProfileCard />
      <TwoFactorCard />
      <PasswordCard />
      <SessionsCard />
    </div>
  );
}
