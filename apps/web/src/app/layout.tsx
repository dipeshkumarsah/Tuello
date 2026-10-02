import type { Metadata, Viewport } from 'next';
import { themeInitScript } from '@tuello/ui';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  // Client-facing pages never carry the Tuello brand; tenant pages set their own title.
  title: { default: 'Workspace', template: '%s' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const platform = {
    baseDomain: process.env.APP_BASE_DOMAIN ?? 'tuello.localhost',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? null,
  };
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-bg text-fg">
        <Providers platform={platform}>{children}</Providers>
      </body>
    </html>
  );
}
