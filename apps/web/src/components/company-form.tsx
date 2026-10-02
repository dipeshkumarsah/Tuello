'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  MEASUREMENT_UNITS,
  SUPPORTED_CURRENCIES,
  currencySchema,
  measurementUnitSchema,
  slugSchema,
  timeZoneSchema,
  type TenantDto,
} from '@tuello/shared';
import { Button, Combobox, Field, Input, Select, toast } from '@tuello/ui';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormMessage } from '@/components/auth-shell';
import { applyProblem, fieldMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { usePlatform } from '@/lib/platform';
import { timeZones, useUpdateTenant } from '@/lib/tenant';

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  timeZone: timeZoneSchema,
  currency: currencySchema,
  measurementUnit: measurementUnitSchema,
  taxLabel: z.string().trim().min(1).max(40),
});
type Values = z.infer<typeof schema>;
type Section = 'identity' | 'region';

/** Company identity (name, address) and region (time zone, currency, unit, tax label). */
export function CompanyForm({
  tenant,
  sections = ['identity', 'region'],
  submitLabel,
  onSaved,
  disabled,
}: {
  tenant: TenantDto;
  sections?: Section[];
  submitLabel?: string;
  onSaved?: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { baseDomain } = usePlatform();
  const update = useUpdateTenant();
  const [formError, setFormError] = React.useState<string | null>(null);
  const tzOptions = React.useMemo(
    () => timeZones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })),
    [],
  );
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: tenant.name,
      slug: tenant.slug,
      timeZone: tenant.timeZone,
      currency: tenant.currency as Values['currency'],
      measurementUnit: tenant.measurementUnit,
      taxLabel: tenant.taxLabel,
    },
  });
  const slug = form.watch('slug');
  const e = form.formState.errors;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.handleSubmit((v) => {
        setFormError(null);
        const changed = Object.fromEntries(
          Object.entries(v).filter(
            ([k, val]) => (tenant as unknown as Record<string, unknown>)[k] !== val,
          ),
        );
        if (Object.keys(changed).length === 0) return onSaved?.();
        update.mutate(changed, {
          onSuccess: (res) => {
            if (res.handoffUrl) return;
            toast({ title: t('settings.saved'), tone: 'success' });
            onSaved?.();
          },
          onError: (err) => setFormError(applyProblem(err, form.setError)),
        });
      })}
    >
      <fieldset disabled={disabled} className="contents">
        {sections.includes('identity') ? (
          <>
            <Field label={t('tenant.name')} error={fieldMessage(e.name?.message)}>
              {(ids) => <Input {...ids} {...form.register('name')} />}
            </Field>
            <Field
              label={t('tenant.slug')}
              error={fieldMessage(e.slug?.message)}
              hint={
                slug !== tenant.slug
                  ? t('onboarding.slugChange', { host: `${slug}.${baseDomain}` })
                  : `${slug}.${baseDomain}`
              }
            >
              {(ids) => (
                <Input
                  {...ids}
                  autoCapitalize="none"
                  spellCheck={false}
                  {...form.register('slug')}
                />
              )}
            </Field>
          </>
        ) : null}
        {sections.includes('region') ? (
          <>
            <Field label={t('tenant.timeZone')} error={fieldMessage(e.timeZone?.message)}>
              {(ids) => (
                <Controller
                  control={form.control}
                  name="timeZone"
                  render={({ field }) => (
                    <Combobox
                      {...ids}
                      value={field.value}
                      onValueChange={field.onChange}
                      options={tzOptions}
                    />
                  )}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('tenant.currency')} error={fieldMessage(e.currency?.message)}>
                {(ids) => (
                  <Controller
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <Select
                        {...ids}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
                      />
                    )}
                  />
                )}
              </Field>
              <Field
                label={t('tenant.measurementUnit')}
                error={fieldMessage(e.measurementUnit?.message)}
              >
                {(ids) => (
                  <Controller
                    control={form.control}
                    name="measurementUnit"
                    render={({ field }) => (
                      <Select
                        {...ids}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={MEASUREMENT_UNITS.map((u) => ({
                          value: u,
                          label: t(`tenant.measurementUnit.${u}`),
                        }))}
                      />
                    )}
                  />
                )}
              </Field>
            </div>
            <Field label={t('tenant.taxLabel')} error={fieldMessage(e.taxLabel?.message)}>
              {(ids) => <Input {...ids} className="max-w-xs" {...form.register('taxLabel')} />}
            </Field>
          </>
        ) : null}
        <FormMessage>{formError}</FormMessage>
        {!disabled ? (
          <div>
            <Button type="submit" loading={update.isPending}>
              {submitLabel ?? t('common.save')}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
