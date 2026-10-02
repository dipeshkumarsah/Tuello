'use client';

import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { TokenLanding } from '@/components/token-landing';
import { useT } from '@/lib/i18n';
import { EmailRequestForm } from '@/components/email-request-form';

function Magic() {
  const t = useT();
  const token = useSearchParams().get('token');
  return token ? (
    <TokenLanding endpoint="/v1/auth/magic-link/consume" title={t('auth.magic.consuming')} />
  ) : (
    <EmailRequestForm kind="magic" />
  );
}

export default function MagicPage() {
  return (
    <React.Suspense>
      <Magic />
    </React.Suspense>
  );
}
