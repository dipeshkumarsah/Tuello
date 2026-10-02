import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { CSRF_COOKIE, CSRF_HEADER, normalizeHost } from '@tuello/shared';
import { safeEqual } from '../infra/crypto';
import { Problem } from './problem';
import type { TuelloRequest } from './request';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for every state-changing request:
 * 1. double-submit token: the tuello_csrf cookie must equal the x-csrf-token header, and
 * 2. if the browser sends Origin, it must be the same host the request was made to.
 * SameSite=Lax session cookies are a third layer.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TuelloRequest>();
    if (SAFE.has(req.method)) return true;

    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let originHost: string | null;
      try {
        originHost = normalizeHost(new URL(origin).host);
      } catch {
        originHost = null;
      }
      if (originHost !== req.publicHost)
        throw new Problem('csrf_failed', 'Cross-origin request rejected.');
    }

    const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER];
    if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) {
      throw new Problem('csrf_failed');
    }
    return true;
  }
}
