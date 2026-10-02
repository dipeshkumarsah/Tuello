'use client';

import { useQuery } from '@tanstack/react-query';
import {
  quote,
  type CouponInput,
  type ItemKind,
  type PriceListInput,
  type PricingCatalog,
} from '@tuello/shared';
import { Card, CardHeader, Field, Input, Select } from '@tuello/ui';
import * as React from 'react';
import { ApiError, get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { priceableItems } from '@/lib/pricing';

/**
 * Live quote, computed in the browser with the SAME pricing engine the API uses
 * (@tuello/shared quote()) on the snapshot from GET /v1/pricing/catalog. The price list passed in
 * can be unsaved, so editors see the effect of every change immediately.
 */
export function QuotePreview({
  catalog,
  priceList,
  territories,
}: {
  catalog: PricingCatalog;
  priceList: PriceListInput | null;
  territories: Array<{ id: string; name: string }>;
}) {
  const { t, money, settings } = useI18n();
  const items = priceableItems(catalog).filter((i) => i.active);
  const [size, setSize] = React.useState('2000');
  const [typeId, setTypeId] = React.useState('any');
  const [region, setRegion] = React.useState('');
  const [territoryId, setTerritoryId] = React.useState('none');
  const [distance, setDistance] = React.useState('');
  const [selected, setSelected] = React.useState<Record<string, number>>(() =>
    items[0] ? { [`${items[0].kind}:${items[0].id}`]: 1 } : {},
  );
  const [code, setCode] = React.useState('');
  const [debouncedCode, setDebouncedCode] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedCode(code.trim().toUpperCase()), 300);
    return () => clearTimeout(id);
  }, [code]);
  const coupon = useQuery({
    queryKey: ['coupon-lookup', debouncedCode],
    queryFn: async () => {
      try {
        return await get<CouponInput>(`/v1/coupons/lookup/${encodeURIComponent(debouncedCode)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: !!debouncedCode,
  });

  const result = React.useMemo(
    () =>
      quote({
        catalog,
        priceList,
        property: {
          size: size ? Number(size) : null,
          sizeUnit: settings.measurementUnit,
          propertyTypeId: typeId === 'any' ? null : typeId,
          regionCode: region || null,
          territoryId: territoryId === 'none' ? null : territoryId,
          distanceKm: distance ? Number(distance) : null,
        },
        items: Object.entries(selected).map(([key, quantity]) => {
          const [kind, id] = key.split(':') as [ItemKind, string];
          return { kind, id, quantity };
        }),
        coupon: debouncedCode ? (coupon.data ?? null) : null,
        couponCode: debouncedCode || null,
        asOf: new Date().toISOString(),
      }),
    [
      catalog,
      priceList,
      size,
      typeId,
      region,
      territoryId,
      distance,
      selected,
      debouncedCode,
      coupon.data,
      settings.measurementUnit,
    ],
  );

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader title={t('quote.title')} description={t('quote.body')} />
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`${t('quote.size')} (${settings.measurementUnit === 'm2' ? 'm²' : 'sq ft'})`}
          >
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                value={size}
                onChange={(e) => setSize(e.target.value.replace(/[^\d.]/g, ''))}
              />
            )}
          </Field>
          <Field label={t('quote.propertyType')}>
            {(ids) => (
              <Select
                {...ids}
                value={typeId}
                onValueChange={setTypeId}
                options={[
                  { value: 'any', label: t('pricing.anyType') },
                  ...catalog.propertyTypes.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            )}
          </Field>
          <Field label={t('quote.territory')}>
            {(ids) => (
              <Select
                {...ids}
                value={territoryId}
                onValueChange={setTerritoryId}
                options={[
                  { value: 'none', label: t('common.none') },
                  ...territories.map((x) => ({ value: x.id, label: x.name })),
                ]}
              />
            )}
          </Field>
          <Field label={t('quote.distance')}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={distance}
                onChange={(e) => setDistance(e.target.value.replace(/[^\d.]/g, ''))}
              />
            )}
          </Field>
          <Field label={t('quote.region')}>
            {(ids) => (
              <Input
                {...ids}
                placeholder="US-TX"
                value={region}
                onChange={(e) => setRegion(e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field
            label={t('quote.coupon')}
            hint={result.coupon ? t(`quote.coupon.${result.coupon.status}`) : undefined}
          >
            {(ids) => <Input {...ids} value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
        </div>
        <fieldset className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('quote.items')}</legend>
          {items.map((i) => {
            const key = `${i.kind}:${i.id}`;
            return (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--tu-fg)]"
                  checked={key in selected}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = { ...s };
                      if (e.target.checked) next[key] = 1;
                      else delete next[key];
                      return next;
                    })
                  }
                />
                {i.label}
              </label>
            );
          })}
        </fieldset>
        <div aria-live="polite" className="flex flex-col gap-1 tabular">
          {result.lines.length === 0 ? (
            <p className="text-fg-muted">{t('quote.empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t('quote.title')}</caption>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.key}>
                    <td className="py-1">
                      {l.name}
                      <span className="block text-xs text-fg-muted">
                        {t(`quote.source.${l.priceSource}`)}
                        {l.standardUnitPrice !== l.unitPrice
                          ? ` · ${money(l.standardUnitPrice)}`
                          : ''}
                      </span>
                    </td>
                    <td className="py-1 text-right">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 border-t border-border pt-2 text-sm">
            <dt>{t('quote.subtotal')}</dt>
            <dd className="text-right">{money(result.subtotal)}</dd>
            {result.discount ? (
              <>
                <dt>{t('quote.discount')}</dt>
                <dd className="text-right">−{money(result.discount)}</dd>
              </>
            ) : null}
            <dt>{t('quote.travelFee')}</dt>
            <dd className="text-right">{money(result.travel.fee)}</dd>
            {result.taxes.map((tx) => (
              <React.Fragment key={tx.rateId}>
                <dt>
                  {tx.name} ({tx.rateBps / 100}%)
                </dt>
                <dd className="text-right">{money(tx.amount)}</dd>
              </React.Fragment>
            ))}
            <dt className="text-md font-semibold">{t('quote.total')}</dt>
            <dd className="text-right text-md font-semibold" data-testid="quote-total">
              {money(result.total)}
            </dd>
          </dl>
        </div>
      </div>
    </Card>
  );
}
