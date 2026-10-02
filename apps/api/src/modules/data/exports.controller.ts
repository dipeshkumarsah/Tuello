import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, type Database } from '@tuello/db';
import { can, clientFiltersSchema, type ExportEntity, type Permission } from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ZBody } from '../../common/zod';
import { QueueService } from '../../infra/queue.service';
import { StorageService } from '../../infra/storage.service';
import { DB } from '../../infra/tokens';

const PERMISSION: Record<ExportEntity, Permission> = {
  clients: 'clients.read',
  brokerages: 'clients.read',
  services: 'catalog.read',
  add_ons: 'catalog.read',
  packages: 'catalog.read',
  coupons: 'pricing.read',
};

const exportFilters = z.object({ filters: clientFiltersSchema.partial().default({}) });

/**
 * CSV export of every list, built in the background and downloaded with a signed URL.
 * One route per list so each carries its own permission.
 */
@ApiTags('exports')
@Controller({ version: '1' })
export class ExportsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
  ) {}

  private async start(req: TuelloRequest, entity: ExportEntity, filters: Record<string, unknown>) {
    const job = await this.db.tx.exportJob.create({
      data: {
        tenantId: req.tenant!.id,
        entity,
        filters: filters as Prisma.InputJsonValue,
        createdByUserId: req.auth!.userId,
      },
    });
    this.queue.enqueueExport({ tenantId: req.tenant!.id, exportId: job.id, entity, filters });
    return { id: job.id, status: job.status };
  }

  @Post('clients/export')
  @HttpCode(202)
  @RequirePermission('clients.read')
  @ApiZodBody(exportFilters)
  exportClients(
    @ZBody(exportFilters) body: z.infer<typeof exportFilters>,
    @Req() req: TuelloRequest,
  ) {
    return this.start(req, 'clients', body.filters);
  }

  @Post('brokerages/export')
  @HttpCode(202)
  @RequirePermission('clients.read')
  exportBrokerages(@Req() req: TuelloRequest) {
    return this.start(req, 'brokerages', {});
  }

  @Post('services/export')
  @HttpCode(202)
  @RequirePermission('catalog.read')
  exportServices(@Req() req: TuelloRequest) {
    return this.start(req, 'services', {});
  }

  @Post('add-ons/export')
  @HttpCode(202)
  @RequirePermission('catalog.read')
  exportAddOns(@Req() req: TuelloRequest) {
    return this.start(req, 'add_ons', {});
  }

  @Post('packages/export')
  @HttpCode(202)
  @RequirePermission('catalog.read')
  exportPackages(@Req() req: TuelloRequest) {
    return this.start(req, 'packages', {});
  }

  @Post('coupons/export')
  @HttpCode(202)
  @RequirePermission('pricing.read')
  exportCoupons(@Req() req: TuelloRequest) {
    return this.start(req, 'coupons', {});
  }

  /** Status of an export; `url` is set once it is ready. The entity's own permission applies. */
  @Get('exports/:id')
  @RequirePermission('self.manage')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const job = await this.db.tx.exportJob.findFirst({ where: { id } });
    if (
      !job ||
      !can(req.auth!.role, PERMISSION[job.entity as ExportEntity] ?? 'subscription.manage')
    )
      throw new Problem('not_found');
    return {
      id: job.id,
      entity: job.entity,
      status: job.status,
      rowCount: job.rowCount,
      lastError: job.lastError,
      url:
        job.status === 'completed' && job.fileKey
          ? await this.storage.signedGetUrl(
              job.fileKey,
              600,
              `${job.entity}-${job.createdAt.toISOString().slice(0, 10)}.csv`,
            )
          : null,
    };
  }
}
