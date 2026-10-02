'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDomainSchema, type DomainDto } from '@tuello/shared';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  SkeletonRows,
  Status,
  toast,
} from '@tuello/ui';
import { Copy, Globe } from 'lucide-react';
import * as React from 'react';
import { QueryError, RequirePermission } from '@/components/page';
import { ApiError, del, get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePlatform } from '@/lib/platform';
import { useCan, useMe } from '@/lib/session';

function CopyValue({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-fg-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code className="truncate rounded-sm bg-bg-muted px-2 py-1 font-mono text-sm">{value}</code>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${t('common.copy')} ${label}`}
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => toast({ title: t('common.copied') }))
          }
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Domains() {
  const { t, dateTime } = useI18n();
  const me = useMe();
  const { baseDomain } = usePlatform();
  const qc = useQueryClient();
  const canManage = useCan('domains.manage');
  const [hostname, setHostname] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [removing, setRemoving] = React.useState<DomainDto | null>(null);
  const domains = useQuery({
    queryKey: ['domains'],
    queryFn: () => get<{ items: DomainDto[] }>('/v1/tenant/domains'),
    refetchInterval: (q) =>
      q.state.data?.items.some((d) => d.status === 'pending') ? 15_000 : false,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['domains'] });
  const add = useMutation({
    mutationFn: () => post<DomainDto>('/v1/tenant/domains', { hostname }),
    onSuccess: () => {
      setHostname('');
      refresh();
    },
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? (err.problem.errors?.[0]?.message ?? err.problem.title)
          : String(err),
      ),
  });
  const verify = useMutation({
    mutationFn: (id: string) => post(`/v1/tenant/domains/${id}/verify`),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/tenant/domains/${id}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });

  const fill = (s: DomainDto['status']) =>
    s === 'verified' ? 'solid' : s === 'pending' ? 'half' : 'outline';

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-base text-fg-muted">{t('domains.body')}</p>
      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!addDomainSchema.safeParse({ hostname }).success)
              return setError(t('validation.hostname'));
            setError(undefined);
            add.mutate();
          }}
        >
          <Field label={t('domains.hostname')} error={error} className="w-full max-w-sm">
            {(ids) => (
              <Input
                {...ids}
                placeholder="media.example.com"
                autoCapitalize="none"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={add.isPending}>
            {t('domains.add')}
          </Button>
        </form>
      ) : null}

      {domains.isPending ? (
        <SkeletonRows rows={2} label={t('common.loading')} />
      ) : domains.isError ? (
        <QueryError onRetry={() => void domains.refetch()} />
      ) : domains.data.items.length === 0 ? (
        <EmptyState
          icon={Globe}
          title={t('domains.empty.title')}
          body={t('domains.empty.body', { host: `${me.tenant.slug}.${baseDomain}` })}
        />
      ) : (
        domains.data.items.map((d) => (
          <Card key={d.id} className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-md font-medium">{d.hostname}</span>
                <Status
                  fill={fill(d.status)}
                  label={t(`domains.status.${d.status}`)}
                  tone={d.status === 'failed' ? 'danger' : undefined}
                />
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  {d.status !== 'verified' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={verify.isPending && verify.variables === d.id}
                      onClick={() => verify.mutate(d.id)}
                    >
                      {t('domains.checkNow')}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(d)}>
                    {t('common.remove')}
                  </Button>
                </div>
              ) : null}
            </div>
            {d.status !== 'verified' ? (
              <div className="flex flex-col gap-3 rounded-md border border-border p-4">
                <span className="text-sm font-medium">{t('domains.records')}</span>
                <div className="grid gap-3 md:grid-cols-[auto_1fr_1fr]">
                  <CopyValue label="Type" value="TXT" />
                  <CopyValue label="Name" value={d.verificationRecordName} />
                  <CopyValue label="Value" value={d.verificationRecordValue} />
                  <CopyValue label="Type" value="CNAME" />
                  <CopyValue label="Name" value={d.hostname} />
                  <CopyValue label="Value" value={d.cnameTarget} />
                </div>
                {d.lastError ? (
                  <p className="text-sm text-fg-muted">
                    {d.lastError}
                    {d.lastCheckedAt ? (
                      <span className="tabular"> · {dateTime(d.lastCheckedAt)}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`${t('common.remove')} ${removing?.hostname ?? ''}`}
        confirmLabel={t('common.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

export default function DomainsPage() {
  return (
    <RequirePermission permission="domains.read">
      <Domains />
    </RequirePermission>
  );
}
