'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { BrokerageDto, CursorPage } from '@tuello/shared';
import { Button, EmptyState, Input, SkeletonRows } from '@tuello/ui';
import { Building2, Download, Plus, Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { NewBrokerageDialog } from '@/components/client-form';
import { PageHeader, QueryError, RequirePermission } from '@/components/page';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useExport } from '@/lib/use-export';

function Brokerages() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const list = useInfiniteQuery({
    queryKey: ['brokerages', debounced],
    queryFn: ({ pageParam }) =>
      get<CursorPage<BrokerageDto>>(
        `/v1/brokerages?limit=50${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const exporter = useExport('/v1/brokerages/export');
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader
        title={t('brokerages.title')}
        action={
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <Button variant="secondary" asChild>
                <Link href="/imports?entity=brokerages">
                  <Upload size={16} strokeWidth={1.5} aria-hidden /> {t('common.import')}
                </Link>
              </Button>
            ) : null}
            <Button variant="secondary" loading={exporter.busy} onClick={() => void exporter.run()}>
              <Download size={16} strokeWidth={1.5} aria-hidden /> {t('common.export')}
            </Button>
            {canManage ? (
              <Button onClick={() => setOpen(true)}>
                <Plus size={16} strokeWidth={1.5} aria-hidden /> {t('brokerages.new')}
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="relative mb-4 w-full max-w-sm">
        <Search
          size={16}
          strokeWidth={1.5}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('common.search')}
          aria-label={t('common.search')}
          className="pl-9"
        />
      </div>
      {list.isPending ? (
        <SkeletonRows rows={6} label={t('common.loading')} />
      ) : list.isError ? (
        <QueryError onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        debounced ? (
          <p className="py-12 text-center text-fg-muted">{t('clients.noResults')}</p>
        ) : (
          <EmptyState
            icon={Building2}
            title={t('brokerages.empty.title')}
            body={t('brokerages.empty.body')}
            action={
              canManage ? (
                <Button onClick={() => setOpen(true)}>{t('brokerages.new')}</Button>
              ) : undefined
            }
          />
        )
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((b) => (
            <li key={b.id}>
              <Link
                href={`/brokerages/${b.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg-subtle"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-sm text-fg-muted">
                    {[b.city, b.email, b.phone].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="text-sm text-fg-muted tabular">
                  {b.clientCount ?? 0} {t('brokerages.clients').toLowerCase()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      ) : null}
      <NewBrokerageDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => {
          setOpen(false);
          void qc.invalidateQueries({ queryKey: ['brokerages'] });
          router.push(`/brokerages/${id}`);
        }}
      />
    </>
  );
}

export default function BrokeragesPage() {
  return (
    <RequirePermission permission="clients.read">
      <Brokerages />
    </RequirePermission>
  );
}
