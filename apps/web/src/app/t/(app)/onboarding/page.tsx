'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton } from '@tuello/ui';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { BrandingForm } from '@/components/branding-form';
import { CompanyForm } from '@/components/company-form';
import { QueryError } from '@/components/page';
import { post } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ME_KEY, useMe } from '@/lib/session';
import { useBranding, useTenant } from '@/lib/tenant';

const STEPS = ['company', 'locale', 'brand'] as const;

/** First-run wizard: company name and address, region settings, logo and accent colour. */
export default function OnboardingPage() {
  const t = useT();
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const tenant = useTenant();
  const branding = useBranding();
  const [step, setStep] = React.useState(0);
  const finish = useMutation({
    mutationFn: () => post('/v1/tenant/onboarding/complete'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      router.replace('/');
    },
  });

  const current = STEPS[step]!;
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div className="flex min-h-dvh flex-col items-center bg-bg-subtle px-4 py-10">
      <main id="main" className="w-full max-w-xl">
        <p className="text-sm text-fg-muted tabular">
          {t('onboarding.step', { current: step + 1, total: STEPS.length })}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{t('onboarding.title')}</h1>
        <ol className="mt-4 flex gap-2" aria-label={t('onboarding.title')}>
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className="h-1 flex-1 rounded-full bg-bg-emphasis"
            >
              <span
                className={`block h-full rounded-full bg-fg transition-[width] duration-100 ${i <= step ? 'w-full' : 'w-0'}`}
              />
              <span className="sr-only">{t(`onboarding.${s}.title`)}</span>
            </li>
          ))}
        </ol>

        <section className="mt-8 rounded-md border border-border bg-bg p-6">
          <h2 className="text-lg font-semibold">{t(`onboarding.${current}.title`)}</h2>
          <p className="mt-1 mb-6 text-base text-fg-muted">{t(`onboarding.${current}.body`)}</p>
          {tenant.isPending || branding.isPending ? (
            <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : tenant.isError || branding.isError ? (
            <QueryError onRetry={() => void Promise.all([tenant.refetch(), branding.refetch()])} />
          ) : current === 'company' ? (
            <CompanyForm
              key="identity"
              tenant={tenant.data}
              sections={['identity']}
              submitLabel={t('common.continue')}
              onSaved={next}
            />
          ) : current === 'locale' ? (
            <CompanyForm
              key="region"
              tenant={tenant.data}
              sections={['region']}
              submitLabel={t('common.continue')}
              onSaved={next}
            />
          ) : (
            <>
              <BrandingForm
                branding={branding.data}
                sections={['logo', 'accent']}
                submitLabel={t('common.save')}
              />
              <div className="mt-8 flex justify-end border-t border-border pt-6">
                <Button size="lg" loading={finish.isPending} onClick={() => finish.mutate()}>
                  {t('onboarding.finish')}
                </Button>
              </div>
            </>
          )}
          {step > 0 ? (
            <Button variant="link" className="mt-4" onClick={() => setStep((s) => s - 1)}>
              {t('common.back')}
            </Button>
          ) : null}
        </section>
        <p className="mt-4 text-center text-sm text-fg-muted">{me.user.email}</p>
      </main>
    </div>
  );
}
