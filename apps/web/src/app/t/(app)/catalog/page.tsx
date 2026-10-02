'use client';

import { useMutation } from '@tanstack/react-query';
import {
  DELIVERABLE_TYPES,
  SERVICE_CATEGORIES,
  type AddOnDto,
  type PackageDto,
  type ServiceDto,
} from '@tuello/shared';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonRows,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@tuello/ui';
import { Download, Package as PackageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { FormMessage } from '@/components/auth-shell';
import { MoneyInput } from '@/components/money-input';
import { PageHeader, QueryError, RequirePermission } from '@/components/page';
import { ApiError, del, patch, post } from '@/lib/api';
import { useCatalog, useInvalidatePricing, type CatalogData } from '@/lib/catalog';
import { useI18n } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useExport } from '@/lib/use-export';

const errText = (e: unknown) =>
  e instanceof ApiError
    ? (e.problem.detail ?? e.problem.errors?.map((x) => x.message).join(' ') ?? e.problem.title)
    : String(e);

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-base">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--tu-fg)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

// ------------------------------------------------------------------------------- services

function ServiceDialog({
  open,
  onOpenChange,
  service,
  data,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  service: ServiceDto | null;
  data: CatalogData;
}) {
  const { t } = useI18n();
  const invalidate = useInvalidatePricing();
  const init = () => ({
    name: service?.name ?? '',
    description: service?.description ?? '',
    category: service?.category ?? 'photo',
    durationMinutes: String(service?.durationMinutes ?? 60),
    requiredSkillId: service?.requiredSkill?.id ?? 'none',
    deliverableType: service?.deliverableType ?? 'photos',
    taxable: service?.taxable ?? true,
    active: service?.active ?? true,
    firstVariant: '',
    firstPrice: null as number | null,
  });
  const [d, setD] = React.useState(init);
  React.useEffect(() => {
    if (open) setD(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service]);
  const [error, setError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: d.name,
        description: d.description || null,
        category: d.category,
        durationMinutes: Number(d.durationMinutes),
        requiredSkillId: d.requiredSkillId === 'none' ? null : d.requiredSkillId,
        deliverableType: d.deliverableType,
        taxable: d.taxable,
        active: d.active,
      };
      if (service) return patch<ServiceDto>(`/v1/services/${service.id}`, body);
      const created = await post<ServiceDto>('/v1/services', body);
      if (d.firstVariant.trim() && d.firstPrice != null) {
        await post(`/v1/services/${created.id}/variants`, {
          name: d.firstVariant,
          basePrice: d.firstPrice,
        });
      }
      return created;
    },
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast({ title: t('settings.saved'), tone: 'success' });
    },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" closeLabel={t('common.close')}>
        <DialogTitle>{service ? service.name : t('catalog.newService')}</DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('common.name')}>
            {(ids) => (
              <Input
                {...ids}
                autoFocus
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('catalog.category')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={d.category}
                  onValueChange={(v) => setD({ ...d, category: v as typeof d.category })}
                  options={SERVICE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))}
                />
              )}
            </Field>
            <Field label={t('catalog.deliverable')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={d.deliverableType}
                  onValueChange={(v) =>
                    setD({ ...d, deliverableType: v as typeof d.deliverableType })
                  }
                  options={DELIVERABLE_TYPES.map((c) => ({
                    value: c,
                    label: t(`deliverable.${c}`),
                  }))}
                />
              )}
            </Field>
            <Field label={t('catalog.duration')}>
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={d.durationMinutes}
                  onChange={(e) =>
                    setD({ ...d, durationMinutes: e.target.value.replace(/\D/g, '') })
                  }
                />
              )}
            </Field>
            <Field label={t('catalog.requiredSkill')}>
              {(ids) => (
                <Select
                  {...ids}
                  value={d.requiredSkillId}
                  onValueChange={(v) => setD({ ...d, requiredSkillId: v })}
                  options={[
                    { value: 'none', label: t('common.none') },
                    ...data.skills.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              )}
            </Field>
          </div>
          <Field label={t('common.description')} optional={t('common.optional')}>
            {(ids) => (
              <Textarea
                {...ids}
                value={d.description}
                onChange={(e) => setD({ ...d, description: e.target.value })}
              />
            )}
          </Field>
          {!service ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`${t('catalog.variants')}: ${t('common.name')}`}>
                {(ids) => (
                  <Input
                    {...ids}
                    placeholder="25 photos"
                    value={d.firstVariant}
                    onChange={(e) => setD({ ...d, firstVariant: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('catalog.basePrice')}>
                {(ids) => (
                  <MoneyInput
                    {...ids}
                    value={d.firstPrice}
                    onChange={(v) => setD({ ...d, firstPrice: v })}
                  />
                )}
              </Field>
            </div>
          ) : null}
          <div className="flex gap-6">
            <Checkbox
              label={t('catalog.taxable')}
              checked={d.taxable}
              onChange={(v) => setD({ ...d, taxable: v })}
            />
            <Checkbox
              label={t('common.active')}
              checked={d.active}
              onChange={(v) => setD({ ...d, active: v })}
            />
          </div>
          <FormMessage>{error}</FormMessage>
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VariantRow({ v, canManage }: { v: ServiceDto['variants'][number]; canManage: boolean }) {
  const { t, money } = useI18n();
  const invalidate = useInvalidatePricing();
  const [name, setName] = React.useState(v.name);
  const [price, setPrice] = React.useState<number | null>(v.basePrice);
  const dirty = name !== v.name || price !== v.basePrice;
  const save = useMutation({
    mutationFn: () => patch(`/v1/variants/${v.id}`, { name, basePrice: price }),
    onSuccess: () => {
      invalidate();
      toast({ title: t('settings.saved'), tone: 'success' });
    },
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  const remove = useMutation({
    mutationFn: () => del(`/v1/variants/${v.id}`),
    onSuccess: invalidate,
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  if (!canManage) {
    return (
      <li className="flex items-center justify-between px-5 py-2">
        <span>{v.name}</span>
        <span className="tabular">{money(v.basePrice)}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2 px-5 py-2">
      <Input
        aria-label={t('common.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 max-w-xs flex-1 text-sm"
      />
      <MoneyInput
        ariaLabel={`${t('catalog.basePrice')} ${v.name}`}
        value={price}
        onChange={setPrice}
        className="w-36"
      />
      {dirty ? (
        <Button
          size="sm"
          loading={save.isPending}
          disabled={price == null || !name.trim()}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-8 w-8"
        aria-label={`${t('common.delete')} ${v.name}`}
        onClick={() => remove.mutate()}
      >
        <Trash2 size={16} strokeWidth={1.5} aria-hidden />
      </Button>
    </li>
  );
}

function AddVariant({ serviceId }: { serviceId: string }) {
  const { t } = useI18n();
  const invalidate = useInvalidatePricing();
  const [name, setName] = React.useState('');
  const [price, setPrice] = React.useState<number | null>(null);
  const add = useMutation({
    mutationFn: () => post(`/v1/services/${serviceId}/variants`, { name, basePrice: price }),
    onSuccess: () => {
      setName('');
      setPrice(null);
      invalidate();
    },
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && price != null) add.mutate();
      }}
    >
      <Input
        aria-label={t('catalog.newVariant')}
        placeholder={t('catalog.newVariant')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 max-w-xs flex-1 text-sm"
      />
      <MoneyInput
        ariaLabel={t('catalog.basePrice')}
        value={price}
        onChange={setPrice}
        className="w-36"
      />
      <Button type="submit" variant="secondary" size="sm" loading={add.isPending}>
        <Plus size={14} strokeWidth={1.5} aria-hidden /> {t('common.add')}
      </Button>
    </form>
  );
}

function Services({ data }: { data: CatalogData }) {
  const { t } = useI18n();
  const canManage = useCan('catalog.manage');
  const invalidate = useInvalidatePricing();
  const [editing, setEditing] = React.useState<ServiceDto | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ServiceDto | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/services/${id}`),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });
  const starter = useMutation({
    mutationFn: () => post('/v1/catalog/starter'),
    onSuccess: invalidate,
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  if (!data.services.length) {
    return (
      <EmptyState
        icon={PackageIcon}
        title={t('catalog.empty.title')}
        body={t('catalog.empty.body')}
        action={
          canManage ? (
            <div className="flex gap-2">
              <Button loading={starter.isPending} onClick={() => starter.mutate()}>
                {t('catalog.starter')}
              </Button>
              <Button variant="secondary" onClick={() => setCreating(true)}>
                {t('catalog.newService')}
              </Button>
            </div>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} strokeWidth={1.5} aria-hidden /> {t('catalog.newService')}
          </Button>
        </div>
      ) : null}
      {data.services.map((s) => (
        <Card key={s.id}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {s.name} {!s.active ? <Badge>{t('common.inactive')}</Badge> : null}
              </span>
            }
            description={[
              t(`category.${s.category}`),
              t('common.minutes', { n: s.durationMinutes }),
              s.requiredSkill?.name,
              t(`deliverable.${s.deliverableType}`),
            ]
              .filter(Boolean)
              .join(' · ')}
            action={
              canManage ? (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('common.edit')} ${s.name}`}
                    onClick={() => setEditing(s)}
                  >
                    <Pencil size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('common.delete')} ${s.name}`}
                    onClick={() => setDeleting(s)}
                  >
                    <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                </div>
              ) : undefined
            }
          />
          <ul className="divide-y divide-border">
            {s.variants.map((v) => (
              <VariantRow key={`${v.id}:${v.basePrice}:${v.name}`} v={v} canManage={canManage} />
            ))}
          </ul>
          {canManage ? <AddVariant serviceId={s.id} /> : null}
        </Card>
      ))}
      <ServiceDialog
        open={creating || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        service={editing}
        data={data}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('common.delete')}
        description={deleting ? t('common.confirmDelete', { name: deleting.name }) : undefined}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------- packages

function PackageDialog({
  open,
  onOpenChange,
  pkg,
  data,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pkg: PackageDto | null;
  data: CatalogData;
}) {
  const { t } = useI18n();
  const invalidate = useInvalidatePricing();
  const [name, setName] = React.useState('');
  const [price, setPrice] = React.useState<number | null>(null);
  const [items, setItems] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setName(pkg?.name ?? '');
      setPrice(pkg?.basePrice ?? null);
      setItems(pkg?.items.map((i) => i.variantId) ?? []);
      setError(null);
    }
  }, [open, pkg]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        basePrice: price,
        items: items.map((variantId) => ({ variantId, quantity: 1 })),
      };
      return pkg ? patch(`/v1/packages/${pkg.id}`, body) : post('/v1/packages', body);
    },
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => setError(errText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" closeLabel={t('common.close')}>
        <DialogTitle>{pkg ? pkg.name : t('catalog.newPackage')}</DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.name')}>
              {(ids) => (
                <Input {...ids} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label={t('catalog.basePrice')}>
              {(ids) => <MoneyInput {...ids} value={price} onChange={setPrice} />}
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('catalog.includes')}</legend>
            {data.services.flatMap((s) =>
              s.variants.map((v) => (
                <Checkbox
                  key={v.id}
                  label={`${s.name} · ${v.name}`}
                  checked={items.includes(v.id)}
                  onChange={(c) =>
                    setItems((x) => (c ? [...x, v.id] : x.filter((y) => y !== v.id)))
                  }
                />
              )),
            )}
          </fieldset>
          <FormMessage>{error}</FormMessage>
          <DialogFooter>
            <Button type="submit" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Packages({ data }: { data: CatalogData }) {
  const { t, money } = useI18n();
  const canManage = useCan('catalog.manage');
  const invalidate = useInvalidatePricing();
  const [editing, setEditing] = React.useState<PackageDto | null>(null);
  const [creating, setCreating] = React.useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/packages/${id}`),
    onSuccess: invalidate,
  });
  const variantName = (id: string) => {
    for (const s of data.services)
      for (const v of s.variants) if (v.id === id) return `${s.name} · ${v.name}`;
    return '—';
  };
  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} strokeWidth={1.5} aria-hidden /> {t('catalog.newPackage')}
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-border rounded-md border border-border">
        {data.packages.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex flex-col">
              <span className="font-medium">{p.name}</span>
              <span className="text-sm text-fg-muted">
                {p.items.map((i) => variantName(i.variantId)).join(', ')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular">{money(p.basePrice)}</span>
              {canManage ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('common.edit')} ${p.name}`}
                    onClick={() => setEditing(p)}
                  >
                    <Pencil size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('common.delete')} ${p.name}`}
                    onClick={() => remove.mutate(p.id)}
                  >
                    <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <PackageDialog
        open={creating || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        pkg={editing}
        data={data}
      />
    </div>
  );
}

// -------------------------------------------------------------------------------- add-ons

function AddOns({ data }: { data: CatalogData }) {
  const { t, money } = useI18n();
  const canManage = useCan('catalog.manage');
  const invalidate = useInvalidatePricing();
  const [draft, setDraft] = React.useState({
    name: '',
    price: null as number | null,
    serviceId: 'any',
    maxQuantity: '',
  });
  const add = useMutation({
    mutationFn: () =>
      post<AddOnDto>('/v1/add-ons', {
        name: draft.name,
        basePrice: draft.price,
        serviceId: draft.serviceId === 'any' ? null : draft.serviceId,
        maxQuantity: draft.maxQuantity ? Number(draft.maxQuantity) : null,
      }),
    onSuccess: () => {
      setDraft({ name: '', price: null, serviceId: 'any', maxQuantity: '' });
      invalidate();
    },
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/add-ons/${id}`),
    onSuccess: invalidate,
  });
  const serviceName = (id: string | null) =>
    id ? (data.services.find((s) => s.id === id)?.name ?? '—') : t('catalog.anyService');
  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {data.addOns.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex flex-col">
              <span className="font-medium">{a.name}</span>
              <span className="text-sm text-fg-muted">
                {serviceName(a.serviceId)}
                {a.maxQuantity ? ` · ${t('catalog.maxQuantity')}: ${a.maxQuantity}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular">{money(a.basePrice)}</span>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('common.delete')} ${a.name}`}
                  onClick={() => remove.mutate(a.id)}
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {canManage ? (
        <form
          className="grid gap-3 rounded-md border border-dashed border-border p-4 sm:grid-cols-[2fr_1fr_1.5fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim() && draft.price != null) add.mutate();
          }}
        >
          <Field label={t('catalog.newAddOn')}>
            {(ids) => (
              <Input
                {...ids}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('catalog.basePrice')}>
            {(ids) => (
              <MoneyInput
                {...ids}
                value={draft.price}
                onChange={(v) => setDraft({ ...draft, price: v })}
              />
            )}
          </Field>
          <Field label={t('catalog.appliesTo')}>
            {(ids) => (
              <Select
                {...ids}
                value={draft.serviceId}
                onValueChange={(v) => setDraft({ ...draft, serviceId: v })}
                options={[
                  { value: 'any', label: t('catalog.anyService') },
                  ...data.services.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
          </Field>
          <Field label={t('catalog.maxQuantity')}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                value={draft.maxQuantity}
                onChange={(e) =>
                  setDraft({ ...draft, maxQuantity: e.target.value.replace(/\D/g, '') })
                }
              />
            )}
          </Field>
          <Button type="submit" loading={add.isPending}>
            {t('common.add')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function Skills({ data }: { data: CatalogData }) {
  const { t } = useI18n();
  const canManage = useCan('catalog.manage');
  const invalidate = useInvalidatePricing();
  const [name, setName] = React.useState('');
  const add = useMutation({
    mutationFn: () => post('/v1/skills', { name }),
    onSuccess: () => {
      setName('');
      invalidate();
    },
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/skills/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast({ title: errText(e), tone: 'error' }),
  });
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {data.skills.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-4 py-2">
            {s.name}
            {canManage ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t('common.delete')} ${s.name}`}
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Input
            aria-label={t('catalog.newSkill')}
            placeholder={t('catalog.newSkill')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="secondary" loading={add.isPending}>
            {t('common.add')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function Catalog() {
  const { t } = useI18n();
  const catalog = useCatalog();
  const exportServices = useExport('/v1/services/export');
  return (
    <>
      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.body')}
        action={
          <Button
            variant="secondary"
            loading={exportServices.busy}
            onClick={() => void exportServices.run()}
          >
            <Download size={16} strokeWidth={1.5} aria-hidden /> {t('common.export')}
          </Button>
        }
      />
      {catalog.isPending ? (
        <SkeletonRows rows={6} label={t('common.loading')} />
      ) : catalog.isError ? (
        <QueryError onRetry={() => void catalog.refetch()} />
      ) : (
        <Tabs defaultValue="services">
          <TabsList>
            <TabsTrigger value="services">{t('catalog.services')}</TabsTrigger>
            <TabsTrigger value="packages">{t('catalog.packages')}</TabsTrigger>
            <TabsTrigger value="add-ons">{t('catalog.addOns')}</TabsTrigger>
            <TabsTrigger value="skills">{t('catalog.skills')}</TabsTrigger>
          </TabsList>
          <TabsContent value="services">
            <Services data={catalog.data} />
          </TabsContent>
          <TabsContent value="packages">
            <Packages data={catalog.data} />
          </TabsContent>
          <TabsContent value="add-ons">
            <AddOns data={catalog.data} />
          </TabsContent>
          <TabsContent value="skills">
            <Skills data={catalog.data} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

export default function CatalogPage() {
  return (
    <RequirePermission permission="catalog.read">
      <Catalog />
    </RequirePermission>
  );
}
