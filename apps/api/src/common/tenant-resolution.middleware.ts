import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { classifyHost, normalizeHost } from '@tuello/shared';
import { ENV, type Env } from '../config/env';
import { TenantDirectory } from '../modules/tenants/tenant-directory.service';
import type { TuelloRequest } from './request';

/**
 * Resolves the tenant from the host name: {slug}.{APP_BASE_DOMAIN} or a verified custom domain.
 * Behind the web proxy or Caddy the original host arrives in X-Forwarded-Host (TRUST_PROXY).
 * It only annotates the request; the auth guard enforces host scope per route.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly directory: TenantDirectory,
  ) {}

  async use(req: TuelloRequest, _res: Response, next: NextFunction) {
    try {
      const forwarded = req.headers['x-forwarded-host'];
      const raw =
        this.env.TRUST_PROXY && typeof forwarded === 'string' ? forwarded : req.headers.host;
      const host = normalizeHost(raw) ?? '';
      const kind = classifyHost(raw, this.env.APP_BASE_DOMAIN);
      req.publicHost = host;
      req.hostKind = kind.kind;
      req.tenant = null;
      req.auth = null;
      if (kind.kind === 'subdomain' || kind.kind === 'custom') {
        const t =
          kind.kind === 'subdomain'
            ? await this.directory.bySlug(kind.slug)
            : await this.directory.byDomain(kind.hostname);
        if (t) req.tenant = { ...t, host, hostKind: kind.kind };
      }
      next();
    } catch (err) {
      next(err);
    }
  }
}
