import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../infra/tokens';
import { RATE_LIMIT_KEY, type RateLimitRule } from './decorators';
import { Problem } from './problem';
import { clientIp, type TuelloRequest } from './request';

/** Applied to every route on top of any route-specific rules. */
export const DEFAULT_RULES: RateLimitRule[] = [
  { by: 'ip', limit: 600, windowSec: 60 },
  { by: 'tenant', limit: 3000, windowSec: 60 },
];

/**
 * Fixed-window counters in Valkey, shared by every API instance. Limits are per IP and per
 * tenant; public endpoints (login, signup, order form) declare stricter rules with @RateLimit.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TuelloRequest>();
    const routeRules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    // @RateLimit() with no rules opts a route out entirely (health checks).
    if (routeRules && routeRules.length === 0) return true;

    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const checks: Array<{ key: string; limit: number; windowSec: number }> = [];
    for (const rule of DEFAULT_RULES) {
      const subject = this.subject(rule, req);
      if (subject)
        checks.push({
          key: `rl:${rule.by}:${subject}:all:${rule.windowSec}`,
          limit: rule.limit,
          windowSec: rule.windowSec,
        });
    }
    for (const rule of routeRules ?? []) {
      const subject = this.subject(rule, req);
      if (subject)
        checks.push({
          key: `rl:${rule.by}:${subject}:${route}:${rule.windowSec}`,
          limit: rule.limit,
          windowSec: rule.windowSec,
        });
    }

    const pipeline = this.redis.multi();
    for (const c of checks) pipeline.incr(c.key).expire(c.key, c.windowSec, 'NX');
    const results = (await pipeline.exec()) ?? [];
    for (const [i, c] of checks.entries()) {
      const count = Number(results[i * 2]?.[1] ?? 0);
      if (count > Math.ceil(c.limit * this.env.RATE_LIMIT_FACTOR)) {
        const ttl = await this.redis.ttl(c.key);
        throw new Problem('rate_limited', undefined, undefined, {
          'Retry-After': String(Math.max(1, ttl)),
        });
      }
    }
    return true;
  }

  private subject(rule: RateLimitRule, req: TuelloRequest): string | null {
    switch (rule.by) {
      case 'ip':
        return clientIp(req);
      case 'tenant':
        return req.tenant?.id ?? null;
      case 'email': {
        const email = (req.body as { email?: unknown } | undefined)?.email;
        return typeof email === 'string'
          ? `${req.tenant?.id ?? 'apex'}:${email.trim().toLowerCase()}`
          : null;
      }
    }
  }
}
