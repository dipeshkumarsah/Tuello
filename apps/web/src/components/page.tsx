'use client';

import type { Permission } from '@tuello/shared';
import { Button, ErrorState, NoPermissionState } from '@tuello/ui';
import * as React from 'react';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="max-w-2xl text-base text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** Renders the designed no-permission state instead of a page the role cannot use. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const t = useT();
  if (!useCan(permission))
    return (
      <NoPermissionState title={t('state.forbidden.title')} body={t('state.forbidden.body')} />
    );
  return <>{children}</>;
}

export function QueryError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <ErrorState
      title={t('state.error.title')}
      body={t('state.error.body')}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}
