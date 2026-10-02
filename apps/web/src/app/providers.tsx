'use client';

import { ThemeProvider, Toaster } from '@tuello/ui';
import * as React from 'react';
import { I18nProvider } from '@/lib/i18n';
import { PlatformProvider, type Platform } from '@/lib/platform';
import { QueryProvider } from '@/lib/query';

export function Providers({
  platform,
  children,
}: {
  platform: Platform;
  children: React.ReactNode;
}) {
  return (
    <PlatformProvider value={platform}>
      <QueryProvider>
        <ThemeProvider>
          <I18nProvider>
            {children}
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </QueryProvider>
    </PlatformProvider>
  );
}
