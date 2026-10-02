import { NextResponse, type NextRequest } from 'next/server';
import { classifyHost } from '@tuello/shared/dist/host';

/**
 * One Next.js app serves every host. The host decides which tree renders:
 *   {base} / app.{base}          -> /apex/*  (signup, find your workspace)
 *   {slug}.{base} / custom domain -> /t/*     (tenant workspace and client pages)
 * The URL in the browser never changes. /api/* is proxied to the API as-is.
 */
export function middleware(req: NextRequest) {
  const base = process.env.APP_BASE_DOMAIN ?? 'tuello.localhost';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const kind = classifyHost(host, base).kind;
  const url = req.nextUrl.clone();
  if (kind === 'invalid') return new NextResponse('Not found', { status: 404 });
  url.pathname = `${kind === 'apex' ? '/apex' : '/t'}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|robots.txt).*)'],
};
