import { Inject, Injectable } from '@nestjs/common';
import type { Database, TenantLookup } from '@tuello/db';
import type Redis from 'ioredis';
import { DB, REDIS } from '../../infra/tokens';

const TTL_SECONDS = 300;
const NEGATIVE_TTL_SECONDS = 15;

/**
 * Host -> tenant lookups, cached in Valkey with explicit invalidation. Every request goes
 * through here, so it must stay one GET in the common case.
 */
@Injectable()
export class TenantDirectory {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private key(kind: 'slug' | 'domain', value: string) {
    return `tenant:${kind}:${value}`;
  }

  async bySlug(slug: string): Promise<TenantLookup | null> {
    return this.cached(this.key('slug', slug), () => this.db.system.tenantBySlug(slug));
  }

  async byDomain(hostname: string): Promise<TenantLookup | null> {
    return this.cached(this.key('domain', hostname), () => this.db.system.tenantByDomain(hostname));
  }

  async invalidateSlug(slug: string): Promise<void> {
    await this.redis.del(this.key('slug', slug));
  }

  async invalidateDomain(hostname: string): Promise<void> {
    await this.redis.del(this.key('domain', hostname));
  }

  private async cached(
    key: string,
    load: () => Promise<TenantLookup | null>,
  ): Promise<TenantLookup | null> {
    const hit = await this.redis.get(key);
    if (hit !== null) return hit === 'null' ? null : (JSON.parse(hit) as TenantLookup);
    const value = await load();
    await this.redis.set(
      key,
      JSON.stringify(value),
      'EX',
      value ? TTL_SECONDS : NEGATIVE_TTL_SECONDS,
    );
    return value;
  }
}
