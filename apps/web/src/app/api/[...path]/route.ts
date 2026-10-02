import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the API. Cookies stay host-only on each tenant host, and the API sees the
 * original host in X-Forwarded-Host for tenant resolution. In production Caddy can route /api/*
 * straight to the API instead; both paths behave the same.
 */
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'host',
  'content-length',
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = new URL(
    `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/${path.map(encodeURIComponent).join('/')}`,
  );
  target.search = req.nextUrl.search;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  });
  headers.set(
    'x-forwarded-host',
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '',
  );
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers.set('x-forwarded-for', ip);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (
      !HOP_BY_HOP.has(k.toLowerCase()) &&
      k.toLowerCase() !== 'set-cookie' &&
      k.toLowerCase() !== 'content-encoding'
    )
      out.set(k, v);
  });
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
