'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { signupSchema, slugSchema } from '@tuello/shared';
import { Button, Field, Input } from '@tuello/ui';
import { Check, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormMessage } from '@/components/auth-shell';
import { get, post } from '@/lib/api';
import { applyProblem, fieldMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { usePlatform } from '@/lib/platform';

const formSchema = signupSchema.pick({
  companyName: true,
  slug: true,
  name: true,
  email: true,
  password: true,
});
type FormValues = z.input<typeof formSchema>;

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function SignupPage() {
  const t = useT();
  const { baseDomain } = usePlatform();
  const [done, setDone] = React.useState<{ email: string; company: string; slug: string } | null>(
    null,
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  const slugTouched = React.useRef(false);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), mode: 'onTouched' });
  const { register, handleSubmit, formState, watch, setValue, setError } = form;

  const company = watch('companyName');
  React.useEffect(() => {
    if (!slugTouched.current && company) setValue('slug', slugify(company));
  }, [company, setValue]);

  const slug = useDebounced(watch('slug') ?? '', 300);
  const slugValid = slugSchema.safeParse(slug).success;
  const availability = useQuery({
    queryKey: ['slug', slug],
    queryFn: () =>
      get<{ available: boolean }>(`/v1/auth/slug-availability?slug=${encodeURIComponent(slug)}`),
    enabled: slugValid,
  });

  const signup = useMutation({
    mutationFn: (v: FormValues) =>
      post<{ slug: string; email: string }>('/v1/auth/signup', {
        ...v,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    onSuccess: (r, v) => setDone({ email: r.email, slug: r.slug, company: v.companyName }),
    onError: (err) => setFormError(applyProblem(err, setError)),
  });

  const resend = useMutation({
    mutationFn: () =>
      post('/v1/auth/verify-email/resend', { email: done!.email, slug: done!.slug }),
  });

  if (done) {
    return (
      <main
        className="w-full max-w-md rounded-md border border-border bg-bg p-6"
        aria-live="polite"
      >
        <h1 className="text-xl font-semibold">{t('auth.signup.checkEmail.title')}</h1>
        <p className="mt-2 text-base text-fg-muted">
          {t('auth.signup.checkEmail.body', { email: done.email, company: done.company })}
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>
            {t('auth.signup.resend')}
          </Button>
          {resend.isSuccess ? (
            <FormMessage tone="info">{t('auth.signup.resent')}</FormMessage>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="w-full max-w-md">
      <div className="rounded-md border border-border bg-bg p-6">
        <h1 className="text-xl font-semibold">{t('auth.signup.title')}</h1>
        <p className="mt-1 text-base text-fg-muted">{t('auth.signup.subtitle')}</p>
        <form
          className="mt-6 flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit((v) => signup.mutate(v))}
        >
          <Field
            label={t('auth.signup.companyName')}
            error={fieldMessage(formState.errors.companyName?.message)}
          >
            {(ids) => <Input {...ids} autoComplete="organization" {...register('companyName')} />}
          </Field>
          <Field
            label={t('auth.signup.slug')}
            error={fieldMessage(formState.errors.slug?.message)}
            hint={
              <span className="flex items-center gap-2">
                <span>
                  {t('auth.signup.slugHint', { host: `${slug || 'your-company'}.${baseDomain}` })}
                </span>
                {slugValid && availability.data ? (
                  availability.data.available ? (
                    <span className="inline-flex items-center gap-1 text-fg">
                      <Check size={14} strokeWidth={1.5} aria-hidden />{' '}
                      {t('auth.signup.slugAvailable')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <X size={14} strokeWidth={1.5} aria-hidden />{' '}
                      {t('auth.signup.slugUnavailable')}
                    </span>
                  )
                ) : null}
              </span>
            }
          >
            {(ids) => (
              <Input
                {...ids}
                autoCapitalize="none"
                spellCheck={false}
                {...register('slug', { onChange: () => (slugTouched.current = true) })}
              />
            )}
          </Field>
          <Field label={t('auth.signup.name')} error={fieldMessage(formState.errors.name?.message)}>
            {(ids) => <Input {...ids} autoComplete="name" {...register('name')} />}
          </Field>
          <Field
            label={t('auth.signup.email')}
            error={fieldMessage(formState.errors.email?.message)}
          >
            {(ids) => <Input {...ids} type="email" autoComplete="email" {...register('email')} />}
          </Field>
          <Field
            label={t('auth.signup.password')}
            hint={t('auth.signup.passwordHint')}
            error={fieldMessage(formState.errors.password?.message)}
          >
            {(ids) => (
              <Input
                {...ids}
                type="password"
                autoComplete="new-password"
                {...register('password')}
              />
            )}
          </Field>
          <FormMessage>{formError}</FormMessage>
          <Button type="submit" size="lg" loading={signup.isPending}>
            {t('auth.signup.submit')}
          </Button>
        </form>
      </div>
      <p className="mt-4 text-center text-base text-fg-muted">
        {t('auth.signup.haveAccount')}{' '}
        <Link href="/login" className="text-fg underline underline-offset-4">
          {t('auth.login.submit')}
        </Link>
      </p>
    </main>
  );
}
