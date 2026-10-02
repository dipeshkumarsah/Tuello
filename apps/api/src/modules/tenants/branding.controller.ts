import { Controller, Get, HttpCode, Inject, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { uuidv7, type Database } from '@tuello/db';
import {
  checkAccentContrast,
  LOGO_MAX_BYTES,
  logoUploadRequestSchema,
  updateBrandingSchema,
  type BrandingDto,
  type UpdateBrandingInput,
} from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ZBody } from '../../common/zod';
import { StorageService } from '../../infra/storage.service';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { BrandingService } from './branding.service';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

@ApiTags('branding')
@Controller({ path: 'tenant/branding', version: '1' })
export class BrandingController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly branding: BrandingService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('branding.read')
  get(@Req() req: TuelloRequest): Promise<BrandingDto> {
    return this.branding.get(req.tenant!.id);
  }

  @Patch()
  @RequirePermission('branding.update')
  @ApiZodBody(updateBrandingSchema)
  async update(
    @ZBody(updateBrandingSchema) body: UpdateBrandingInput,
    @Req() req: TuelloRequest,
  ): Promise<BrandingDto> {
    const tenantId = req.tenant!.id;
    if (body.logoKey && !StorageService.belongsTo(tenantId, body.logoKey)) {
      throw new Problem('validation_failed', undefined, [
        { path: 'logoKey', code: 'invalid', message: 'Unknown upload.' },
      ]);
    }
    await this.db.tx.tenantBranding.upsert({
      where: { tenantId },
      create: { tenantId, ...body },
      update: body,
    });
    this.branding.invalidate(tenantId);
    await this.events.emit(
      'tenant.branding_updated',
      { type: 'tenant', id: tenantId },
      { fields: Object.keys(body) },
    );
    await this.audit.record(req, 'tenant.branding_updated', { type: 'tenant', id: tenantId }, body);
    // Read back through the cache path after commit would race; build the DTO from the row.
    const row = await this.db.tx.tenantBranding.findUniqueOrThrow({ where: { tenantId } });
    return {
      accentColor: row.accentColor,
      accentTextColor: row.accentColor ? checkAccentContrast(row.accentColor).textColor : null,
      emailSenderName: row.emailSenderName,
      emailReplyTo: row.emailReplyTo,
      logoKey: row.logoKey,
      logoUrl: row.logoKey ? await this.storage.signedGetUrl(row.logoKey) : null,
    };
  }

  /** Presigned POST straight to object storage; the API never handles the bytes. */
  @Post('logo-upload')
  @HttpCode(200)
  @RequirePermission('branding.update')
  @ApiZodBody(logoUploadRequestSchema)
  async logoUpload(
    @ZBody(logoUploadRequestSchema) body: z.infer<typeof logoUploadRequestSchema>,
    @Req() req: TuelloRequest,
  ) {
    const key = StorageService.tenantKey(
      req.tenant!.id,
      'branding',
      `logo-${uuidv7()}.${EXT[body.contentType]}`,
    );
    const post = await this.storage.presignUpload({
      key,
      contentType: body.contentType,
      maxBytes: Math.min(body.size, LOGO_MAX_BYTES),
    });
    return { key, url: post.url, fields: post.fields };
  }
}
