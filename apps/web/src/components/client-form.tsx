'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { clientInputSchema, type ClientDto, type DuplicateDto } from '@tuello/shared';
import {
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  Input,
} from '@tuello/ui';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { FormMessage } from '@/components/auth-shell';
import { ApiError, post } from '@/lib/api';
import { useBrokerageOptions } from '@/lib/crm';
import { fieldMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';

interface Draft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  brokerageId: string | null;
}

const EMPTY: Draft = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  company: '',
  brokerageId: null,
};

/** New-client dialog. Warns about likely duplicates (email, phone, similar name) before creating. */
export function NewClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (c: ClientDto) => void;
}) {
  const t = useT();
  const brokerages = useBrokerageOptions();
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const [probe, setProbe] = React.useState(draft);
  React.useEffect(() => {
    const id = setTimeout(() => setProbe(draft), 400);
    return () => clearTimeout(id);
  }, [draft]);
  const dupes = useQuery({
    queryKey: ['dupes', probe],
    queryFn: () => post<{ items: DuplicateDto[] }>('/v1/clients/duplicates/check', probe),
    enabled:
      open &&
      (!!probe.email || probe.phone.length >= 7 || (probe.firstName + probe.lastName).length >= 4),
  });

  const create = useMutation({
    mutationFn: () => post<ClientDto>('/v1/clients', draft),
    onSuccess: (c) => {
      setDraft(EMPTY);
      onCreated(c);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.problem.detail ?? err.problem.title);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" closeLabel={t('common.close')}>
        <DialogTitle>{t('clients.new')}</DialogTitle>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = clientInputSchema.safeParse(draft);
            if (!parsed.success) {
              setErrors(
                Object.fromEntries(
                  parsed.error.issues.map((i) => [
                    String(i.path[0]),
                    fieldMessage(i.message) ?? i.message,
                  ]),
                ),
              );
              return;
            }
            setErrors({});
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('clients.firstName')} error={errors.firstName}>
              {(ids) => (
                <Input {...ids} autoFocus value={draft.firstName} onChange={set('firstName')} />
              )}
            </Field>
            <Field label={t('clients.lastName')} error={errors.lastName}>
              {(ids) => <Input {...ids} value={draft.lastName} onChange={set('lastName')} />}
            </Field>
            <Field label={t('common.email')} error={errors.email}>
              {(ids) => <Input {...ids} type="email" value={draft.email} onChange={set('email')} />}
            </Field>
            <Field label={t('common.phone')} error={errors.phone}>
              {(ids) => <Input {...ids} type="tel" value={draft.phone} onChange={set('phone')} />}
            </Field>
            <Field label={t('clients.brokerage')} optional={t('common.optional')}>
              {(ids) => (
                <Combobox
                  {...ids}
                  value={draft.brokerageId}
                  onValueChange={(v) => setDraft((d) => ({ ...d, brokerageId: v }))}
                  options={(brokerages.data?.items ?? []).map((b) => ({
                    value: b.id,
                    label: b.name,
                  }))}
                  placeholder={t('common.none')}
                />
              )}
            </Field>
            <Field label={t('clients.company')} optional={t('common.optional')}>
              {(ids) => <Input {...ids} value={draft.company} onChange={set('company')} />}
            </Field>
          </div>
          {dupes.data?.items.length ? (
            <div
              role="status"
              className="flex flex-col gap-2 rounded-md border border-border-strong p-3"
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle size={16} strokeWidth={1.5} aria-hidden />{' '}
                {t('clients.possibleDuplicates')}
              </p>
              <p className="text-sm text-fg-muted">{t('clients.duplicateHint')}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {dupes.data.items.slice(0, 3).map((d) => (
                  <li key={d.client.id}>
                    <Link href={`/clients/${d.client.id}`} className="underline underline-offset-4">
                      {d.client.displayName}
                    </Link>{' '}
                    <span className="text-fg-muted">
                      {[d.client.email, d.client.brokerage].filter(Boolean).join(' · ')} (
                      {d.reasons.join(', ')})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <FormMessage>{formError}</FormMessage>
          <DialogFooter>
            <Button type="submit" loading={create.isPending}>
              {t('clients.new')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewBrokerageDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const [name, setName] = React.useState('');
  const [city, setCity] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/v1/brokerages', { name, city }),
    onSuccess: (b) => {
      setName('');
      setCity('');
      onCreated(b.id);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : String(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogTitle>{t('brokerages.new')}</DialogTitle>
        <DialogDescription>{t('brokerages.empty.body')}</DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError(t('validation.required'));
            create.mutate();
          }}
        >
          <Field label={t('common.name')} error={error}>
            {(ids) => (
              <Input {...ids} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label={t('clients.city')} optional={t('common.optional')}>
            {(ids) => <Input {...ids} value={city} onChange={(e) => setCity(e.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="submit" loading={create.isPending}>
              {t('brokerages.new')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
