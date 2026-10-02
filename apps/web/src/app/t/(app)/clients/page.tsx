'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ClientFilters } from '@tuello/shared';
import {
  Badge,
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonRows,
  toast,
} from '@tuello/ui';
import { Bookmark, Contact, Download, Plus, Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { NewClientDialog } from '@/components/client-form';
import { PageHeader, QueryError, RequirePermission } from '@/components/page';
import { post } from '@/lib/api';
import { useBrokerageOptions, useClients, useSavedViews, useTags } from '@/lib/crm';
import { useI18n } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useExport } from '@/lib/use-export';

type Filters = Partial<ClientFilters>;

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

function Clients() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const [q, setQ] = React.useState('');
  const [filters, setFilters] = React.useState<Filters>({ sort: 'name' });
  const [newOpen, setNewOpen] = React.useState(false);
  const query = { ...filters, q: useDebounced(q.trim(), 250) || undefined };
  const clients = useClients(query);
  const brokerages = useBrokerageOptions();
  const tags = useTags();
  const views = useSavedViews('clients');
  const exporter = useExport('/v1/clients/export');
  const saveView = useMutation({
    mutationFn: (name: string) =>
      post('/v1/saved-views', {
        entity: 'clients',
        name,
        filters: { ...filters, q: q || undefined },
      }),
    onSuccess: () => {
      setViewName(null);
      toast({ title: t('settings.saved'), tone: 'success' });
      void qc.invalidateQueries({ queryKey: ['saved-views'] });
    },
  });
  const [viewName, setViewName] = React.useState<string | null>(null);

  const rows = clients.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(query.q || filters.brokerageId || filters.tagId || filters.status);

  // "/" focuses search, a common list shortcut.
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(el.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <PageHeader
        title={t('clients.title')}
        description={t('clients.body')}
        action={
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <Button variant="secondary" asChild>
                <Link href="/imports?entity=clients">
                  <Upload size={16} strokeWidth={1.5} aria-hidden /> {t('common.import')}
                </Link>
              </Button>
            ) : null}
            <Button
              variant="secondary"
              loading={exporter.busy}
              onClick={() => void exporter.run({ filters })}
            >
              <Download size={16} strokeWidth={1.5} aria-hidden /> {t('common.export')}
            </Button>
            {canManage ? (
              <Button onClick={() => setNewOpen(true)}>
                <Plus size={16} strokeWidth={1.5} aria-hidden /> {t('clients.new')}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
          />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('clients.searchPlaceholder')}
            aria-label={t('common.search')}
            className="pl-9"
          />
        </div>
        <Combobox
          value={filters.brokerageId ?? null}
          onValueChange={(v) => setFilters((f) => ({ ...f, brokerageId: v || undefined }))}
          options={[
            { value: '', label: t('common.all') },
            ...(brokerages.data?.items ?? []).map((b) => ({ value: b.id, label: b.name })),
          ]}
          placeholder={t('clients.brokerage')}
          aria-label={t('clients.brokerage')}
          className="w-48"
        />
        <Select
          aria-label={t('clients.tags')}
          value={filters.tagId ?? 'all'}
          onValueChange={(v) => setFilters((f) => ({ ...f, tagId: v === 'all' ? undefined : v }))}
          options={[
            { value: 'all', label: `${t('clients.tags')}: ${t('common.all')}` },
            ...(tags.data?.items ?? []).map((tg) => ({ value: tg.id, label: tg.name })),
          ]}
          className="w-44"
        />
        <Select
          aria-label={t('common.status')}
          value={filters.status ?? 'all'}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              status: v === 'all' ? undefined : (v as 'active' | 'archived'),
            }))
          }
          options={[
            { value: 'all', label: `${t('common.status')}: ${t('common.all')}` },
            { value: 'active', label: t('common.active') },
            { value: 'archived', label: t('common.archived') },
          ]}
          className="w-40"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <Bookmark size={16} strokeWidth={1.5} aria-hidden /> {t('common.views')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('common.views')}</DropdownMenuLabel>
            {(views.data?.items ?? []).map((v) => (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => {
                  const { q: vq, ...rest } = v.filters as Filters & { q?: string };
                  setFilters(rest);
                  setQ(vq ?? '');
                }}
              >
                {v.name} {v.shared ? <Badge className="ml-auto">{t('settings.team')}</Badge> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setViewName('')}>
              {t('common.saveView')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {clients.isPending ? (
        <SkeletonRows rows={8} label={t('common.loading')} />
      ) : clients.isError ? (
        <QueryError onRetry={() => void clients.refetch()} />
      ) : rows.length === 0 ? (
        filtered ? (
          <p className="py-12 text-center text-fg-muted">{t('clients.noResults')}</p>
        ) : (
          <EmptyState
            icon={Contact}
            title={t('clients.empty.title')}
            body={t('clients.empty.body')}
            action={
              canManage ? (
                <Button onClick={() => setNewOpen(true)}>{t('clients.new')}</Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-base tabular">
            <caption className="sr-only">{t('clients.title')}</caption>
            <thead className="bg-bg-subtle">
              <tr className="border-b border-border text-left text-sm text-fg-muted">
                <th scope="col" className="h-9 px-3 font-medium">
                  {t('common.name')}
                </th>
                <th scope="col" className="h-9 px-3 font-medium">
                  {t('common.email')}
                </th>
                <th scope="col" className="hidden h-9 px-3 font-medium md:table-cell">
                  {t('common.phone')}
                </th>
                <th scope="col" className="hidden h-9 px-3 font-medium lg:table-cell">
                  {t('clients.brokerage')}
                </th>
                <th scope="col" className="hidden h-9 px-3 font-medium lg:table-cell">
                  {t('clients.tags')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-bg-subtle"
                  onClick={() => router.push(`/clients/${c.id}`)}
                >
                  <td className="h-10 px-3">
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.displayName}
                    </Link>
                    {c.status === 'archived' ? (
                      <span className="ml-2 text-sm text-fg-muted">({t('common.archived')})</span>
                    ) : null}
                  </td>
                  <td className="h-10 px-3 text-fg-muted">{c.email}</td>
                  <td className="hidden h-10 px-3 text-fg-muted md:table-cell">{c.phone}</td>
                  <td className="hidden h-10 px-3 lg:table-cell">{c.brokerage?.name}</td>
                  <td className="hidden h-10 px-3 lg:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((tg) => (
                        <Badge key={tg.id}>{tg.name}</Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {clients.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={clients.isFetchingNextPage}
            onClick={() => void clients.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      ) : null}
      <Dialog open={viewName !== null} onOpenChange={(o) => !o && setViewName(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogTitle>{t('common.saveView')}</DialogTitle>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (viewName?.trim()) saveView.mutate(viewName.trim());
            }}
          >
            <Field label={t('common.name')}>
              {(ids) => (
                <Input
                  {...ids}
                  autoFocus
                  required
                  maxLength={80}
                  value={viewName ?? ''}
                  onChange={(e) => setViewName(e.target.value)}
                />
              )}
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setViewName(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={saveView.isPending}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <NewClientDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(c) => {
          setNewOpen(false);
          void qc.invalidateQueries({ queryKey: ['clients'] });
          router.push(`/clients/${c.id}`);
        }}
      />
    </>
  );
}

export default function ClientsPage() {
  return (
    <RequirePermission permission="clients.read">
      <Clients />
    </RequirePermission>
  );
}
