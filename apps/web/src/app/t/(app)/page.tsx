'use client';

import { can, isStaffRole } from '@tuello/shared';
import { Button, Card } from '@tuello/ui';
import { Palette, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page';
import { useT } from '@/lib/i18n';
import { useMe } from '@/lib/session';

export default function HomePage() {
  const t = useT();
  const me = useMe();
  const role = me.membership.role;
  return (
    <>
      <PageHeader
        title={t('home.welcome', { name: me.user.name.split(' ')[0] ?? me.user.name })}
        description={isStaffRole(role) ? t('home.staff.body') : t('home.client.body')}
      />
      {can(role, 'invites.manage') || can(role, 'branding.update') ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {can(role, 'invites.manage') ? (
            <Card className="flex flex-col items-start gap-3 p-5">
              <UserPlus size={20} strokeWidth={1.5} aria-hidden />
              <p className="text-md font-medium">{t('home.inviteTeam')}</p>
              <Button asChild variant="secondary" size="sm">
                <Link href="/settings/team?invite=1">{t('team.invite')}</Link>
              </Button>
            </Card>
          ) : null}
          {can(role, 'branding.update') ? (
            <Card className="flex flex-col items-start gap-3 p-5">
              <Palette size={20} strokeWidth={1.5} aria-hidden />
              <p className="text-md font-medium">{t('home.addBrand')}</p>
              <Button asChild variant="secondary" size="sm">
                <Link href="/settings/branding">{t('settings.branding')}</Link>
              </Button>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
