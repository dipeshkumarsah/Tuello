import { Controller, Get, HttpCode, Inject, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Database, Tenant } from '@tuello/db';
import {
  updateTenantSchema,
  type PublicTenantDto,
  type TenantDto,
  type UpdateTenantInput,
} from '@tuello/shared';
import { Public, RequirePermission } from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ZBody } from '../../common/zod';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { AuthService } from '../identity/auth.service';
import { LinksService } from '../identity/links.service';
import { BrandingService } from './branding.service';
import { TenantDirectory } from './tenant-directory.service';

export function toTenantDto(t: Tenant): TenantDto {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    timeZone: t.timeZone,
    currency: t.currency,
    measurementUnit: t.measurementUnit,
    taxLabel: t.taxLabel,
    locale: t.locale,
    onboardingCompletedAt: t.onboardingCompletedAt?.toISOString() ?? null,
  };
}

@ApiTags('tenant')
@Controller({ path: 'tenant', version: '1' })
export class TenantController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly branding: BrandingService,
    private readonly directory: TenantDirectory,
    private readonly auth: AuthService,
    private readonly links: LinksService,
  ) {}

  /** What a sign-in page on this host needs: name and branding. Never exposes settings. */
  @Get('public')
  @Public()
  async publicInfo(@Req() req: TuelloRequest): Promise<PublicTenantDto> {
    const t = req.tenant!;
    const b = await this.branding.get(t.id);
    return {
      slug: t.slug,
      name: t.name,
      branding: {
        accentColor: b.accentColor,
        accentTextColor: b.accentTextColor,
        logoUrl: b.logoUrl,
      },
    };
  }

  @Get()
  @RequirePermission('tenant.read')
  async get(@Req() req: TuelloRequest): Promise<TenantDto> {
    return toTenantDto(
      await this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } }),
    );
  }

  @Patch()
  @RequirePermission('tenant.update')
  @ApiZodBody(updateTenantSchema)
  async update(
    @ZBody(updateTenantSchema) body: UpdateTenantInput,
    @Req() req: TuelloRequest,
  ): Promise<{ tenant: TenantDto; handoffUrl: string | null }> {
    const before = await this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } });
    const slugChanged = body.slug !== undefined && body.slug !== before.slug;
    if (slugChanged && !(await this.db.system.slugAvailable(body.slug!)))
      throw new Problem('slug_taken');

    const updated = await this.db.tx.tenant.update({ where: { id: before.id }, data: body });
    const changed = Object.keys(body).filter(
      (k) => (before as Record<string, unknown>)[k] !== (updated as Record<string, unknown>)[k],
    );
    if (changed.length > 0) {
      await this.events.emit('tenant.updated', { type: 'tenant', id: before.id }, { changed });
      await this.audit.record(
        req,
        'tenant.updated',
        { type: 'tenant', id: before.id },
        {
          changed: Object.fromEntries(
            changed.map((k) => [
              k,
              {
                from: (before as Record<string, unknown>)[k],
                to: (updated as Record<string, unknown>)[k],
              },
            ]),
          ),
        },
      );
    }

    let handoffUrl: string | null = null;
    if (slugChanged) {
      this.db.afterCommit(async () => {
        await this.directory.invalidateSlug(before.slug);
        await this.directory.invalidateSlug(updated.slug);
      });
      const token = await this.auth.issueHandoff(before.id, req.auth!.userId);
      handoffUrl = this.links.url(updated.slug, '/handoff', { token });
    }
    return { tenant: toTenantDto(updated), handoffUrl };
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  @RequirePermission('tenant.update')
  async completeOnboarding(@Req() req: TuelloRequest): Promise<TenantDto> {
    const t = await this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } });
    if (t.onboardingCompletedAt) return toTenantDto(t);
    const updated = await this.db.tx.tenant.update({
      where: { id: t.id },
      data: {
        onboardingCompletedAt: new Date(),
        status: t.status === 'onboarding' ? 'active' : t.status,
      },
    });
    this.db.afterCommit(() => this.directory.invalidateSlug(t.slug));
    await this.events.emit('tenant.onboarding_completed', { type: 'tenant', id: t.id });
    await this.audit.record(req, 'tenant.onboarding_completed', { type: 'tenant', id: t.id });
    return toTenantDto(updated);
  }
}
