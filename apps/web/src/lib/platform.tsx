'use client';

import * as React from 'react';

/** Runtime platform settings handed from the server layout (not baked in at build time). */
export interface Platform {
  baseDomain: string;
  turnstileSiteKey: string | null;
}

const PlatformContext = React.createContext<Platform>({
  baseDomain: 'tuello.localhost',
  turnstileSiteKey: null,
});

export function PlatformProvider({
  value,
  children,
}: {
  value: Platform;
  children: React.ReactNode;
}) {
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  return React.useContext(PlatformContext);
}

/** URL of a tenant workspace, keeping the current scheme and port (e.g. :3000 in development). */
export function tenantUrl(slug: string, baseDomain: string, path = '/'): string {
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${baseDomain}${port ? `:${port}` : ''}${path}`;
}
