'use client';

import { TokenLanding } from '@/components/token-landing';
import { useT } from '@/lib/i18n';

export default function VerifyEmailPage() {
  const t = useT();
  return <TokenLanding endpoint="/v1/auth/verify-email" title={t('auth.verify.title')} />;
}
