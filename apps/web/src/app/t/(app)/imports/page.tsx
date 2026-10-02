'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CursorPage,
  ImportEntity,
  ImportJobDto,
  ImportMapping,
  ImportPreviewDto,
} from '@tuello/shared';
import {
  Button,
  Card,
  CardHeader,
  FileUploader,
  Select,
  SkeletonRows,
  Status,
  toast,
} from '@tuello/ui';
import { AlertTriangle, Check } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { PageHeader, RequirePermission } from '@/components/page';
import { ApiError, get, post, uploadPresigned } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const IGNORE = '__ignore__';
const errText = (e: unknown) =>
  e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : String(e);

function useImport(id: string | null) {
  return useQuery({
    queryKey: ['import', id],
    queryFn: () => get<ImportJobDto>(`/v1/imports/${id}`),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 1000 : false,
  });
}

function Progress({ job }: { job: ImportJobDto }) {
  const { t } = useI18n();
  const report = useMutation({
    mutationFn: () => get<{ url: string }>(`/v1/imports/${job.id}/error-report`),
    onSuccess: (r) => window.location.assign(r.url),
  });
  if (job.status === 'queued' || job.status === 'running') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <Status fill="half" label={t('imports.running', { processed: job.processedRows })} />
        <div className="h-1 w-full overflow-hidden rounded-full bg-bg-emphasis">
          <div className="h-full w-1/3 animate-pulse bg-fg" />
        </div>
      </div>
    );
  }
  if (job.status === 'failed')
    return (
      <p role="alert" className="text-danger">
        {t('imports.failed', { error: job.lastError ?? '' })}
      </p>
    );
  return (
    <div role="status" className="flex flex-col gap-3">
      <p className="flex items-center gap-2">
        <Check size={16} strokeWidth={1.5} aria-hidden />
        {t('imports.done', {
          created: job.createdCount,
          updated: job.updatedCount,
          errors: job.errorCount,
        })}
      </p>
      {job.hasErrorReport ? (
        <div>
          <Button variant="secondary" loading={report.isPending} onClick={() => report.mutate()}>
            {t('imports.errorReport')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Wizard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [entity, setEntity] = React.useState<ImportEntity>(
    params.get('entity') === 'brokerages' ? 'brokerages' : 'clients',
  );
  const [importId, setImportId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportPreviewDto | null>(null);
  const [mapping, setMapping] = React.useState<ImportMapping>({});
  const [error, setError] = React.useState<string | null>(null);
  const job = useImport(importId);
  React.useEffect(() => {
    if (job.data?.status === 'completed') void qc.invalidateQueries({ queryKey: ['clients'] });
  }, [job.data?.status, qc]);

  const refresh = useMutation({
    mutationFn: (m: ImportMapping) =>
      post<ImportPreviewDto>(`/v1/imports/${importId}/preview`, { mapping: m }),
    onSuccess: setPreview,
  });
  const start = useMutation({
    mutationFn: () => post<ImportJobDto>(`/v1/imports/${importId}/start`, { mapping }),
    onSuccess: (j) => {
      qc.setQueryData(['import', j.id], j);
      void qc.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (e) => setError(errText(e)),
  });

  const upload = async (file: File, onProgress: (f: number) => void) => {
    setError(null);
    const created = await post<{
      import: ImportJobDto;
      upload: { url: string; fields: Record<string, string> };
    }>('/v1/imports', { entity, fileName: file.name, size: file.size });
    await uploadPresigned(created.upload, file, onProgress);
    const p = await post<ImportPreviewDto>(`/v1/imports/${created.import.id}/preview`, {});
    setImportId(created.import.id);
    setPreview(p);
    setMapping(p.suggestedMapping);
  };

  const started = job.data && !['awaiting_upload', 'uploaded'].includes(job.data.status);
  const setField = (key: string, header: string) => {
    const next = { ...mapping };
    if (header === IGNORE) delete next[key];
    else next[key] = header;
    setMapping(next);
    refresh.mutate(next);
  };

  return (
    <div className="flex flex-col gap-6">
      {!preview ? (
        <Card className="flex flex-col gap-4 p-5">
          <div className="max-w-xs">
            <Select
              aria-label={t('imports.entity')}
              value={entity}
              onValueChange={(v) => setEntity(v as ImportEntity)}
              options={[
                { value: 'clients', label: t('imports.entity.clients') },
                { value: 'brokerages', label: t('imports.entity.brokerages') },
              ]}
            />
          </div>
          <FileUploader
            label={t('imports.upload')}
            hint={t('imports.uploadHint')}
            accept=".csv,text/csv"
            maxBytes={50 * 1024 * 1024}
            upload={upload}
            onError={(m) => toast({ title: m, tone: 'error' })}
          />
        </Card>
      ) : null}

      {preview && !started ? (
        <>
          <Card>
            <CardHeader title={t('imports.mapping')} description={t('imports.mappingBody')} />
            <div className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
              {preview.fields.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {f.label}
                    {f.required ? ' *' : ''}
                  </span>
                  <Select
                    aria-label={f.label}
                    value={mapping[f.key] ?? IGNORE}
                    onValueChange={(v) => setField(f.key, v)}
                    options={[
                      { value: IGNORE, label: t('imports.ignore') },
                      ...preview.headers.map((h) => ({ value: h, label: h })),
                    ]}
                    className="w-52"
                  />
                </label>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title={t('imports.preview')} description={t('imports.previewBody')} />
            <ul className="divide-y divide-border">
              {preview.rows.map((r) => (
                <li key={r.line} className="flex items-start gap-3 px-5 py-2 text-sm">
                  {r.ok ? (
                    <Check
                      size={16}
                      strokeWidth={1.5}
                      aria-label="OK"
                      className="mt-0.5 shrink-0"
                    />
                  ) : (
                    <AlertTriangle
                      size={16}
                      strokeWidth={1.5}
                      aria-label="Error"
                      className="mt-0.5 shrink-0 text-danger"
                    />
                  )}
                  <span className="w-16 shrink-0 text-fg-muted tabular">
                    {t('imports.line', { n: r.line })}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {Object.values(r.raw).filter(Boolean).join(' · ')}
                  </span>
                  {!r.ok ? <span className="text-danger">{r.errors.join('; ')}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button size="lg" loading={start.isPending} onClick={() => start.mutate()}>
              {t('imports.start')}
            </Button>
          </div>
        </>
      ) : null}

      {started && job.data ? (
        <Card className="p-5">
          <p className="mb-3 font-medium">{job.data.fileName}</p>
          <Progress job={job.data} />
        </Card>
      ) : null}
    </div>
  );
}

function History() {
  const { t, dateTime } = useI18n();
  const imports = useQuery({
    queryKey: ['imports'],
    queryFn: () => get<CursorPage<ImportJobDto>>('/v1/imports?limit=20'),
  });
  if (imports.isPending) return <SkeletonRows rows={3} label={t('common.loading')} />;
  if (!imports.data?.items.length) return null;
  return (
    <Card>
      <CardHeader title={t('imports.history')} />
      <ul className="divide-y divide-border">
        {imports.data.items.map((j) => (
          <li
            key={j.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm"
          >
            <span className="flex flex-col">
              <span className="font-medium">{j.fileName}</span>
              <span className="text-fg-muted tabular">
                {t(`imports.entity.${j.entity}`)} · {dateTime(j.createdAt)}
              </span>
            </span>
            <span className="flex items-center gap-4 tabular">
              {j.status === 'completed' ? (
                <span className="text-fg-muted">
                  +{j.createdCount} / ~{j.updatedCount} / !{j.errorCount}
                </span>
              ) : null}
              <Status
                fill={
                  j.status === 'completed'
                    ? 'solid'
                    : j.status === 'running' || j.status === 'queued'
                      ? 'half'
                      : 'outline'
                }
                tone={j.status === 'failed' ? 'danger' : undefined}
                label={t(`imports.status.${j.status}`)}
              />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ImportsPage() {
  const { t } = useI18n();
  return (
    <RequirePermission permission="clients.manage">
      <PageHeader title={t('imports.title')} description={t('imports.body')} />
      <div className="flex flex-col gap-8">
        <React.Suspense>
          <Wizard />
        </React.Suspense>
        <History />
      </div>
    </RequirePermission>
  );
}
