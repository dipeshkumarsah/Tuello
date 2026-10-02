'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoteDto } from '@tuello/shared';
import { Button, Textarea } from '@tuello/ui';
import { Pin } from 'lucide-react';
import * as React from 'react';
import { get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** Notes on a client or brokerage (`path` is the record's API path). */
export function Notes({ path, onAdded }: { path: string; onAdded?: () => void }) {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const canManage = useCan('clients.manage');
  const notes = useQuery({
    queryKey: ['notes', path],
    queryFn: () => get<{ items: NoteDto[] }>(`${path}/notes`),
  });
  const [body, setBody] = React.useState('');
  const add = useMutation({
    mutationFn: () => post(`${path}/notes`, { body }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['notes', path] });
      onAdded?.();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <Textarea
            aria-label={t('clients.addNote')}
            placeholder={t('clients.notePlaceholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div>
            <Button type="submit" variant="secondary" loading={add.isPending}>
              {t('clients.addNote')}
            </Button>
          </div>
        </form>
      ) : null}
      {notes.data?.items.map((n) => (
        <article key={n.id} className="rounded-md border border-border p-4">
          <p className="whitespace-pre-wrap">{n.body}</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
            {n.pinned ? <Pin size={14} strokeWidth={1.5} aria-label={t('clients.pinned')} /> : null}
            {n.author?.name} · <span className="tabular">{dateTime(n.createdAt)}</span>
          </p>
        </article>
      ))}
    </div>
  );
}
