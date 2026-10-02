'use client';

import { TokenLanding } from '@/components/token-landing';
import { useT } from '@/lib/i18n';

export default function HandoffPage() {
  const t = useT();
  return <TokenLanding endpoint="/v1/auth/handoff" title={t('auth.magic.consuming')} />;
}
