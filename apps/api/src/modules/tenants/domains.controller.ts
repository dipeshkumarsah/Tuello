import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, type Database, type TenantDomain } from '@tuello/db';
import { addDomainSchema, DOMAIN_VERIFICATION_PREFIX, type DomainDto } from '@tuello/shared';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import {
  HostScoped,
  NoTenantTransaction,
  Public,
  RateLimit,
  RequirePermission,
} from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ZBody } from '../../common/zod';
import { QueueService } from '../../infra/queue.service';
import { TlsProvisioner } from '@tuello/shared';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { TenantDirectory } from './tenant-directory.service';

@ApiTags('domains')
@Controller({ path: 'tenant/domains', version: '1' })
export class DomainsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly directory: TenantDirectory,
    private readonly tls: TlsProvisioner,
  ) {}

  private toDto(d: TenantDomain): DomainDto {
    return {
      id: d.id,
      hostname: d.hostname,
      status: d.status,
      verificationRecordName: `${DOMAIN_VERIFICATION_PREFIX}.${d.hostname}`,
      verificationRecordValue: `tuello-verify=${d.verificationToken}`,
      cnameTarget: this.env.CUSTOM_DOMAIN_TARGET,
      verifiedAt: d.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
      lastError: d.lastError,
      createdAt: d.createdAt.toISOString(),
    };
  }

  @Get()
  @RequirePermission('domains.read')
  async list(): Promise<{ items: DomainDto[] }> {
    const rows = await this.db.tx.tenantDomain.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { items: rows.map((d) => this.toDto(d)) };
  }

  @Post()
  @RequirePermission('domains.manage')
  @RateLimit({ by: 'tenant', limit: 30, windowSec: 3600 })
  @ApiZodBody(addDomainSchema)
  async add(
    @ZBody(addDomainSchema) body: z.infer<typeof addDomainSchema>,
    @Req() req: TuelloRequest,
  ): Promise<DomainDto> {
    const base = this.env.APP_BASE_DOMAIN.toLowerCase();
    if (body.hostname === base || body.hostname.endsWith(`.${base}`)) {
      throw new Problem('validation_failed', undefined, [
        { path: 'hostname', code: 'invalid', message: 'Use a domain you own.' },
      ]);
    }
    const count = await this.db.tx.tenantDomain.count({ where: { deletedAt: null } });
    if (count >= 10) throw new Problem('conflict', 'A company can connect up to 10 domains.');
    let domain: TenantDomain;
    try {
      domain = await this.db.tx.tenantDomain.create({
        data: {
          tenantId: req.tenant!.id,
          hostname: body.hostname,
          verificationToken: randomBytes(16).toString('hex'),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new Problem('domain_taken');
      throw err;
    }
    await this.events.emit(
      'domain.added',
      { type: 'domain', id: domain.id },
      { hostname: domain.hostname },
    );
    await this.audit.record(
      req,
      'domain.added',
      { type: 'domain', id: domain.id },
      { hostname: domain.hostname },
    );
    this.queue.verifyDomain({ tenantId: req.tenant!.id, domainId: domain.id });
    return this.toDto(domain);
  }

  @Post(':id/verify')
  @HttpCode(202)
  @RequirePermission('domains.manage')
  @RateLimit({ by: 'tenant', limit: 30, windowSec: 600 })
  async verifyNow(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: TuelloRequest,
  ): Promise<DomainDto> {
    const d = await this.db.tx.tenantDomain.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw new Problem('not_found');
    if (d.status === 'failed') {
      await this.db.tx.tenantDomain.update({
        where: { id },
        data: { status: 'pending', checkAttempts: 0 },
      });
    }
    this.queue.verifyDomain({ tenantId: req.tenant!.id, domainId: id });
    return this.toDto({ ...d, status: d.status === 'failed' ? 'pending' : d.status });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('domains.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const d = await this.db.tx.tenantDomain.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw new Problem('not_found');
    await this.db.tx.tenantDomain.update({ where: { id }, data: { deletedAt: new Date() } });
    this.db.afterCommit(async () => {
      await this.directory.invalidateDomain(d.hostname);
      await this.tls.revokeHost(d.hostname);
    });
    await this.events.emit('domain.removed', { type: 'domain', id }, { hostname: d.hostname });
    await this.audit.record(
      req,
      'domain.removed',
      { type: 'domain', id },
      { hostname: d.hostname },
    );
  }
}

/**
 * Caddy on-demand TLS "ask" endpoint. Caddy calls it before issuing a certificate; we say yes
 * only for tenant subdomains that exist and custom domains that passed DNS verification.
 * Reachable only on the internal network (see infra/caddy/Caddyfile).
 */
@ApiTags('internal')
@Controller({ path: 'internal/tls', version: '1' })
export class TlsAskController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly directory: TenantDirectory,
  ) {}

  @Get('ask')
  @Public()
  @HostScoped('any')
  @NoTenantTransaction()
  @RateLimit({ by: 'ip', limit: 600, windowSec: 60 })
  async ask(@Query('domain') domain: string | undefined) {
    const host = (domain ?? '').trim().toLowerCase();
    const base = this.env.APP_BASE_DOMAIN.toLowerCase();
    if (!host) throw new Problem('not_found');
    if (host === base || host === `app.${base}` || host === `www.${base}`) return { allowed: true };
    if (host.endsWith(`.${base}`)) {
      const slug = host.slice(0, -(base.length + 1));
      if (!slug.includes('.') && (await this.directory.bySlug(slug))) return { allowed: true };
      throw new Problem('not_found');
    }
    if (await this.directory.byDomain(host)) return { allowed: true };
    throw new Problem('not_found');
  }
}
