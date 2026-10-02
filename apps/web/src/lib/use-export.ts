'use client';

import { toast } from '@tuello/ui';
import * as React from 'react';
import { get, post } from './api';
import { useT } from './i18n';

/** Starts a background CSV export and downloads it when ready. */
export function useExport(path: string) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(
    async (body?: unknown) => {
      setBusy(true);
      toast({ title: t('common.exporting') });
      try {
        const { id } = await post<{ id: string }>(path, body ?? {});
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, i < 5 ? 500 : 1500));
          const s = await get<{ status: string; url: string | null; lastError: string | null }>(
            `/v1/exports/${id}`,
          );
          if (s.status === 'completed' && s.url) {
            toast({ title: t('common.exportReady'), tone: 'success' });
            window.location.assign(s.url);
            return;
          }
          if (s.status === 'failed') throw new Error(s.lastError ?? 'Export failed');
        }
      } catch (err) {
        toast({ title: (err as Error).message, tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [path, t],
  );
  return { run, busy };
}
