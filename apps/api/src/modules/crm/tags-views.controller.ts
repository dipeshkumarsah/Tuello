import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, type Database } from '@tuello/db';
import {
  savedViewInputSchema,
  tagInputSchema,
  type SavedViewDto,
  type TagDto,
} from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../common/zod';
import { DB } from '../../infra/tokens';

@ApiTags('tags')
@Controller({ path: 'tags', version: '1' })
export class TagsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @RequirePermission('clients.read')
  async list(): Promise<{ items: Array<TagDto & { clientCount: number }> }> {
    const rows = await this.db.tx.tag.findMany({
      orderBy: { name: 'asc' },
      take: 500,
      include: { _count: { select: { clients: { where: { client: { deletedAt: null } } } } } },
    });
    return { items: rows.map((t) => ({ id: t.id, name: t.name, clientCount: t._count.clients })) };
  }

  /** Idempotent by name (case-insensitive): returns the existing tag if there is one. */
  @Post()
  @RequirePermission('clients.manage')
  @ApiZodBody(tagInputSchema)
  async create(
    @ZBody(tagInputSchema) body: z.infer<typeof tagInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<TagDto> {
    const existing = await this.db.tx.tag.findFirst({
      where: { name: { equals: body.name, mode: 'insensitive' } },
    });
    if (existing) return { id: existing.id, name: existing.name };
    const t = await this.db.tx.tag.create({ data: { tenantId: req.tenant!.id, name: body.name } });
    return { id: t.id, name: t.name };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('clients.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.tx.clientTag.deleteMany({ where: { tagId: id } });
    const r = await this.db.tx.tag.deleteMany({ where: { id } });
    if (r.count === 0) throw new Problem('not_found');
  }
}

const viewQuery = z.object({ entity: z.enum(['clients', 'brokerages']).default('clients') });

/** Saved list filters. Visible to their owner, or to everyone in the tenant when shared. */
@ApiTags('saved-views')
@Controller({ path: 'saved-views', version: '1' })
export class SavedViewsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private dto(
    v: {
      id: string;
      entity: 'clients' | 'brokerages';
      name: string;
      filters: Prisma.JsonValue;
      shared: boolean;
      userId: string;
    },
    me: string,
  ): SavedViewDto {
    return {
      id: v.id,
      entity: v.entity,
      name: v.name,
      filters: v.filters as Record<string, unknown>,
      shared: v.shared,
      mine: v.userId === me,
    };
  }

  @Get()
  @RequirePermission('clients.read')
  @ApiZodQuery(viewQuery)
  async list(@ZQuery(viewQuery) q: z.infer<typeof viewQuery>, @Req() req: TuelloRequest) {
    const me = req.auth!.userId;
    const rows = await this.db.tx.savedView.findMany({
      where: { entity: q.entity, OR: [{ userId: me }, { shared: true }] },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return { items: rows.map((v) => this.dto(v, me)) };
  }

  @Post()
  @RequirePermission('clients.read')
  @ApiZodBody(savedViewInputSchema)
  async create(
    @ZBody(savedViewInputSchema) body: z.output<typeof savedViewInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    const v = await this.db.tx.savedView.create({
      data: {
        tenantId: req.tenant!.id,
        userId: req.auth!.userId,
        entity: body.entity,
        name: body.name,
        filters: body.filters as Prisma.InputJsonValue,
        shared: body.shared,
      },
    });
    return this.dto(v, req.auth!.userId);
  }

  @Patch(':id')
  @RequirePermission('clients.read')
  @ApiZodBody(savedViewInputSchema.partial())
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(savedViewInputSchema.partial()) body: Partial<z.output<typeof savedViewInputSchema>>,
    @Req() req: TuelloRequest,
  ) {
    const r = await this.db.tx.savedView.updateMany({
      where: { id, userId: req.auth!.userId },
      data: {
        ...body,
        ...(body.filters ? { filters: body.filters as Prisma.InputJsonValue } : {}),
      },
    });
    if (r.count === 0) throw new Problem('not_found');
    return this.dto(
      await this.db.tx.savedView.findUniqueOrThrow({ where: { id } }),
      req.auth!.userId,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('clients.read')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.savedView.deleteMany({ where: { id, userId: req.auth!.userId } });
    if (r.count === 0) throw new Problem('not_found');
  }
}
