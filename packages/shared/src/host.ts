import { RESERVED_SLUGS } from './constants';

export type HostKind =
  | { kind: 'apex' }
  | { kind: 'subdomain'; slug: string }
  | { kind: 'custom'; hostname: string }
  | { kind: 'invalid' };

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/** Lowercases and strips the port. Returns null for something that is not a hostname. */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  // First value only if a proxy sent a list.
  host = host.split(',')[0]!.trim();
  if (host.startsWith('[')) return null; // IPv6 literal: never a tenant host
  host = host.replace(/:\d+$/, '');
  host = host.replace(/\.$/, '');
  if (!host) return null;
  return host;
}

export function isValidHostname(host: string): boolean {
  return HOSTNAME_RE.test(host) || host === 'localhost';
}

/**
 * Classifies a request host against the platform base domain (e.g. "tuello.app" or
 * "tuello.localhost"). "app.{base}" and "{base}" are the apex: signup and account lookup.
 */
export function classifyHost(rawHost: string | undefined | null, baseDomain: string): HostKind {
  const host = normalizeHost(rawHost);
  const base = baseDomain.toLowerCase();
  if (!host) return { kind: 'invalid' };
  if (host === base || host === `app.${base}` || host === `www.${base}`) return { kind: 'apex' };
  if (host.endsWith(`.${base}`)) {
    const label = host.slice(0, -(base.length + 1));
    if (label.includes('.') || !isValidSlug(label)) return { kind: 'invalid' };
    return { kind: 'subdomain', slug: label };
  }
  if (!isValidHostname(host)) return { kind: 'invalid' };
  return { kind: 'custom', hostname: host };
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes('--');
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export function tenantOrigin(
  slug: string,
  opts: { baseDomain: string; protocol: 'http' | 'https'; port?: string | number | null },
): string {
  const port = opts.port ? `:${opts.port}` : '';
  return `${opts.protocol}://${slug}.${opts.baseDomain}${port}`;
}
