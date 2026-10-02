import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Database } from '@tuello/db';
import { normalizePhone, type ClientFilters, type DuplicateDto } from '@tuello/shared';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { displayName, sortName } from './crm.mapper';

/** Escapes LIKE wildcards in user input. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** "mary jo smi" -> "mary:* & jo:* & smi:*". Only letters and digits reach to_tsquery. */
export function prefixTsQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

@Injectable()
export class CrmService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** Appends to the client timeline (append-only table). */
  async activity(
    clientId: string,
    type: string,
    actorUserId: string | null,
    data: Record<string, unknown> = {},
  ) {
    await this.db.tx.clientActivity.create({
      data: {
        tenantId: this.db.context()!.tenantId,
        clientId,
        type,
        actorUserId,
        data: data as Prisma.InputJsonValue,
      },
    });
  }

  async assertBelongs(
    model: 'brokerage' | 'clientPriceList' | 'tag',
    ids: Array<string | null | undefined>,
  ) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return;
    const delegate = this.db.tx[model] as unknown as { count(args: unknown): Promise<number> };
    const found = await delegate.count({
      where: { id: { in: wanted }, ...(model === 'tag' ? {} : { deletedAt: null }) },
    });
    if (found !== wanted.length) {
      throw new Problem('validation_failed', undefined, [
        { path: model, code: 'not_found', message: `Unknown ${model}` },
      ]);
    }
  }

  /** Precise 409s for live-row uniqueness (Prisma cannot name partial unique indexes). */
  async assertUniqueClient(
    fields: { email?: string | null; externalRef?: string | null },
    excludeId?: string,
  ) {
    const checks: Array<['email' | 'externalRef', string]> = [];
    if (fields.email) checks.push(['email', fields.email]);
    if (fields.externalRef) checks.push(['externalRef', fields.externalRef]);
    for (const [field, value] of checks) {
      const clash = await this.db.tx.client.findFirst({
        where: {
          [field]: value,
          deletedAt: null,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        const message =
          field === 'email'
            ? 'A client with this email already exists.'
            : 'This external ID is already used.';
        throw new Problem('conflict', message, [{ path: field, code: 'taken', message }]);
      }
    }
  }

  /**
   * Ranked search over name, email, phone, company, external ref (trigram + full-text) and the
   * brokerage name. Returns ids in rank order; filters are applied in SQL.
   */
  async search(tenantId: string, filters: ClientFilters, limit: number): Promise<string[]> {
    const q = (filters.q ?? '').trim().toLowerCase();
    const like = `%${likeEscape(q)}%`;
    const ts = prefixTsQuery(q);
    const digits = normalizePhone(q);
    const conds: Prisma.Sql[] = [
      Prisma.sql`c.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`c.deleted_at IS NULL`,
      Prisma.sql`(c.search_text LIKE ${like}
        ${ts ? Prisma.sql`OR c.search_vector @@ to_tsquery('simple', ${ts})` : Prisma.empty}
        OR ${q} <% c.search_text
        ${digits.length >= 4 ? Prisma.sql`OR c.phone_normalized LIKE ${`%${digits}%`}` : Prisma.empty}
        OR c.brokerage_id IN (SELECT b.id FROM brokerages b WHERE b.tenant_id = ${tenantId}::uuid AND b.deleted_at IS NULL AND b.search_text LIKE ${like}))`,
    ];
    if (filters.brokerageId) conds.push(Prisma.sql`c.brokerage_id = ${filters.brokerageId}::uuid`);
    if (filters.status) conds.push(Prisma.sql`c.status = ${filters.status}::client_status`);
    if (filters.priceListId) conds.push(Prisma.sql`c.price_list_id = ${filters.priceListId}::uuid`);
    if (filters.tagId)
      conds.push(
        Prisma.sql`EXISTS (SELECT 1 FROM client_tags ct WHERE ct.tenant_id = c.tenant_id AND ct.client_id = c.id AND ct.tag_id = ${filters.tagId}::uuid)`,
      );
    const rows = await this.db.tx.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text AS id
      FROM clients c
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY
        (lower(c.first_name || ' ' || c.last_name) LIKE ${`${likeEscape(q)}%`}) DESC,
        (c.email LIKE ${`${likeEscape(q)}%`}) DESC,
        word_similarity(${q}, c.search_text) DESC,
        c.sort_name ASC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** Likely duplicates: same email, same phone, or a very similar name at the same brokerage. */
  async duplicates(
    tenantId: string,
    c: {
      firstName?: string;
      lastName?: string;
      email?: string | null;
      phone?: string | null;
      brokerageId?: string | null;
    },
    excludeIds: string[] = [],
  ): Promise<DuplicateDto[]> {
    const email = c.email?.trim().toLowerCase() || null;
    const phone = c.phone ? normalizePhone(c.phone) : '';
    const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim().toLowerCase();
    if (!email && phone.length < 7 && name.length < 3) return [];
    const exclude = excludeIds.length
      ? Prisma.sql`AND c.id NOT IN (${Prisma.join(excludeIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty;
    const rows = await this.db.tx.$queryRaw<
      Array<{
        id: string;
        first_name: string;
        last_name: string;
        email: string | null;
        phone: string | null;
        brokerage: string | null;
        email_match: boolean;
        phone_match: boolean;
        name_sim: number;
      }>
    >`
      SELECT c.id::text AS id, c.first_name, c.last_name, c.email, c.phone, b.name AS brokerage,
        (${email}::text IS NOT NULL AND c.email = ${email}) AS email_match,
        (${phone.length >= 7} AND c.phone_normalized = ${phone}) AS phone_match,
        CASE WHEN ${name} = '' THEN 0 ELSE similarity(lower(c.first_name || ' ' || c.last_name), ${name}) END AS name_sim
      FROM clients c LEFT JOIN brokerages b ON b.id = c.brokerage_id
      WHERE c.tenant_id = ${tenantId}::uuid AND c.deleted_at IS NULL ${exclude}
        AND (
          (${email}::text IS NOT NULL AND c.email = ${email})
          OR (${phone.length >= 7} AND c.phone_normalized = ${phone})
          OR (${name} <> '' AND c.search_text % ${name}
              AND similarity(lower(c.first_name || ' ' || c.last_name), ${name}) > 0.6
              AND c.brokerage_id IS NOT DISTINCT FROM ${c.brokerageId ?? null}::uuid)
        )
      LIMIT 10`;
    return rows
      .map((r) => {
        const reasons: DuplicateDto['reasons'] = [];
        if (r.email_match) reasons.push('email');
        if (r.phone_match) reasons.push('phone');
        if (r.name_sim > 0.6) reasons.push('name');
        const score = Math.min(
          1,
          (r.email_match ? 0.6 : 0) + (r.phone_match ? 0.3 : 0) + Number(r.name_sim) * 0.4,
        );
        return {
          client: {
            id: r.id,
            displayName: displayName({
              firstName: r.first_name,
              lastName: r.last_name,
              email: r.email,
            }),
            email: r.email,
            phone: r.phone,
            brokerage: r.brokerage,
          },
          reasons,
          score: Math.round(score * 100) / 100,
        };
      })
      .filter((d) => d.reasons.length > 0)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Merges `sourceId` into `survivorId`: contacts, tags and notes move; empty fields on the
   * survivor are filled from the source; the source is soft-deleted with merged_into_id set.
   * Timeline entries stay on the source (append-only) and are shown on the survivor.
   */
  async merge(req: TuelloRequest, survivorId: string, sourceId: string) {
    if (survivorId === sourceId)
      throw new Problem('validation_failed', 'Choose two different clients.');
    const tx = this.db.tx;
    const [survivor, source] = await Promise.all([
      tx.client.findFirst({ where: { id: survivorId, deletedAt: null } }),
      tx.client.findFirst({ where: { id: sourceId, deletedAt: null } }),
    ]);
    if (!survivor || !source) throw new Problem('not_found');
    const tenantId = req.tenant!.id;

    await tx.client.update({
      where: { id: source.id },
      data: { deletedAt: new Date(), mergedIntoId: survivor.id },
    });
    await tx.clientContact.updateMany({
      where: { clientId: source.id },
      data: { clientId: survivor.id },
    });
    await tx.note.updateMany({ where: { clientId: source.id }, data: { clientId: survivor.id } });
    const sourceTags = await tx.clientTag.findMany({ where: { clientId: source.id } });
    if (sourceTags.length) {
      await tx.clientTag.createMany({
        data: sourceTags.map((t) => ({ tenantId, clientId: survivor.id, tagId: t.tagId })),
        skipDuplicates: true,
      });
      await tx.clientTag.deleteMany({ where: { clientId: source.id } });
    }

    const fill: Record<string, unknown> = {};
    for (const k of [
      'email',
      'phone',
      'phoneNormalized',
      'company',
      'title',
      'brokerageId',
      'priceListId',
      'externalRef',
      'addressLine1',
      'addressLine2',
      'city',
      'region',
      'postalCode',
      'country',
    ] as const) {
      if (survivor[k] == null && source[k] != null) fill[k] = source[k];
    }
    if (!survivor.firstName && !survivor.lastName)
      Object.assign(fill, { firstName: source.firstName, lastName: source.lastName });
    const merged = { ...survivor, ...fill } as typeof survivor;
    await tx.client.update({
      where: { id: survivor.id },
      data: { ...fill, sortName: sortName(merged) },
    });

    await this.activity(survivor.id, 'merged', req.auth!.userId, {
      sourceId: source.id,
      sourceName: displayName(source),
      filled: Object.keys(fill),
    });
    await this.events.emit(
      'client.merged',
      { type: 'client', id: survivor.id },
      { sourceId: source.id },
    );
    await this.audit.record(
      req,
      'client.merged',
      { type: 'client', id: survivor.id },
      { sourceId: source.id, filled: Object.keys(fill) },
    );
  }

  /** Clients that were merged into this one, recursively (for the combined timeline). */
  async mergedIds(clientId: string): Promise<string[]> {
    const rows = await this.db.tx.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE m AS (
        SELECT id FROM clients WHERE id = ${clientId}::uuid
        UNION SELECT c.id FROM clients c JOIN m ON c.merged_into_id = m.id
      ) SELECT id::text AS id FROM m`;
    return rows.map((r) => r.id);
  }
}
