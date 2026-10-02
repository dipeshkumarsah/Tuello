'use client';

import { Card, Skeleton } from '@tuello/ui';
import { CompanyForm } from '@/components/company-form';
import { QueryError, RequirePermission } from '@/components/page';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useTenant } from '@/lib/tenant';

function Company() {
  const tenant = useTenant();
  const canEdit = useCan('tenant.update');
  if (tenant.isPending) return <Skeleton className="h-72 w-full" />;
  if (tenant.isError) return <QueryError onRetry={() => void tenant.refetch()} />;
  return (
    <Card className="p-5">
      <CompanyForm tenant={tenant.data} disabled={!canEdit} />
    </Card>
  );
}

export default function CompanySettingsPage() {
  useT();
  return (
    <RequirePermission permission="tenant.read">
      <Company />
    </RequirePermission>
  );
}
