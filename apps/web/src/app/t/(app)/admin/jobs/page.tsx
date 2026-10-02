'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeadLetterJobDto } from '@tuello/shared';
import { Button, Card, EmptyState, SkeletonRows, toast } from '@tuello/ui';
import { CheckCircle2 } from 'lucide-react';
import { PageHeader, QueryError, RequirePermission } from '@/components/page';
import { get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCan } from '@/lib/session';

function Jobs() {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const canRetry = useCan('jobs.retry');
  const jobs = useQuery({
    queryKey: ['dead-letter'],
    queryFn: () => get<{ items: DeadLetterJobDto[] }>('/v1/jobs/dead-letter'),
  });
  const retry = useMutation({
    mutationFn: (id: string) => post(`/v1/jobs/dead-letter/${encodeURIComponent(id)}/retry`),
    onSuccess: () => {
      toast({ title: t('jobs.retried'), tone: 'success' });
      void qc.invalidateQueries({ queryKey: ['dead-letter'] });
    },
  });
  return (
    <>
      <PageHeader title={t('jobs.title')} description={t('jobs.body')} />
      {jobs.isPending ? (
        <SkeletonRows rows={3} label={t('common.loading')} />
      ) : jobs.isError ? (
        <QueryError onRetry={() => void jobs.refetch()} />
      ) : jobs.data.items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('jobs.empty.title')} body={t('jobs.empty.body')} />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {jobs.data.items.map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {j.queue} · {j.name}
                  </span>
                  <span className="truncate text-sm text-fg-muted">{j.failedReason}</span>
                  <span className="text-xs text-fg-subtle tabular">
                    {dateTime(j.failedAt)} · {j.attemptsMade}×
                  </span>
                </div>
                {canRetry ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={retry.isPending && retry.variables === j.id}
                    onClick={() => retry.mutate(j.id)}
                  >
                    {t('jobs.retry')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export default function JobsPage() {
  return (
    <RequirePermission permission="jobs.read">
      <Jobs />
    </RequirePermission>
  );
}
