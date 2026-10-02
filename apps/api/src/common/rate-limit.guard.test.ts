import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env';
import { RateLimit } from './decorators';
import { Problem } from './problem';
import { RateLimitGuard } from './rate-limit.guard';

/** Minimal in-memory stand-in for the Valkey commands the guard uses. */
class FakeRedis {
  counts = new Map<string, number>();
  multi() {
    const ops: Array<() => [null, number]> = [];
    const chain = {
      incr: (k: string) => {
        ops.push(() => {
          const v = (this.counts.get(k) ?? 0) + 1;
          this.counts.set(k, v);
          return [null, v];
        });
        return chain;
      },
      expire: () => {
        ops.push(() => [null, 1]);
        return chain;
      },
      exec: async () => ops.map((op) => op()),
    };
    return chain;
  }
  async ttl() {
    return 42;
  }
}

class Ctrl {
  @RateLimit({ by: 'ip', limit: 3, windowSec: 60 })
  login() {}

  @RateLimit({ by: 'email', limit: 2, windowSec: 60 })
  reset() {}

  @RateLimit()
  health() {}
}

function ctx(handler: keyof Ctrl, req: Record<string, unknown>) {
  return {
    getHandler: () => Ctrl.prototype[handler],
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => ({ ip: '1.2.3.4', tenant: { id: 't1' }, ...req }) }),
  } as never;
}

const env = { RATE_LIMIT_FACTOR: 1 } as Env;

describe('RateLimitGuard', () => {
  it('blocks after the route limit with Retry-After', async () => {
    const guard = new RateLimitGuard(new Reflector(), new FakeRedis() as never, env);
    for (let i = 0; i < 3; i++)
      await expect(guard.canActivate(ctx('login', {}))).resolves.toBe(true);
    const err = await guard.canActivate(ctx('login', {})).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Problem);
    expect((err as Problem).code).toBe('rate_limited');
    expect((err as Problem).headers).toEqual({ 'Retry-After': '42' });
  });

  it('counts per IP', async () => {
    const guard = new RateLimitGuard(new Reflector(), new FakeRedis() as never, env);
    for (let i = 0; i < 3; i++) await guard.canActivate(ctx('login', {}));
    await expect(guard.canActivate(ctx('login', { ip: '5.6.7.8' }))).resolves.toBe(true);
  });

  it('keys email rules by tenant + normalised email', async () => {
    const redis = new FakeRedis();
    const guard = new RateLimitGuard(new Reflector(), redis as never, env);
    await guard.canActivate(ctx('reset', { body: { email: 'A@x.com' } }));
    await guard.canActivate(ctx('reset', { body: { email: 'a@x.com ' }, ip: '9.9.9.9' }));
    await expect(
      guard.canActivate(ctx('reset', { body: { email: 'a@X.com' }, ip: '8.8.8.8' })),
    ).rejects.toBeInstanceOf(Problem);
    expect([...redis.counts.keys()].some((k) => k.includes('t1:a@x.com'))).toBe(true);
  });

  it('lets @RateLimit() routes opt out', async () => {
    const redis = new FakeRedis();
    const guard = new RateLimitGuard(new Reflector(), redis as never, env);
    for (let i = 0; i < 10; i++) await guard.canActivate(ctx('health', {}));
    expect(redis.counts.size).toBe(0);
  });
});
