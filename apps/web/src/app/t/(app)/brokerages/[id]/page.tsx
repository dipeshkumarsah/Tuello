'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrokerageDto } from '@tuello/shared';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Skeleton,
  toast,
} from '@tuello/ui';
import { ArrowLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { FormMessage } from '@/components/auth-shell';
import { QueryError, RequirePermission } from '@/components/page';
import { ApiError, del, get, patch } from '@/lib/api';
import { useClients, usePriceListOptions } from '@/lib/crm';
import { useI18n } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { Notes } from '@/components/notes';

function BrokerageDetail() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const canPricing = useCan('pricing.read');
  const b = useQuery({
    queryKey: ['brokerage', id],
    queryFn: () => get<BrokerageDto>(`/v1/brokerages/${id}`),
  });
  const clients = useClients({ brokerageId: id, sort: 'name' });
  const priceLists = usePriceListOptions(canPricing);
  const [d, setD] = React.useState<BrokerageDto | null>(null);
  React.useEffect(() => setD(b.data ?? null), [b.data]);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const save = useMutation({
    mutationFn: () =>
      patch<BrokerageDto>(`/v1/brokerages/${id}`, {
        name: d!.name,
        email: d!.email ?? '',
        phone: d!.phone ?? '',
        website: d!.website ?? '',
        city: d!.city ?? '',
        priceListId: d!.priceListId,
      }),
    onSuccess: (x) => {
      qc.setQueryData(['brokerage', id], x);
      void qc.invalidateQueries({ queryKey: ['brokerages'] });
      toast({ title: t('settings.saved'), tone: 'success' });
      setError(null);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : String(e)),
  });
  const remove = useMutation({
    mutationFn: () => del(`/v1/brokerages/${id}`),
    onSuccess: () => router.replace('/brokerages'),
    onError: (e) => {
      setDeleting(false);
      toast({
        title: e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : String(e),
        tone: 'error',
      });
    },
  });
  if (b.isPending || !d) return <Skeleton className="h-64 w-full" />;
  if (b.isError) return <QueryError onRetry={() => void b.refetch()} />;
  const text = (k: keyof BrokerageDto) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD((x) => x && { ...x, [k]: e.target.value });
  const rows = clients.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/brokerages"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden /> {t('brokerages.title')}
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold">{b.data.name}</h1>
          {canManage ? (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              <Trash2 size={16} strokeWidth={1.5} aria-hidden /> {t('common.delete')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card className="p-5">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.name')} className="sm:col-span-2">
                {(ids) => <Input {...ids} value={d.name} onChange={text('name')} />}
              </Field>
              <Field label={t('common.email')}>
                {(ids) => <Input {...ids} value={d.email ?? ''} onChange={text('email')} />}
              </Field>
              <Field label={t('common.phone')}>
                {(ids) => <Input {...ids} value={d.phone ?? ''} onChange={text('phone')} />}
              </Field>
              <Field label={t('brokerages.website')}>
                {(ids) => <Input {...ids} value={d.website ?? ''} onChange={text('website')} />}
              </Field>
              <Field label={t('clients.city')}>
                {(ids) => <Input {...ids} value={d.city ?? ''} onChange={text('city')} />}
              </Field>
              {canPricing ? (
                <Field
                  label={t('common.priceList')}
                  hint={t('brokerages.priceListHint')}
                  className="sm:col-span-2"
                >
                  {(ids) => (
                    <Select
                      {...ids}
                      value={d.priceListId ?? 'none'}
                      onValueChange={(v) =>
                        setD((x) => x && { ...x, priceListId: v === 'none' ? null : v })
                      }
                      options={[
                        { value: 'none', label: t('common.standardPricing') },
                        ...(priceLists.data?.items ?? []).map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                    />
                  )}
                </Field>
              ) : null}
            </fieldset>
            <FormMessage>{error}</FormMessage>
            {canManage ? (
              <div>
                <Button type="submit" loading={save.isPending}>
                  {t('common.save')}
                </Button>
              </div>
            ) : null}
          </form>
        </Card>
        <Card>
          <CardHeader title={`${t('brokerages.clients')} (${b.data.clientCount ?? 0})`} />
          <ul className="divide-y divide-border">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex flex-col px-5 py-2.5 hover:bg-bg-subtle"
                >
                  <span className="font-medium">{c.displayName}</span>
                  <span className="text-sm text-fg-muted">{c.email}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <section>
        <h2 className="mb-3 text-md font-semibold">{t('clients.notes')}</h2>
        <Notes path={`/v1/brokerages/${id}`} />
      </section>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('common.confirmDelete', { name: b.data.name })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

export default function BrokeragePage() {
  return (
    <RequirePermission permission="clients.read">
      <BrokerageDetail />
    </RequirePermission>
  );
}
