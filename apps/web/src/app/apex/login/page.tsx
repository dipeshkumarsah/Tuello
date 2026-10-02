'use client';

import { isValidSlug } from '@tuello/shared';
import { Button, Field, Input } from '@tuello/ui';
import Link from 'next/link';
import * as React from 'react';
import { useT } from '@/lib/i18n';
import { tenantUrl, usePlatform } from '@/lib/platform';

/** On the apex there is no tenant yet: ask for the workspace address and go there. */
export default function FindWorkspacePage() {
  const t = useT();
  const { baseDomain } = usePlatform();
  const [slug, setSlug] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  return (
    <main className="w-full max-w-sm">
      <div className="rounded-md border border-border bg-bg p-6">
        <h1 className="text-xl font-semibold">{t('auth.find.title')}</h1>
        <p className="mt-1 text-base text-fg-muted">{t('auth.find.body')}</p>
        <form
          className="mt-6 flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const s = slug.trim().toLowerCase();
            if (!isValidSlug(s)) return setError(t('validation.slug_format'));
            window.location.assign(tenantUrl(s, baseDomain, '/login'));
          }}
        >
          <Field
            label={t('tenant.slug')}
            hint={`${slug || 'your-company'}.${baseDomain}`}
            error={error}
          >
            {(ids) => (
              <Input
                {...ids}
                value={slug}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setSlug(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg">
            {t('auth.find.submit')}
          </Button>
        </form>
      </div>
      <p className="mt-4 text-center text-base text-fg-muted">
        {t('auth.login.noAccount')}{' '}
        <Link href="/signup" className="text-fg underline underline-offset-4">
          {t('auth.login.createAccount')}
        </Link>
      </p>
    </main>
  );
}
