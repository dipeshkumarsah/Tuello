import { Inject, Injectable } from '@nestjs/common';
import type { Database, TenantBranding } from '@tuello/db';
import { checkAccentContrast, type BrandingDto } from '@tuello/shared';
import type Redis from 'ioredis';
import { StorageService } from '../../infra/storage.service';
import { DB, REDIS } from '../../infra/tokens';

const CACHE_TTL = 600;

/** Branding is read on every client-facing page, so it is cached in Valkey per tenant. */
@Injectable()
export class BrandingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: StorageService,
  ) {}

  private key(tenantId: string) {
    return `branding:${tenantId}`;
  }

  async get(tenantId: string): Promise<BrandingDto> {
    const hit = await this.redis.get(this.key(tenantId));
    let row: Pick<
      TenantBranding,
      'logoKey' | 'accentColor' | 'emailSenderName' | 'emailReplyTo'
    > | null = hit ? JSON.parse(hit) : null;
    if (!row) {
      row = (await this.db.tx.tenantBranding.findUnique({ where: { tenantId } })) ?? {
        logoKey: null,
        accentColor: null,
        emailSenderName: null,
        emailReplyTo: null,
      };
      await this.redis.set(
        this.key(tenantId),
        JSON.stringify({
          logoKey: row.logoKey,
          accentColor: row.accentColor,
          emailSenderName: row.emailSenderName,
          emailReplyTo: row.emailReplyTo,
        }),
        'EX',
        CACHE_TTL,
      );
    }
    return {
      accentColor: row.accentColor,
      accentTextColor: row.accentColor ? checkAccentContrast(row.accentColor).textColor : null,
      emailSenderName: row.emailSenderName,
      emailReplyTo: row.emailReplyTo,
      logoKey: row.logoKey,
      logoUrl: row.logoKey ? await this.storage.signedGetUrl(row.logoKey, 3600) : null,
    };
  }

  invalidate(tenantId: string): void {
    this.db.afterCommit(() => this.redis.del(this.key(tenantId)));
  }
}
