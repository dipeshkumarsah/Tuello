'use client';

import { useMutation } from '@tanstack/react-query';
import type { ItemKind, PricingCatalog } from '@tuello/shared';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Combobox,
  Field,
  Input,
  Select,
  Status,
  toast,
} from '@tuello/ui';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { MoneyInput, PercentInput } from '@/components/money-input';
import { ApiError, del, post, put } from '@/lib/api';
import { useInvalidatePricing } from '@/lib/catalog';
import { useI18n } from '@/lib/i18n';
import {
  priceableItems,
  useCoupons,
  usePriceLists,
  usePriceRules,
  useTaxRates,
  useTerritories,
  useTravelRules,
} from '@/lib/pricing';
import { useCan } from '@/lib/session';

const errText = (e: unknown) =>
  e instanceof ApiError
    ? (e.problem.detail ?? e.problem.errors?.map((x) => x.message).join(' ') ?? e.problem.title)
    : String(e);
const fail = (e: unknown) => toast({ title: errText(e), tone: 'error' });

// ----------------------------------------------------------------------------- price grid

export function PriceGrid({ catalog }: { catalog: PricingCatalog }) {
  const { t } = useI18n();
  const canManage = useCan('pricing.manage');
  const invalidate = useInvalidatePricing();
  const rules = usePriceRules();
  const items = priceableItems(catalog);
  const [itemKey, setItemKey] = React.useState(items[0] ? `${items[0].kind}:${items[0].id}` : '');
  const [kind, id] = itemKey.split(':') as [ItemKind, string];
  const item = items.find((i) => i.kind === kind && i.id === id);
  const cellKey = (band: string | null, type: string | null) => `${band ?? '*'}|${type ?? '*'}`;
  const [cells, setCells] = React.useState<Record<string, number | null>>({});
  React.useEffect(() => {
    const next: Record<string, number | null> = {};
    for (const r of rules.data?.items ?? [])
      if (r.itemKind === kind && r.itemId === id)
        next[cellKey(r.sizeBandId, r.propertyTypeId)] = r.price;
    setCells(next);
  }, [rules.data, kind, id]);
  const save = useMutation({
    mutationFn: () =>
      put('/v1/price-rules', {
        itemKind: kind,
        itemId: id,
        rules: Object.entries(cells)
          .filter(([, price]) => price != null)
          .map(([key, price]) => {
            const [b, ty] = key.split('|');
            return {
              sizeBandId: b === '*' ? null : b,
              propertyTypeId: ty === '*' ? null : ty,
              price,
            };
          }),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: t('settings.saved'), tone: 'success' });
    },
    onError: fail,
  });
  if (!items.length) return <p className="text-fg-muted">{t('catalog.empty.title')}</p>;
  const columns: Array<{ id: string | null; name: string }> = [
    { id: null, name: t('pricing.anyType') },
    ...catalog.propertyTypes.map((p) => ({ id: p.id, name: p.name })),
  ];
  const rows: Array<{ id: string | null; name: string }> = [
    ...catalog.sizeBands.map((b) => ({ id: b.id, name: b.name })),
    { id: null, name: t('pricing.anySize') },
  ];
  return (
    <Card>
      <CardHeader title={t('pricing.grid')} description={t('pricing.gridBody')} />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('pricing.item')} className="w-full max-w-md">
            {(ids) => (
              <Combobox
                {...ids}
                value={itemKey}
                onValueChange={setItemKey}
                options={items.map((i) => ({ value: `${i.kind}:${i.id}`, label: i.label }))}
              />
            )}
          </Field>
          {item ? (
            <span className="pb-2 text-sm text-fg-muted">
              {t('catalog.basePrice')}:{' '}
              {new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: catalog.currency,
              }).format(item.basePrice / 100)}
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm tabular">
            <caption className="sr-only">{t('pricing.grid')}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 bg-bg p-2 text-left font-medium text-fg-muted"
                />
                {columns.map((c) => (
                  <th
                    key={c.id ?? 'any'}
                    scope="col"
                    className="min-w-36 p-2 text-left font-medium text-fg-muted"
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id ?? 'any'} className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 bg-bg p-2 text-left font-medium whitespace-nowrap"
                  >
                    {r.name}
                  </th>
                  {columns.map((c) => {
                    const key = cellKey(r.id, c.id);
                    if (r.id === null && c.id === null)
                      return (
                        <td key={key} className="p-2 text-fg-muted">
                          —
                        </td>
                      );
                    return (
                      <td key={key} className="p-1">
                        <MoneyInput
                          ariaLabel={`${r.name}, ${c.name}`}
                          value={cells[key] ?? null}
                          onChange={(v) => setCells((x) => ({ ...x, [key]: v }))}
                          className="w-32"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <div>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------- size bands, prop. types

export function SizeBands({ catalog }: { catalog: PricingCatalog }) {
  const { t, area } = useI18n();
  const canManage = useCan('pricing.manage');
  const invalidate = useInvalidatePricing();
  const [d, setD] = React.useState({ name: '', min: '', max: '' });
  const add = useMutation({
    mutationFn: () =>
      post('/v1/size-bands', {
        name: d.name,
        minSize: Number(d.min),
        maxSize: d.max ? Number(d.max) : null,
      }),
    onSuccess: () => {
      setD({ name: '', min: '', max: '' });
      invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/size-bands/${id}`),
    onSuccess: invalidate,
    onError: fail,
  });
  const [typeName, setTypeName] = React.useState('');
  const addType = useMutation({
    mutationFn: () =>
      post('/v1/property-types', {
        name: typeName,
        key: typeName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
      }),
    onSuccess: () => {
      setTypeName('');
      invalidate();
    },
    onError: fail,
  });
  const removeType = useMutation({
    mutationFn: (id: string) => del(`/v1/property-types/${id}`),
    onSuccess: invalidate,
    onError: fail,
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={t('pricing.sizeBands')} />
        <ul className="divide-y divide-border">
          {catalog.sizeBands.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-5 py-2 tabular">
              <span>
                {b.name}
                <span className="ml-2 text-sm text-fg-muted">
                  {area(b.minSize)} – {b.maxSize == null ? '∞' : area(b.maxSize)}
                </span>
              </span>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('common.delete')} ${b.name}`}
                  onClick={() => remove.mutate(b.id)}
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="grid gap-3 border-t border-border p-5 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label={t('common.name')}>
              {(ids) => (
                <Input
                  {...ids}
                  value={d.name}
                  onChange={(e) => setD({ ...d, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('pricing.from')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={d.min}
                  onChange={(e) => setD({ ...d, min: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
            <Field label={t('pricing.to')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  placeholder="∞"
                  value={d.max}
                  onChange={(e) => setD({ ...d, max: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
            <Button type="submit" variant="secondary" loading={add.isPending}>
              {t('common.add')}
            </Button>
          </form>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t('pricing.propertyTypes')} />
        <ul className="divide-y divide-border">
          {catalog.propertyTypes.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-5 py-2">
              {p.name}
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('common.delete')} ${p.name}`}
                  onClick={() => removeType.mutate(p.id)}
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="flex gap-2 border-t border-border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (typeName.trim()) addType.mutate();
            }}
          >
            <Input
              aria-label={t('pricing.propertyTypes')}
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
            />
            <Button type="submit" variant="secondary" loading={addType.isPending}>
              {t('common.add')}
            </Button>
          </form>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- price lists

export function PriceLists() {
  const { t } = useI18n();
  const canManage = useCan('pricing.manage');
  const lists = usePriceLists();
  const router = useRouter();
  const invalidate = useInvalidatePricing();
  const [name, setName] = React.useState('');
  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/v1/price-lists', { name }),
    onSuccess: (pl) => {
      invalidate();
      router.push(`/pricing/price-lists/${pl.id}`);
    },
    onError: fail,
  });
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {(lists.data?.items ?? []).map((pl) => (
          <li key={pl.id}>
            <Link
              href={`/pricing/price-lists/${pl.id}`}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-bg-subtle"
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {pl.name} {!pl.active ? <Badge>{t('common.inactive')}</Badge> : null}
                </span>
                <span className="text-sm text-fg-muted">
                  {t('pricing.assigned', {
                    clients: pl.clientCount,
                    brokerages: pl.brokerageCount,
                  })}
                </span>
              </span>
              <span className="text-sm text-fg-muted tabular">
                {pl.entries.length} ·{' '}
                {pl.defaultPercentOffBps ? `−${pl.defaultPercentOffBps / 100}%` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {canManage ? (
        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input
            aria-label={t('pricing.newPriceList')}
            placeholder={t('pricing.newPriceList')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" loading={create.isPending}>
            {t('common.add')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------------------- coupons

export function Coupons() {
  const { t, money, dateTime } = useI18n();
  const canManage = useCan('pricing.manage');
  const coupons = useCoupons();
  const invalidate = useInvalidatePricing();
  const empty = {
    code: '',
    kind: 'percent' as 'percent' | 'fixed',
    percent: 1000 as number | null,
    amount: null as number | null,
    min: null as number | null,
    starts: '',
    expires: '',
    max: '',
    perClient: '',
  };
  const [d, setD] = React.useState(empty);
  const add = useMutation({
    mutationFn: () =>
      post('/v1/coupons', {
        code: d.code,
        kind: d.kind,
        percentOffBps: d.kind === 'percent' ? d.percent : null,
        amountOff: d.kind === 'fixed' ? d.amount : null,
        minSubtotal: d.min,
        startsAt: d.starts ? new Date(d.starts).toISOString() : null,
        expiresAt: d.expires ? new Date(d.expires).toISOString() : null,
        maxRedemptions: d.max ? Number(d.max) : null,
        maxPerClient: d.perClient ? Number(d.perClient) : null,
      }),
    onSuccess: () => {
      setD(empty);
      invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/coupons/${id}`),
    onSuccess: invalidate,
  });
  const now = Date.now();
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {(coupons.data?.items ?? []).map((c) => {
          const expired = c.expiresAt && Date.parse(c.expiresAt) <= now;
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="flex flex-col">
                <span className="font-mono font-medium">{c.code}</span>
                <span className="text-sm text-fg-muted tabular">
                  {c.kind === 'percent'
                    ? `${(c.percentOffBps ?? 0) / 100}%`
                    : money(c.amountOff ?? 0)}
                  {c.minSubtotal ? ` · ≥ ${money(c.minSubtotal)}` : ''}
                  {c.expiresAt
                    ? ` · ${t('pricing.expiresAt')} ${dateTime(c.expiresAt, { dateStyle: 'medium' })}`
                    : ''}
                  {` · ${t('pricing.redeemed', { n: c.redemptionCount })}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}`}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <Status
                  fill={!c.active || expired ? 'outline' : 'solid'}
                  label={
                    expired
                      ? t('quote.coupon.expired')
                      : c.active
                        ? t('common.active')
                        : t('common.inactive')
                  }
                />
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('common.delete')} ${c.code}`}
                    onClick={() => remove.mutate(c.id)}
                  >
                    <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {canManage ? (
        <Card>
          <CardHeader title={t('pricing.newCoupon')} />
          <form
            className="grid gap-3 p-5 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label={t('pricing.couponCode')}>
              {(ids) => (
                <Input
                  {...ids}
                  className="font-mono uppercase"
                  value={d.code}
                  onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
                />
              )}
            </Field>
            <Field label={t('pricing.couponKind')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={d.kind}
                  onValueChange={(v) => setD({ ...d, kind: v as 'percent' | 'fixed' })}
                  options={[
                    { value: 'percent', label: t('pricing.percentOff') },
                    { value: 'fixed', label: t('pricing.amountOff') },
                  ]}
                />
              )}
            </Field>
            {d.kind === 'percent' ? (
              <Field label={t('pricing.percentOff')}>
                {(ids) => (
                  <PercentInput
                    {...ids}
                    value={d.percent}
                    onChange={(v) => setD({ ...d, percent: v })}
                  />
                )}
              </Field>
            ) : (
              <Field label={t('pricing.amountOff')}>
                {(ids) => (
                  <MoneyInput
                    {...ids}
                    value={d.amount}
                    onChange={(v) => setD({ ...d, amount: v })}
                  />
                )}
              </Field>
            )}
            <Field label={t('pricing.minSubtotal')} optional={t('common.optional')}>
              {(ids) => (
                <MoneyInput {...ids} value={d.min} onChange={(v) => setD({ ...d, min: v })} />
              )}
            </Field>
            <Field label={t('pricing.startsAt')} optional={t('common.optional')}>
              {(ids) => (
                <Input
                  {...ids}
                  type="date"
                  value={d.starts}
                  onChange={(e) => setD({ ...d, starts: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('pricing.expiresAt')} optional={t('common.optional')}>
              {(ids) => (
                <Input
                  {...ids}
                  type="date"
                  value={d.expires}
                  onChange={(e) => setD({ ...d, expires: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('pricing.maxRedemptions')} optional={t('common.optional')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={d.max}
                  onChange={(e) => setD({ ...d, max: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
            <Field label={t('pricing.maxPerClient')} optional={t('common.optional')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={d.perClient}
                  onChange={(e) => setD({ ...d, perClient: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
            <div className="flex items-end">
              <Button type="submit" loading={add.isPending}>
                {t('pricing.newCoupon')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------------- travel

export function Travel() {
  const { t, money } = useI18n();
  const canManage = useCan('pricing.manage');
  const territories = useTerritories();
  const rules = useTravelRules();
  const invalidate = useInvalidatePricing();
  const [terr, setTerr] = React.useState({ name: '', prefixes: '' });
  const addTerritory = useMutation({
    mutationFn: () =>
      post('/v1/territories', {
        name: terr.name,
        postalPrefixes: terr.prefixes
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setTerr({ name: '', prefixes: '' });
      invalidate();
    },
    onError: fail,
  });
  const removeTerritory = useMutation({
    mutationFn: (id: string) => del(`/v1/territories/${id}`),
    onSuccess: invalidate,
    onError: fail,
  });
  const blank = {
    kind: 'territory' as 'territory' | 'distance',
    name: '',
    territoryId: '',
    fee: null as number | null,
    freeKm: '0',
    perKm: null as number | null,
    minFee: null as number | null,
    maxFee: null as number | null,
    priority: '10',
  };
  const [r, setR] = React.useState(blank);
  const addRule = useMutation({
    mutationFn: () =>
      post(
        '/v1/travel-fee-rules',
        r.kind === 'territory'
          ? {
              kind: 'territory',
              name: r.name,
              territoryId: r.territoryId,
              fee: r.fee,
              priority: Number(r.priority),
            }
          : {
              kind: 'distance',
              name: r.name,
              freeKm: Number(r.freeKm),
              perKm: r.perKm,
              minFee: r.minFee,
              maxFee: r.maxFee,
              priority: Number(r.priority),
            },
      ),
    onSuccess: () => {
      setR(blank);
      invalidate();
    },
    onError: fail,
  });
  const removeRule = useMutation({
    mutationFn: (id: string) => del(`/v1/travel-fee-rules/${id}`),
    onSuccess: invalidate,
  });
  const territoryName = (id: string | null) =>
    territories.data?.items.find((x) => x.id === id)?.name ?? '—';
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={t('pricing.territories')} />
        <ul className="divide-y divide-border">
          {(territories.data?.items ?? []).map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2">
              <span className="flex flex-col">
                <span className="font-medium">{x.name}</span>
                <span className="text-sm text-fg-muted">{x.postalPrefixes.join(', ')}</span>
              </span>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('common.delete')} ${x.name}`}
                  onClick={() => removeTerritory.mutate(x.id)}
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="flex flex-col gap-3 border-t border-border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              addTerritory.mutate();
            }}
          >
            <Field label={t('common.name')}>
              {(ids) => (
                <Input
                  {...ids}
                  value={terr.name}
                  onChange={(e) => setTerr({ ...terr, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('pricing.postalPrefixes')} hint={t('pricing.postalPrefixesHint')}>
              {(ids) => (
                <Input
                  {...ids}
                  value={terr.prefixes}
                  onChange={(e) => setTerr({ ...terr, prefixes: e.target.value })}
                />
              )}
            </Field>
            <div>
              <Button type="submit" variant="secondary" loading={addTerritory.isPending}>
                {t('pricing.newTerritory')}
              </Button>
            </div>
          </form>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t('pricing.travelRules')} />
        <ul className="divide-y divide-border">
          {(rules.data?.items ?? []).map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2">
              <span className="flex flex-col">
                <span className="font-medium">{x.name}</span>
                <span className="text-sm text-fg-muted tabular">
                  {x.kind === 'territory'
                    ? `${territoryName(x.territoryId)} · ${money(x.fee ?? 0)}`
                    : `${x.freeKm} km free · ${money(x.perKm ?? 0)}/km${x.minFee ? ` · min ${money(x.minFee)}` : ''}${x.maxFee ? ` · max ${money(x.maxFee)}` : ''}`}
                  {` · #${x.priority}`}
                </span>
              </span>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('common.delete')} ${x.name}`}
                  onClick={() => removeRule.mutate(x.id)}
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="grid gap-3 border-t border-border p-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              addRule.mutate();
            }}
          >
            <Field label={t('common.name')}>
              {(ids) => (
                <Input
                  {...ids}
                  value={r.name}
                  onChange={(e) => setR({ ...r, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('pricing.couponKind')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={r.kind}
                  onValueChange={(v) => setR({ ...r, kind: v as 'territory' | 'distance' })}
                  options={[
                    { value: 'territory', label: t('pricing.ruleKind.territory') },
                    { value: 'distance', label: t('pricing.ruleKind.distance') },
                  ]}
                />
              )}
            </Field>
            {r.kind === 'territory' ? (
              <>
                <Field label={t('quote.territory')}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={r.territoryId}
                      onValueChange={(v) => setR({ ...r, territoryId: v })}
                      options={(territories.data?.items ?? []).map((x) => ({
                        value: x.id,
                        label: x.name,
                      }))}
                    />
                  )}
                </Field>
                <Field label={t('pricing.fee')}>
                  {(ids) => (
                    <MoneyInput {...ids} value={r.fee} onChange={(v) => setR({ ...r, fee: v })} />
                  )}
                </Field>
              </>
            ) : (
              <>
                <Field label={t('pricing.freeKm')}>
                  {(ids) => (
                    <Input
                      {...ids}
                      inputMode="numeric"
                      value={r.freeKm}
                      onChange={(e) => setR({ ...r, freeKm: e.target.value.replace(/\D/g, '') })}
                    />
                  )}
                </Field>
                <Field label={t('pricing.perKm')}>
                  {(ids) => (
                    <MoneyInput
                      {...ids}
                      value={r.perKm}
                      onChange={(v) => setR({ ...r, perKm: v })}
                    />
                  )}
                </Field>
                <Field label={t('pricing.minFee')} optional={t('common.optional')}>
                  {(ids) => (
                    <MoneyInput
                      {...ids}
                      value={r.minFee}
                      onChange={(v) => setR({ ...r, minFee: v })}
                    />
                  )}
                </Field>
                <Field label={t('pricing.maxFee')} optional={t('common.optional')}>
                  {(ids) => (
                    <MoneyInput
                      {...ids}
                      value={r.maxFee}
                      onChange={(v) => setR({ ...r, maxFee: v })}
                    />
                  )}
                </Field>
              </>
            )}
            <Field label={t('pricing.priority')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={r.priority}
                  onChange={(e) => setR({ ...r, priority: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" loading={addRule.isPending}>
                {t('pricing.newTravelRule')}
              </Button>
            </div>
          </form>
        ) : null}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------ tax

export function TaxRates() {
  const { t } = useI18n();
  const canManage = useCan('pricing.manage');
  const rates = useTaxRates();
  const invalidate = useInvalidatePricing();
  const [d, setD] = React.useState({
    name: '',
    rate: null as number | null,
    region: '',
    travel: false,
  });
  const add = useMutation({
    mutationFn: () =>
      post('/v1/tax-rates', {
        name: d.name,
        rateBps: d.rate,
        regionCode: d.region || null,
        appliesToTravel: d.travel,
      }),
    onSuccess: () => {
      setD({ name: '', rate: null, region: '', travel: false });
      invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/tax-rates/${id}`),
    onSuccess: invalidate,
  });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {(rates.data?.items ?? []).map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span className="flex flex-col">
              <span className="font-medium">{x.name}</span>
              <span className="text-sm text-fg-muted tabular">
                {x.rateBps / 100}% · {x.regionCode ?? t('common.all')}
                {x.appliesToTravel ? ` · ${t('pricing.appliesToTravel')}` : ''}
              </span>
            </span>
            {canManage ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t('common.delete')} ${x.name}`}
                onClick={() => remove.mutate(x.id)}
              >
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form
          className="grid gap-3 rounded-md border border-dashed border-border p-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label={t('common.name')}>
            {(ids) => (
              <Input
                {...ids}
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('pricing.rate')}>
            {(ids) => (
              <PercentInput {...ids} value={d.rate} onChange={(v) => setD({ ...d, rate: v })} />
            )}
          </Field>
          <Field label={t('pricing.region')} hint={t('pricing.regionHint')}>
            {(ids) => (
              <Input
                {...ids}
                value={d.region}
                onChange={(e) => setD({ ...d, region: e.target.value.toUpperCase() })}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" loading={add.isPending}>
            {t('common.add')}
          </Button>
          <label className="flex items-center gap-2 text-sm sm:col-span-4">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--tu-fg)]"
              checked={d.travel}
              onChange={(e) => setD({ ...d, travel: e.target.checked })}
            />
            {t('pricing.appliesToTravel')}
          </label>
        </form>
      ) : null}
    </div>
  );
}
