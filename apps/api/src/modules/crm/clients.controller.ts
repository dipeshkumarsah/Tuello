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
  clientFiltersSchema,
  clientInputSchema,
  clientUpdateSchema,
  contactInputSchema,
  cursorPageQuerySchema,
  duplicateCheckSchema,
  mergeClientsSchema,
  noteInputSchema,
  type ActivityDto,
  type ClientDto,
  type CursorPage,
  type NoteDto,
} from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { afterCursorDesc, decodeCursor, encodeCursor } from '../../common/pagination';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../common/zod';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { clientInclude, phoneFields, sortName, toClientDto, toContactDto } from './crm.mapper';
import { CrmService } from './crm.service';

const listQuerySchema = clientFiltersSchema.extend(cursorPageQuerySchema.shape);
type ListQuery = z.infer<typeof listQuerySchema>;

function nameCursor(raw: string | undefined): { sortName: string; id: string } | null {
  if (!raw) return null;
  try {
    const [s, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [string, string];
    if (typeof s !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error();
    return { sortName: s, id };
  } catch {
    throw new Problem('validation_failed', 'Invalid cursor.');
  }
}

@ApiTags('clients')
@Controller({ path: 'clients', version: '1' })
export class ClientsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crm: CrmService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Without `q`: cursor pagination by name or by creation. With `q`: the best `limit` matches by
   * relevance (trigram + full-text over name, email, phone, company and brokerage), no cursor.
   */
  @Get()
  @RequirePermission('clients.read')
  @ApiZodQuery(listQuerySchema)
  async list(
    @ZQuery(listQuerySchema) q: ListQuery,
    @Req() req: TuelloRequest,
  ): Promise<CursorPage<ClientDto>> {
    if (q.q && q.q.trim().length > 0) {
      const ids = await this.crm.search(req.tenant!.id, q, q.limit);
      const rows = await this.db.tx.client.findMany({
        where: { id: { in: ids } },
        include: clientInclude,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return {
        items: ids
          .map((id) => byId.get(id)!)
          .filter(Boolean)
          .map(toClientDto),
        nextCursor: null,
      };
    }
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(q.brokerageId ? { brokerageId: q.brokerageId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.priceListId ? { priceListId: q.priceListId } : {}),
      ...(q.tagId ? { tags: { some: { tagId: q.tagId } } } : {}),
    };
    if (q.sort === 'created') {
      const rows = await this.db.tx.client.findMany({
        where: { ...where, ...afterCursorDesc(decodeCursor(q.cursor)) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        include: clientInclude,
      });
      const more = rows.length > q.limit;
      const page = rows.slice(0, q.limit);
      return {
        items: page.map(toClientDto),
        nextCursor: more ? encodeCursor(page[page.length - 1]!) : null,
      };
    }
    const c = nameCursor(q.cursor);
    const rows = await this.db.tx.client.findMany({
      where: {
        ...where,
        ...(c
          ? { OR: [{ sortName: { gt: c.sortName } }, { sortName: c.sortName, id: { gt: c.id } }] }
          : {}),
      },
      orderBy: [{ sortName: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: clientInclude,
    });
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toClientDto),
      nextCursor:
        more && last
          ? Buffer.from(JSON.stringify([last.sortName, last.id])).toString('base64url')
          : null,
    };
  }

  @Post('duplicates/check')
  @HttpCode(200)
  @RequirePermission('clients.read')
  @ApiZodBody(duplicateCheckSchema)
  async checkDuplicates(
    @ZBody(duplicateCheckSchema) body: z.infer<typeof duplicateCheckSchema>,
    @Req() req: TuelloRequest,
  ) {
    return {
      items: await this.crm.duplicates(
        req.tenant!.id,
        body,
        body.excludeId ? [body.excludeId] : [],
      ),
    };
  }

  @Get(':id')
  @RequirePermission('clients.read')
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<ClientDto> {
    const c = await this.db.tx.client.findFirst({
      where: { id, deletedAt: null },
      include: clientInclude,
    });
    if (!c) {
      const merged = await this.db.tx.client.findFirst({
        where: { id, mergedIntoId: { not: null } },
        select: { mergedIntoId: true },
      });
      if (merged) throw new Problem('not_found', `Merged into ${merged.mergedIntoId}`);
      throw new Problem('not_found');
    }
    return toClientDto(c);
  }

  @Post()
  @RequirePermission('clients.manage')
  @ApiZodBody(clientInputSchema)
  async create(
    @ZBody(clientInputSchema) body: z.output<typeof clientInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<ClientDto> {
    const tenantId = req.tenant!.id;
    await this.crm.assertBelongs('brokerage', [body.brokerageId]);
    await this.crm.assertBelongs('clientPriceList', [body.priceListId]);
    await this.crm.assertBelongs('tag', body.tagIds ?? []);
    await this.crm.assertUniqueClient(body);
    const { tagIds, phone, ...rest } = body;
    try {
      const c = await this.db.tx.client.create({
        data: {
          ...rest,
          tenantId,
          ...phoneFields(phone),
          sortName: sortName({
            firstName: rest.firstName,
            lastName: rest.lastName,
            email: rest.email ?? null,
          }),
          tags: tagIds?.length
            ? { create: tagIds.map((tagId) => ({ tenantId, tagId })) }
            : undefined,
        },
        include: clientInclude,
      });
      await this.crm.activity(c.id, 'created', req.auth!.userId);
      await this.events.emit('client.created', { type: 'client', id: c.id });
      return toClientDto(c);
    } catch (err) {
      throw conflictFromUnique(err);
    }
  }

  @Patch(':id')
  @RequirePermission('clients.manage')
  @ApiZodBody(clientUpdateSchema)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(clientUpdateSchema) body: z.output<typeof clientUpdateSchema>,
    @Req() req: TuelloRequest,
  ): Promise<ClientDto> {
    const before = await this.db.tx.client.findFirst({
      where: { id, deletedAt: null },
      include: { tags: true },
    });
    if (!before) throw new Problem('not_found');
    await this.crm.assertBelongs('brokerage', [body.brokerageId]);
    await this.crm.assertBelongs('clientPriceList', [body.priceListId]);
    await this.crm.assertBelongs('tag', body.tagIds ?? []);
    await this.crm.assertUniqueClient(body, id);
    const { tagIds, phone, ...rest } = body;
    const next = { ...before, ...rest };
    try {
      if (tagIds) {
        await this.db.tx.clientTag.deleteMany({
          where: { clientId: id, tagId: { notIn: tagIds } },
        });
        await this.db.tx.clientTag.createMany({
          data: tagIds.map((tagId) => ({ tenantId: req.tenant!.id, clientId: id, tagId })),
          skipDuplicates: true,
        });
      }
      const c = await this.db.tx.client.update({
        where: { id },
        data: { ...rest, ...phoneFields(phone), sortName: sortName(next) },
        include: clientInclude,
      });
      const changed = Object.keys(body).filter((k) =>
        k === 'tagIds'
          ? JSON.stringify(before.tags.map((t) => t.tagId).sort()) !==
            JSON.stringify([...(tagIds ?? [])].sort())
          : (before as Record<string, unknown>)[k] !== (c as Record<string, unknown>)[k],
      );
      if (changed.length) {
        await this.crm.activity(id, 'updated', req.auth!.userId, { fields: changed });
        await this.events.emit('client.updated', { type: 'client', id }, { fields: changed });
      }
      return toClientDto(c);
    } catch (err) {
      throw conflictFromUnique(err);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('clients.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.client.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (r.count === 0) throw new Problem('not_found');
    await this.events.emit('client.deleted', { type: 'client', id });
    await this.audit.record(req, 'client.deleted', { type: 'client', id });
  }

  // ---------------------------------------------------------------- duplicates and merge

  @Get(':id/duplicates')
  @RequirePermission('clients.read')
  async duplicates(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const c = await this.db.tx.client.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new Problem('not_found');
    return { items: await this.crm.duplicates(req.tenant!.id, c, [id]) };
  }

  @Post(':id/merge')
  @HttpCode(200)
  @RequirePermission('clients.manage')
  @ApiZodBody(mergeClientsSchema)
  async merge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(mergeClientsSchema) body: z.infer<typeof mergeClientsSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.crm.merge(req, id, body.sourceId);
    return this.get(id);
  }

  // ------------------------------------------------------------------------- contacts

  private async liveClient(id: string) {
    const c = await this.db.tx.client.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new Problem('not_found');
  }

  @Get(':id/contacts')
  @RequirePermission('clients.read')
  async contacts(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.liveClient(id);
    const rows = await this.db.tx.clientContact.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { items: rows.map(toContactDto) };
  }

  @Post(':id/contacts')
  @RequirePermission('clients.manage')
  @ApiZodBody(contactInputSchema)
  async addContact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(contactInputSchema) body: z.output<typeof contactInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.liveClient(id);
    const row = await this.db.tx.clientContact.create({
      data: { ...body, tenantId: req.tenant!.id, clientId: id },
    });
    await this.crm.activity(id, 'contact_added', req.auth!.userId, { name: row.name });
    await this.events.emit('client.updated', { type: 'client', id }, { fields: ['contacts'] });
    return toContactDto(row);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermission('clients.manage')
  @ApiZodBody(contactInputSchema.partial())
  async updateContact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @ZBody(contactInputSchema.partial()) body: Partial<z.output<typeof contactInputSchema>>,
  ) {
    const r = await this.db.tx.clientContact.updateMany({
      where: { id: contactId, clientId: id, deletedAt: null },
      data: body,
    });
    if (r.count === 0) throw new Problem('not_found');
    return toContactDto(
      await this.db.tx.clientContact.findUniqueOrThrow({ where: { id: contactId } }),
    );
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  @RequirePermission('clients.manage')
  async removeContact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
  ) {
    const r = await this.db.tx.clientContact.updateMany({
      where: { id: contactId, clientId: id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (r.count === 0) throw new Problem('not_found');
  }

  // ---------------------------------------------------------------------- notes, timeline

  @Get(':id/notes')
  @RequirePermission('clients.read')
  async notes(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ items: NoteDto[] }> {
    await this.liveClient(id);
    const rows = await this.db.tx.note.findMany({
      where: { clientId: id, deletedAt: null },
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
    await this.liveClient(id);
    const n = await this.db.tx.note.create({
      data: {
        tenantId: req.tenant!.id,
        clientId: id,
        body: body.body,
        pinned: body.pinned,
        authorUserId: req.auth!.userId,
      },
    });
    await this.crm.activity(id, 'note_added', req.auth!.userId, {
      noteId: n.id,
      excerpt: n.body.slice(0, 140),
    });
    await this.events.emit('client.note_added', { type: 'client', id }, { noteId: n.id });
    return {
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      author: { id: req.auth!.userId, name: req.auth!.name },
      createdAt: n.createdAt.toISOString(),
    };
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(204)
  @RequirePermission('clients.manage')
  async removeNote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ) {
    const r = await this.db.tx.note.updateMany({
      where: { id: noteId, clientId: id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (r.count === 0) throw new Problem('not_found');
  }

  @Get(':id/timeline')
  @RequirePermission('clients.read')
  @ApiZodQuery(cursorPageQuerySchema)
  async timeline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZQuery(cursorPageQuerySchema) q: z.infer<typeof cursorPageQuerySchema>,
  ): Promise<CursorPage<ActivityDto>> {
    await this.liveClient(id);
    const ids = await this.crm.mergedIds(id);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.tx.clientActivity.findMany({
      where: {
        clientId: { in: ids },
        ...(cursor
          ? {
              OR: [
                { occurredAt: { lt: cursor.createdAt } },
                { occurredAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: { actor: { select: { id: true, name: true } } },
    });
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((a) => ({
        id: a.id,
        type: a.type,
        actor: a.actor,
        data: a.data as Record<string, unknown>,
        occurredAt: a.occurredAt.toISOString(),
      })),
      nextCursor: more && last ? encodeCursor({ createdAt: last.occurredAt, id: last.id }) : null,
    };
  }
}

export function conflictFromUnique(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = JSON.stringify(err.meta?.target ?? err.message);
    if (target.includes('email'))
      return new Problem('conflict', 'A client with this email already exists.', [
        { path: 'email', code: 'taken', message: 'A client with this email already exists.' },
      ]);
    if (target.includes('external_ref'))
      return new Problem('conflict', 'This external ID is already used.', [
        { path: 'externalRef', code: 'taken', message: 'This external ID is already used.' },
      ]);
    return new Problem('conflict');
  }
  return err;
}
