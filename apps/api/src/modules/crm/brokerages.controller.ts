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
  brokerageInputSchema,
  brokerageUpdateSchema,
  cursorPageQuerySchema,
  noteInputSchema,
  type BrokerageDto,
  type CursorPage,
  type NoteDto,
} from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../common/zod';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { toBrokerageDto } from './crm.mapper';
import { CrmService } from './crm.service';

const listSchema = cursorPageQuerySchema.extend({ q: z.string().trim().max(200).optional() });

function conflict(err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new Problem('conflict', 'A brokerage with this name already exists.', [
      { path: 'name', code: 'taken', message: 'A brokerage with this name already exists.' },
    ]);
  }
  return err;
}

@ApiTags('brokerages')
@Controller({ path: 'brokerages', version: '1' })
export class BrokeragesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crm: CrmService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** Cursor pagination by name; `q` filters by name, email or city (trigram index). */
  @Get()
  @RequirePermission('clients.read')
  @ApiZodQuery(listSchema)
  async list(@ZQuery(listSchema) q: z.infer<typeof listSchema>): Promise<CursorPage<BrokerageDto>> {
    let after: { name: string; id: string } | null = null;
    if (q.cursor) {
      try {
        const [name, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as [
          string,
          string,
        ];
        after = { name, id };
      } catch {
        throw new Problem('validation_failed', 'Invalid cursor.');
      }
    }
    let ids: string[] | undefined;
    if (q.q) {
      const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await this.db.tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM brokerages WHERE tenant_id = ${this.db.context()!.tenantId}::uuid AND deleted_at IS NULL AND search_text LIKE ${like} LIMIT 500`;
      ids = rows.map((r) => r.id);
    }
    const rows = await this.db.tx.brokerage.findMany({
      where: {
        deletedAt: null,
        ...(ids ? { id: { in: ids } } : {}),
        ...(after
          ? { OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: { _count: { select: { clients: { where: { deletedAt: null } } } } },
    });
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toBrokerageDto),
      nextCursor:
        more && last
          ? Buffer.from(JSON.stringify([last.name, last.id])).toString('base64url')
          : null,
    };
  }

  @Get(':id')
  @RequirePermission('clients.read')
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<BrokerageDto> {
    const b = await this.db.tx.brokerage.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { clients: { where: { deletedAt: null } } } } },
    });
    if (!b) throw new Problem('not_found');
    return toBrokerageDto(b);
  }

  @Post()
  @RequirePermission('clients.manage')
  @ApiZodBody(brokerageInputSchema)
  async create(
    @ZBody(brokerageInputSchema) body: z.output<typeof brokerageInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<BrokerageDto> {
    await this.crm.assertBelongs('clientPriceList', [body.priceListId]);
    try {
      const b = await this.db.tx.brokerage.create({ data: { ...body, tenantId: req.tenant!.id } });
      await this.events.emit('brokerage.created', { type: 'brokerage', id: b.id });
      return toBrokerageDto(b);
    } catch (err) {
      throw conflict(err);
    }
  }

  @Patch(':id')
  @RequirePermission('clients.manage')
  @ApiZodBody(brokerageUpdateSchema)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(brokerageUpdateSchema) body: z.output<typeof brokerageUpdateSchema>,
  ): Promise<BrokerageDto> {
    await this.crm.assertBelongs('clientPriceList', [body.priceListId]);
    const exists = await this.db.tx.brokerage.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new Problem('not_found');
    try {
      const b = await this.db.tx.brokerage.update({ where: { id }, data: body });
      await this.events.emit(
        'brokerage.updated',
        { type: 'brokerage', id },
        { fields: Object.keys(body) },
      );
      return toBrokerageDto(b);
    } catch (err) {
      throw conflict(err);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('clients.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const clients = await this.db.tx.client.count({ where: { brokerageId: id, deletedAt: null } });
    if (clients > 0)
      throw new Problem('conflict', 'Move or remove this brokerage’s clients first.');
    const r = await this.db.tx.brokerage.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (r.count === 0) throw new Problem('not_found');
    await this.events.emit('brokerage.deleted', { type: 'brokerage', id });
    await this.audit.record(req, 'brokerage.deleted', { type: 'brokerage', id });
  }

  @Get(':id/notes')
  @RequirePermission('clients.read')
  async notes(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ items: NoteDto[] }> {
    await this.get(id);
    const rows = await this.db.tx.note.findMany({
      where: { brokerageId: id, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { author: { select: { id: true, name: true } } },
    });
    return {
      items: rows.map((n) => ({
        id: n.id,
        body: n.body,
        pinned: n.pinned,
        author: n.author,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  @Post(':id/notes')
  @RequirePermission('clients.manage')
  @ApiZodBody(noteInputSchema)
  async addNote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(noteInputSchema) body: z.output<typeof noteInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<NoteDto> {
    await this.get(id);
    const n = await this.db.tx.note.create({
      data: {
        tenantId: req.tenant!.id,
        brokerageId: id,
        body: body.body,
        pinned: body.pinned,
        authorUserId: req.auth!.userId,
      },
    });
    await this.events.emit('client.note_added', { type: 'brokerage', id }, { noteId: n.id });
    return {
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      author: { id: req.auth!.userId, name: req.auth!.name },
      createdAt: n.createdAt.toISOString(),
    };
  }
}
