import { Inject, Injectable } from '@nestjs/common';
import { tenantOrigin } from '@tuello/shared';
import { ENV, type Env } from '../../config/env';

/** Absolute URLs into a tenant's workspace, used in emails and redirects. */
@Injectable()
export class LinksService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  origin(slug: string): string {
    return tenantOrigin(slug, {
      baseDomain: this.env.APP_BASE_DOMAIN,
      protocol: this.env.APP_PUBLIC_PROTOCOL,
      port: this.env.APP_PUBLIC_PORT ?? null,
    });
  }

  url(slug: string, path: string, query?: Record<string, string>): string {
    const u = new URL(path, this.origin(slug));
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u.toString();
  }
}
