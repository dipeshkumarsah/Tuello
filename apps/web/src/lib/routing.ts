import { classifyHost } from '@tuello/shared/dist/host';

/** Which internal tree serves a request: the apex (signup) or a tenant workspace. */
export function internalPath(
  host: string | null,
  pathname: string,
  baseDomain: string,
): string | null {
  const kind = classifyHost(host, baseDomain).kind;
  if (kind === 'invalid') return null;
  return `${kind === 'apex' ? '/apex' : '/t'}${pathname === '/' ? '' : pathname}`;
}
