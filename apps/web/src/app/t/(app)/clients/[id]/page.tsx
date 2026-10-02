'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityDto, ClientDto, ContactDto, CursorPage, DuplicateDto } from '@tuello/shared';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Combobox,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@tuello/ui';
import { ArrowLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { FormMessage } from '@/components/auth-shell';
import { Notes } from '@/components/notes';
import { QueryError, RequirePermission } from '@/components/page';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useBrokerageOptions, usePriceListOptions, useTags } from '@/lib/crm';
import { useI18n } from '@/lib/i18n';
import { useCan } from '@/lib/session';

const errText = (e: unknown) =>
  e instanceof ApiError
    ? (e.problem.detail ?? e.problem.errors?.[0]?.message ?? e.problem.title)
    : String(e);

function DetailsForm({ client }: { client: ClientDto }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const canPricing = useCan('pricing.read');
  const brokerages = useBrokerageOptions();
  const priceLists = usePriceListOptions(canPricing);
  const [d, setD] = React.useState(client);
  React.useEffect(() => setD(client), [client]);
  const [error, setError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      patch<ClientDto>(`/v1/clients/${client.id}`, {
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email ?? '',
        phone: d.phone ?? '',
        company: d.company ?? '',
        title: d.title ?? '',
        brokerageId: d.brokerage?.id ?? null,
        priceListId: d.priceListId,
        status: d.status,
        addressLine1: d.addressLine1 ?? '',
        city: d.city ?? '',
        region: d.region ?? '',
        postalCode: d.postalCode ?? '',
        externalRef: d.externalRef ?? '',
      }),
    onSuccess: (c) => {
      qc.setQueryData(['client', client.id], c);
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['timeline', client.id] });
      toast({ title: t('settings.saved'), tone: 'success' });
      setError(null);
    },
    onError: (e) => setError(errText(e)),
  });
  const text = (k: keyof ClientDto) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('clients.firstName')}>
          {(ids) => <Input {...ids} value={d.firstName} onChange={text('firstName')} />}
        </Field>
        <Field label={t('clients.lastName')}>
          {(ids) => <Input {...ids} value={d.lastName} onChange={text('lastName')} />}
        </Field>
        <Field label={t('common.email')}>
          {(ids) => <Input {...ids} type="email" value={d.email ?? ''} onChange={text('email')} />}
        </Field>
        <Field label={t('common.phone')}>
          {(ids) => <Input {...ids} type="tel" value={d.phone ?? ''} onChange={text('phone')} />}
        </Field>
        <Field label={t('clients.brokerage')}>
          {(ids) => (
            <Combobox
              {...ids}
              value={d.brokerage?.id ?? ''}
              onValueChange={(v) => {
                const b = brokerages.data?.items.find((x) => x.id === v);
                setD((x) => ({ ...x, brokerage: b ? { id: b.id, name: b.name } : null }));
              }}
              options={[
                { value: '', label: t('common.none') },
                ...(brokerages.data?.items ?? []).map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          )}
        </Field>
        {canPricing ? (
          <Field label={t('common.priceList')}>
            {(ids) => (
              <Select
                {...ids}
                value={d.priceListId ?? 'none'}
                onValueChange={(v) => setD((x) => ({ ...x, priceListId: v === 'none' ? null : v }))}
                options={[
                  { value: 'none', label: t('common.standardPricing') },
                  ...(priceLists.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            )}
          </Field>
        ) : null}
        <Field label={t('clients.company')}>
          {(ids) => <Input {...ids} value={d.company ?? ''} onChange={text('company')} />}
        </Field>
        <Field label={t('clients.jobTitle')}>
          {(ids) => <Input {...ids} value={d.title ?? ''} onChange={text('title')} />}
        </Field>
        <Field label={t('clients.address')} className="sm:col-span-2">
          {(ids) => <Input {...ids} value={d.addressLine1 ?? ''} onChange={text('addressLine1')} />}
        </Field>
        <Field label={t('clients.city')}>
          {(ids) => <Input {...ids} value={d.city ?? ''} onChange={text('city')} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('clients.region')}>
            {(ids) => <Input {...ids} value={d.region ?? ''} onChange={text('region')} />}
          </Field>
          <Field label={t('clients.postalCode')}>
            {(ids) => <Input {...ids} value={d.postalCode ?? ''} onChange={text('postalCode')} />}
          </Field>
        </div>
        <Field label={t('clients.externalRef')}>
          {(ids) => <Input {...ids} value={d.externalRef ?? ''} onChange={text('externalRef')} />}
        </Field>
        <Field label={t('common.status')}>
          {(ids) => (
            <Select
              {...ids}
              value={d.status}
              onValueChange={(v) => setD((x) => ({ ...x, status: v as ClientDto['status'] }))}
              options={[
                { value: 'active', label: t('common.active') },
                { value: 'archived', label: t('common.archived') },
              ]}
            />
          )}
        </Field>
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
  );
}

function TagEditor({ client }: { client: ClientDto }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const tags = useTags();
  const canManage = useCan('clients.manage');
  const update = useMutation({
    mutationFn: (tagIds: string[]) => patch<ClientDto>(`/v1/clients/${client.id}`, { tagIds }),
    onMutate: async (tagIds) => {
      // Optimistic: tags appear immediately.
      const prev = qc.getQueryData<ClientDto>(['client', client.id]);
      const all = tags.data?.items ?? [];
      qc.setQueryData<ClientDto>(
        ['client', client.id],
        (c) => c && { ...c, tags: all.filter((tg) => tagIds.includes(tg.id)) },
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(['client', client.id], ctx?.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['timeline', client.id] }),
  });
  const createTag = useMutation({
    mutationFn: (name: string) => post<{ id: string }>('/v1/tags', { name }),
  });
  const ids = client.tags.map((x) => x.id);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {client.tags.map((tg) => (
        <Badge key={tg.id} className="gap-1">
          {tg.name}
          {canManage ? (
            <button
              type="button"
              aria-label={`${t('common.remove')} ${tg.name}`}
              className="text-fg-muted hover:text-fg"
              onClick={() => update.mutate(ids.filter((x) => x !== tg.id))}
            >
              ×
            </button>
          ) : null}
        </Badge>
      ))}
      {canManage ? (
        <Combobox
          value={null}
          onValueChange={async (v) => {
            if (v.startsWith('new:')) {
              const tag = await createTag.mutateAsync(v.slice(4));
              await qc.invalidateQueries({ queryKey: ['tags'] });
              update.mutate([...ids, tag.id]);
            } else if (!ids.includes(v)) update.mutate([...ids, v]);
          }}
          options={(tags.data?.items ?? [])
            .filter((tg) => !ids.includes(tg.id))
            .map((tg) => ({ value: tg.id, label: tg.name }))}
          placeholder={`+ ${t('clients.tags')}`}
          aria-label={t('clients.addTag')}
          className="h-7 w-36 text-sm"
          emptyText={t('clients.newTag')}
        />
      ) : null}
    </div>
  );
}

function Contacts({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const contacts = useQuery({
    queryKey: ['contacts', clientId],
    queryFn: () => get<{ items: ContactDto[] }>(`/v1/clients/${clientId}/contacts`),
  });
  const [draft, setDraft] = React.useState({ name: '', role: '', email: '', phone: '' });
  const add = useMutation({
    mutationFn: () => post(`/v1/clients/${clientId}/contacts`, draft),
    onSuccess: () => {
      setDraft({ name: '', role: '', email: '', phone: '' });
      void qc.invalidateQueries({ queryKey: ['contacts', clientId] });
      void qc.invalidateQueries({ queryKey: ['timeline', clientId] });
    },
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/clients/${clientId}/contacts/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contacts', clientId] }),
  });
  return (
    <div className="flex flex-col gap-4">
      {contacts.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : contacts.data?.items.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {contacts.data.items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex flex-col">
                <span className="font-medium">
                  {c.name}{' '}
                  {c.role ? <span className="font-normal text-fg-muted">· {c.role}</span> : null}
                </span>
                <span className="text-sm text-fg-muted">
                  {[c.email, c.phone].filter(Boolean).join(' · ')}
                </span>
              </div>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('common.remove')} ${c.name}`}
                  onClick={() => remove.mutate(c.id)}
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted">{t('common.none')}</p>
      )}
      {canManage ? (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) add.mutate();
          }}
        >
          <Field label={t('common.name')}>
            {(ids) => (
              <Input
                {...ids}
                value={draft.name}
                onChange={(e) => setDraft((x) => ({ ...x, name: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t('clients.role')}>
            {(ids) => (
              <Input
                {...ids}
                value={draft.role}
                onChange={(e) => setDraft((x) => ({ ...x, role: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t('common.email')}>
            {(ids) => (
              <Input
                {...ids}
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((x) => ({ ...x, email: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t('common.phone')}>
            {(ids) => (
              <Input
                {...ids}
                value={draft.phone}
                onChange={(e) => setDraft((x) => ({ ...x, phone: e.target.value }))}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" loading={add.isPending}>
            {t('clients.addContact')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function Timeline({ clientId }: { clientId: string }) {
  const { t, dateTime } = useI18n();
  const items = useQuery({
    queryKey: ['timeline', clientId],
    queryFn: () => get<CursorPage<ActivityDto>>(`/v1/clients/${clientId}/timeline?limit=100`),
  });
  if (items.isPending) return <Skeleton className="h-32 w-full" />;
  return (
    <ol className="relative flex flex-col gap-4 border-l border-border pl-5">
      {items.data?.items.map((a) => (
        <li key={a.id} className="relative">
          <span
            aria-hidden
            className="absolute top-1.5 -left-[25px] h-2 w-2 rounded-full border border-fg bg-bg"
          />
          <p>
            {t(`activity.${a.type}`, {
              fields: Array.isArray(a.data.fields) ? (a.data.fields as string[]).join(', ') : '',
              name: String(a.data.name ?? ''),
              sourceName: String(a.data.sourceName ?? ''),
            })}
          </p>
          <p className="text-sm text-fg-muted">
            {a.actor?.name ? `${a.actor.name} · ` : ''}
            <span className="tabular">{dateTime(a.occurredAt)}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

function Duplicates({ client }: { client: ClientDto }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const dupes = useQuery({
    queryKey: ['duplicates', client.id],
    queryFn: () => get<{ items: DuplicateDto[] }>(`/v1/clients/${client.id}/duplicates`),
  });
  const [merging, setMerging] = React.useState<DuplicateDto | null>(null);
  const merge = useMutation({
    mutationFn: (sourceId: string) =>
      post<ClientDto>(`/v1/clients/${client.id}/merge`, { sourceId }),
    onSuccess: (c) => {
      setMerging(null);
      qc.setQueryData(['client', client.id], c);
      for (const k of ['duplicates', 'contacts', 'timeline', 'clients'])
        void qc.invalidateQueries({ queryKey: [k] });
      void qc.invalidateQueries({ queryKey: ['notes'] });
      toast({ title: t('clients.merged'), tone: 'success' });
    },
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  if (!dupes.data?.items.length) return null;
  return (
    <Card>
      <CardHeader title={t('clients.possibleDuplicates')} />
      <ul className="divide-y divide-border">
        {dupes.data.items.map((d) => (
          <li
            key={d.client.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div className="flex flex-col">
              <Link
                href={`/clients/${d.client.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {d.client.displayName}
              </Link>
              <span className="text-sm text-fg-muted">
                {[d.client.email, d.client.phone, d.client.brokerage].filter(Boolean).join(' · ')} ·{' '}
                {d.reasons.join(', ')}
              </span>
            </div>
            {canManage ? (
              <Button variant="secondary" size="sm" onClick={() => setMerging(d)}>
                {t('clients.mergeInto')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!merging}
        onOpenChange={(o) => !o && setMerging(null)}
        title={t('clients.mergeInto')}
        description={
          merging
            ? t('clients.mergeConfirm', {
                source: merging.client.displayName,
                target: client.displayName,
              })
            : undefined
        }
        confirmLabel={t('clients.mergeInto')}
        cancelLabel={t('common.cancel')}
        loading={merge.isPending}
        onConfirm={() => merging && merge.mutate(merging.client.id)}
      />
    </Card>
  );
}

function ClientDetail() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const client = useQuery({
    queryKey: ['client', id],
    queryFn: () => get<ClientDto>(`/v1/clients/${id}`),
    retry: false,
  });
  const [deleting, setDeleting] = React.useState(false);
  const remove = useMutation({
    mutationFn: () => del(`/v1/clients/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      router.replace('/clients');
    },
  });

  if (client.isPending) {
    return (
      <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (client.isError) {
    const merged =
      client.error instanceof ApiError && client.error.problem.detail?.startsWith('Merged into ');
    if (merged) {
      const target = (client.error as ApiError).problem.detail!.replace('Merged into ', '');
      router.replace(`/clients/${target}`);
      return null;
    }
    return <QueryError onRetry={() => void client.refetch()} />;
  }
  const c = client.data;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden /> {t('clients.title')}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold">{c.displayName}</h1>
            <p className="text-fg-muted">
              {[c.title, c.company].filter(Boolean).join(' · ')}
              {(c.title || c.company) && c.brokerage ? ' · ' : null}
              {c.brokerage ? (
                <Link
                  href={`/brokerages/${c.brokerage.id}`}
                  className="underline underline-offset-4"
                >
                  {c.brokerage.name}
                </Link>
              ) : null}
            </p>
            <TagEditor client={c} />
          </div>
          {canManage ? (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              <Trash2 size={16} strokeWidth={1.5} aria-hidden /> {t('common.delete')}
            </Button>
          ) : null}
        </div>
      </div>
      <Duplicates client={c} />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{t('clients.details')}</TabsTrigger>
          <TabsTrigger value="contacts">{t('clients.contacts')}</TabsTrigger>
          <TabsTrigger value="notes">{t('clients.notes')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('clients.timeline')}</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <DetailsForm client={c} />
        </TabsContent>
        <TabsContent value="contacts">
          <Contacts clientId={c.id} />
        </TabsContent>
        <TabsContent value="notes">
          <Notes
            path={`/v1/clients/${c.id}`}
            onAdded={() => void qc.invalidateQueries({ queryKey: ['timeline', c.id] })}
          />
        </TabsContent>
        <TabsContent value="timeline">
          <Timeline clientId={c.id} />
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('common.confirmDelete', { name: c.displayName })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

export default function ClientDetailPage() {
  return (
    <RequirePermission permission="clients.read">
      <ClientDetail />
    </RequirePermission>
  );
}
