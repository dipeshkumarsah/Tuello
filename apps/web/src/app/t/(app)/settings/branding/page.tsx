'use client';

import { Card, Skeleton } from '@tuello/ui';
import { BrandingForm } from '@/components/branding-form';
import { QueryError, RequirePermission } from '@/components/page';
import { useCan } from '@/lib/session';
import { useBranding } from '@/lib/tenant';

function Branding() {
  const branding = useBranding();
  const canEdit = useCan('branding.update');
  if (branding.isPending) return <Skeleton className="h-72 w-full" />;
  if (branding.isError) return <QueryError onRetry={() => void branding.refetch()} />;
  return (
    <Card className="p-5">
      <BrandingForm branding={branding.data} disabled={!canEdit} />
    </Card>
  );
}

export default function BrandingSettingsPage() {
  return (
    <RequirePermission permission="branding.read">
      <Branding />
    </RequirePermission>
  );
}
