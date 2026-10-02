import { NextResponse, type NextRequest } from 'next/server';
import { internalPath } from './lib/routing';

/**
 * One Next.js app serves every host. The host decides which tree renders:
 *   {base} / app.{base}          -> /apex/*  (signup, find your workspace)
 *   {slug}.{base} / custom domain -> /t/*     (tenant workspace and client pages)
 * The URL in the browser never changes. /api/* is proxied to the API as-is.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const path = internalPath(
    host,
    req.nextUrl.pathname,
    process.env.APP_BASE_DOMAIN ?? 'tuello.localhost',
  );
  if (!path) return new NextResponse('Not found', { status: 404 });
  const url = req.nextUrl.clone();
  url.pathname = path;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|healthz|favicon.ico|robots.txt).*)'],
};
