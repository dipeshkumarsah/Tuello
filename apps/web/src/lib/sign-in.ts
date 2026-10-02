'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { LoginResult } from '@tuello/shared';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** After any sign-in step: either continue to the 2FA step or land in the workspace. */
export function useAfterSignIn() {
  const router = useRouter();
  const qc = useQueryClient();
  return React.useCallback(
    (result: LoginResult) => {
      if (result.status === 'mfa_required') {
        sessionStorage.setItem('tuello-mfa', result.challengeToken);
        router.replace('/login?step=mfa');
        return;
      }
      qc.clear();
      router.replace('/');
    },
    [router, qc],
  );
}
