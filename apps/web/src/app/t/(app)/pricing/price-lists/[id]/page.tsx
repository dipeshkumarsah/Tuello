'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItemKind, PriceListDto, PriceListInput } from '@tuello/shared';
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
import { MoneyInput, PercentInput } from '@/components/money-input';
import { QueryError, RequirePermission } from '@/components/page';
import { QuotePreview } from '@/components/quote-preview';
import { ApiError, del, get, patch, put } from '@/lib/api';
import { useInvalidatePricing } from '@/lib/catalog';
import { useI18n } from '@/lib/i18n';
import { priceableItems, usePricingCatalog, useTerritories } from '@/lib/pricing';
import { useCan } from '@/lib/session';

type Mode = 'standard' | 'fixed' | 'percent';
interface Row {
  mode: Mode;
  fixedPrice: number | null;
  percentOffBps: number | null;
}

const errText = (e: unknown) =>
  e instanceof ApiError
    ? (e.problem.detail ?? e.problem.errors?.map((x) => x.message).join(' ') ?? e.problem.title)
    : String(e);

function PriceListEditor() {
  const { t, money } = useI18n();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useCan('pricing.manage');
  const invalidate = useInvalidatePricing();
  const pl = useQuery({
    queryKey: ['price-list', id],
    queryFn: () => get<PriceListDto>(`/v1/price-lists/${id}`),
  });
  const catalog = usePricingCatalog();
  const territories = useTerritories();

  const [name, setName] = React.useState('');
  const [defaultBps, setDefaultBps] = React.useState<number | null>(0);
  const [waiveTravel, setWaiveTravel] = React.useState(false);
  const [active, setActive] = React.useState(true);
  const [rows, setRows] = React.useState<Record<string, Row>>({});
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!pl.data) return;
    setName(pl.data.name);
    setDefaultBps(pl.data.defaultPercentOffBps);
    setWaiveTravel(pl.data.waiveTravel);
    setActive(pl.data.active);
    setRows(
      Object.fromEntries(
        pl.data.entries.map((e) => [
          `${e.itemKind}:${e.itemId}`,
          {
            mode: e.fixedPrice != null ? 'fixed' : 'percent',
            fixedPrice: e.fixedPrice,
            percentOffBps: e.percentOffBps,
          },
        ]),
      ),
    );
  }, [pl.data]);

  const entries = Object.entries(rows)
    .filter(([, r]) =>
      r.mode === 'fixed'
        ? r.fixedPrice != null
        : r.mode === 'percent'
          ? r.percentOffBps != null
          : false,
    )
    .map(([key, r]) => {
      const [itemKind, itemId] = key.split(':') as [ItemKind, string];
      return {
        itemKind,
        itemId,
        fixedPrice: r.mode === 'fixed' ? r.fixedPrice : null,
        percentOffBps: r.mode === 'percent' ? r.percentOffBps : null,
      };
    });

  // The unsaved state, fed straight into the shared pricing engine for the live preview.
  const draft: PriceListInput = {
    id,
    name,
    defaultPercentOffBps: defaultBps ?? 0,
    waiveTravel,
    entries,
  };

  const save = useMutation({
    mutationFn: async () => {
      await patch(`/v1/price-lists/${id}`, {
        name,
        defaultPercentOffBps: defaultBps ?? 0,
        waiveTravel,
        active,
      });
      return put<PriceListDto>(`/v1/price-lists/${id}/entries`, { entries });
    },
    onSuccess: (x) => {
      qc.setQueryData(['price-list', id], x);
      invalidate();
      toast({ title: t('settings.saved'), tone: 'success' });
    },
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  const remove = useMutation({
    mutationFn: () => del(`/v1/price-lists/${id}`),
    onSuccess: () => {
      invalidate();
      router.replace('/pricing');
    },
    onError: (e) => {
      setDeleting(false);
      toast({ title: errText(e), tone: 'error' });
    },
  });

  if (pl.isError || catalog.isError)
    return <QueryError onRetry={() => void Promise.all([pl.refetch(), catalog.refetch()])} />;
  if (pl.isPending || catalog.isPending) return <Skeleton className="h-64 w-full" />;

  const items = priceableItems(catalog.data);
  const setRow = (key: string, patchRow: Partial<Row>) =>
    setRows((r) => ({
      ...r,
      [key]: {
        ...(r[key] ?? { mode: 'standard', fixedPrice: null, percentOffBps: null }),
        ...patchRow,
      },
    }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden /> {t('pricing.priceLists')}
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold">{pl.data.name}</h1>
          {canManage ? (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              <Trash2 size={16} strokeWidth={1.5} aria-hidden /> {t('common.delete')}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-fg-muted">
          {t('pricing.assigned', {
            clients: pl.data.clientCount,
            brokerages: pl.data.brokerageCount,
          })}
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <form
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Card className="p-5">
            <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.name')} className="sm:col-span-2">
                {(ids) => (
                  <Input {...ids} value={name} onChange={(e) => setName(e.target.value)} required />
                )}
              </Field>
              <Field label={t('pricing.defaultPercentOff')}>
                {(ids) => <PercentInput {...ids} value={defaultBps} onChange={setDefaultBps} />}
              </Field>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--tu-fg)]"
                    checked={waiveTravel}
                    onChange={(e) => setWaiveTravel(e.target.checked)}
                  />
                  {t('pricing.waiveTravel')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--tu-fg)]"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  {t('common.active')}
                </label>
              </div>
            </fieldset>
          </Card>
          <Card>
            <CardHeader title={t('pricing.entries')} description={t('pricing.entriesBody')} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular">
                <caption className="sr-only">{t('pricing.entries')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th scope="col" className="px-5 py-2 font-medium">
                      {t('pricing.item')}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {t('pricing.standardPrice')}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {t('pricing.mode')}
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium">
                      {t('pricing.value')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const key = `${i.kind}:${i.id}`;
                    const r = rows[key] ?? {
                      mode: 'standard' as Mode,
                      fixedPrice: null,
                      percentOffBps: null,
                    };
                    return (
                      <tr key={key} className="border-b border-border last:border-b-0">
                        <th scope="row" className="px-5 py-2 text-left font-normal">
                          {i.label}
                        </th>
                        <td className="px-2 py-2 text-fg-muted">{money(i.basePrice)}</td>
                        <td className="min-w-36 px-2 py-2">
                          <Select
                            aria-label={`${i.label}, ${t('pricing.mode')}`}
                            disabled={!canManage}
                            value={r.mode}
                            onValueChange={(v) => setRow(key, { mode: v as Mode })}
                            options={(['standard', 'fixed', 'percent'] as const).map((m) => ({
                              value: m,
                              label: t(`pricing.mode.${m}`),
                            }))}
                          />
                        </td>
                        <td className="min-w-36 px-5 py-2">
                          {r.mode === 'fixed' ? (
                            <MoneyInput
                              ariaLabel={`${i.label}, ${t('pricing.mode.fixed')}`}
                              value={r.fixedPrice}
                              onChange={(v) => setRow(key, { fixedPrice: v })}
                            />
                          ) : r.mode === 'percent' ? (
                            <PercentInput
                              ariaLabel={`${i.label}, ${t('pricing.mode.percent')}`}
                              value={r.percentOffBps}
                              onChange={(v) => setRow(key, { percentOffBps: v })}
                            />
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {canManage ? (
            <div>
              <Button type="submit" loading={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          ) : null}
        </form>
        <QuotePreview
          catalog={catalog.data}
          priceList={draft}
          territories={territories.data?.items ?? []}
        />
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('common.confirmDelete', { name: pl.data.name })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

export default function PriceListPage() {
  return (
    <RequirePermission permission="pricing.read">
      <PriceListEditor />
    </RequirePermission>
  );
}
