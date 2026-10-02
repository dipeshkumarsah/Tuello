import type { Database, TxClient } from '@tuello/db';
import { Prisma } from '@tuello/db';
import {
  IMPORT_BATCH_SIZE,
  parseImportRow,
  type BrokerageImportRow,
  type ClientImportRow,
  type ImportJobData,
  type ImportMapping,
} from '@tuello/shared';
import type { Job } from 'bullmq';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify/sync';
import type { Log } from '../infra/logger';
import type { Storage } from '../infra/storage';

interface RawRow {
  line: number;
  raw: Record<string, string>;
}

interface RowError {
  line: number;
  raw: Record<string, string>;
  errors: string[];
}

interface Counts {
  created: number;
  updated: number;
}

const sortName = (c: { firstName: string; lastName: string; email: string | null }) =>
  `${c.lastName} ${c.firstName} ${c.email ?? ''}`.trim().toLowerCase().slice(0, 400);
const nameKey = (first: string, last: string, phone: string | null) =>
  `${first} ${last}`.trim().toLowerCase() + '|' + (phone ?? '');

/**
 * CSV import job. Streams the file from object storage (never loads it whole), validates every
 * row with the same rules as the API preview, and upserts in batches of IMPORT_BATCH_SIZE, one
 * transaction per batch. Idempotent: rows match existing records by external ID, then email,
 * then name + phone, so re-running a file updates instead of duplicating. Invalid rows go to a
 * downloadable error report (the original columns plus an "Errors" column).
 */
export class ImportProcessor {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly log: Log,
  ) {}

  process = async (job: Job<ImportJobData>) => {
    const { tenantId, importId, userId } = job.data;
    const ctx = { tenantId, userId: null };
    const imp = await this.db.withTenant(ctx, (tx) =>
      tx.importJob.findFirst({ where: { id: importId } }),
    );
    if (!imp) return { skipped: 'missing' };
    if (imp.status === 'completed') return { skipped: 'already-completed' };
    const mapping = (imp.mapping ?? {}) as ImportMapping;
    await this.db.withTenant(ctx, (tx) =>
      tx.importJob.update({
        where: { id: importId },
        data: {
          status: 'running',
          startedAt: new Date(),
          processedRows: 0,
          createdCount: 0,
          updatedCount: 0,
          errorCount: 0,
          totalRows: 0,
          lastError: null,
        },
      }),
    );

    const errors: RowError[] = [];
    const counts: Counts = { created: 0, updated: 0 };
    let headers: string[] = [];
    let processed = 0;
    try {
      const parser = (await this.storage.stream(imp.fileKey)).pipe(
        parse({
          bom: true,
          relax_column_count: true,
          skip_empty_lines: true,
          skip_records_with_empty_values: true,
          info: true,
          columns: (h: string[]) => (headers = h.map((x, i) => x.trim() || `Column ${i + 1}`)),
        }),
      );
      let batch: RawRow[] = [];
      const flush = async () => {
        if (!batch.length) return;
        const rows = batch;
        batch = [];
        await this.processBatch(tenantId, userId, imp.entity, mapping, rows, errors, counts);
        processed += rows.length;
        await this.db.withTenant(ctx, (tx) =>
          tx.importJob.update({
            where: { id: importId },
            data: {
              processedRows: processed,
              createdCount: counts.created,
              updatedCount: counts.updated,
              errorCount: errors.length,
            },
          }),
        );
        await job.updateProgress(processed);
      };
      for await (const rec of parser as AsyncIterable<{
        record: Record<string, string>;
        info: { lines: number };
      }>) {
        batch.push({ line: rec.info.lines, raw: rec.record });
        if (batch.length >= IMPORT_BATCH_SIZE) await flush();
      }
      await flush();

      let errorReportKey: string | null = null;
      if (errors.length) {
        errorReportKey = imp.fileKey.replace(/\.csv$/, '') + '-errors.csv';
        const cols = ['Line', ...headers, 'Errors'];
        const csv = stringify([
          cols,
          ...errors.map((e) => [
            String(e.line),
            ...headers.map((h) => e.raw[h] ?? ''),
            e.errors.join('; '),
          ]),
        ]);
        await this.storage.put(errorReportKey, csv);
      }
      await this.db.withTenant(ctx, async (tx) => {
        await tx.importJob.update({
          where: { id: importId },
          data: {
            status: 'completed',
            finishedAt: new Date(),
            totalRows: processed,
            processedRows: processed,
            createdCount: counts.created,
            updatedCount: counts.updated,
            errorCount: errors.length,
            errorReportKey,
          },
        });
        await tx.outboxEvent.create({
          data: {
            tenantId,
            name: 'import.completed',
            aggregateType: 'import',
            aggregateId: importId,
            payload: {
              entity: imp.entity,
              rows: processed,
              created: counts.created,
              updated: counts.updated,
              errors: errors.length,
            },
          },
        });
      });
      this.log.info(
        { tenantId, importId, rows: processed, ...counts, errors: errors.length },
        'import completed',
      );
      return { rows: processed, ...counts, errors: errors.length };
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      await this.db.withTenant(ctx, async (tx) => {
        await tx.importJob.update({
          where: { id: importId },
          data: { status: 'failed', lastError: message, finishedAt: new Date() },
        });
        await tx.outboxEvent.create({
          data: {
            tenantId,
            name: 'import.failed',
            aggregateType: 'import',
            aggregateId: importId,
            payload: { error: message },
          },
        });
      });
      throw err;
    }
  };

  private async processBatch(
    tenantId: string,
    userId: string | null,
    entity: 'clients' | 'brokerages',
    mapping: ImportMapping,
    rows: RawRow[],
    errors: RowError[],
    counts: Counts,
  ) {
    const valid: Array<{
      line: number;
      raw: Record<string, string>;
      value: ClientImportRow | BrokerageImportRow;
    }> = [];
    for (const r of rows) {
      const parsed =
        entity === 'clients'
          ? parseImportRow('clients', r.raw, mapping)
          : parseImportRow('brokerages', r.raw, mapping);
      if (parsed.ok) valid.push({ ...r, value: parsed.value });
      else errors.push({ ...r, errors: parsed.errors });
    }
    if (!valid.length) return;
    const run = (items: typeof valid) =>
      this.db.withTenant(
        { tenantId, userId },
        async (tx) => {
          const local: Counts = { created: 0, updated: 0 };
          const rowErrors: RowError[] = [];
          if (entity === 'clients') {
            await this.upsertClients(
              tx,
              tenantId,
              userId,
              items as Array<{ line: number; raw: Record<string, string>; value: ClientImportRow }>,
              local,
              rowErrors,
            );
          } else {
            await this.upsertBrokerages(
              tx,
              tenantId,
              items as Array<{
                line: number;
                raw: Record<string, string>;
                value: BrokerageImportRow;
              }>,
              local,
              rowErrors,
            );
          }
          return { local, rowErrors };
        },
        { timeoutMs: 120_000 },
      );
    try {
      const { local, rowErrors } = await run(valid);
      counts.created += local.created;
      counts.updated += local.updated;
      errors.push(...rowErrors);
    } catch (err) {
      // Isolate the offending row(s): retry one row per transaction.
      this.log.warn(
        { tenantId, err: (err as Error).message },
        'import batch failed, retrying row by row',
      );
      for (const item of valid) {
        try {
          const { local, rowErrors } = await run([item]);
          counts.created += local.created;
          counts.updated += local.updated;
          errors.push(...rowErrors);
        } catch (e) {
          errors.push({ line: item.line, raw: item.raw, errors: [friendly(e)] });
        }
      }
    }
  }

  private async upsertBrokerages(
    tx: TxClient,
    tenantId: string,
    items: Array<{ line: number; raw: Record<string, string>; value: BrokerageImportRow }>,
    counts: Counts,
    _errors: RowError[],
  ) {
    const existing = await tx.brokerage.findMany({
      where: {
        deletedAt: null,
        OR: [
          {
            externalRef: {
              in: items.map((i) => i.value.externalRef).filter((x): x is string => !!x),
            },
          },
          { name: { in: items.map((i) => i.value.name), mode: 'insensitive' } },
        ],
      },
    });
    const byRef = new Map(existing.filter((b) => b.externalRef).map((b) => [b.externalRef!, b.id]));
    const byName = new Map(existing.map((b) => [b.name.toLowerCase(), b.id]));
    for (const { value: v } of items) {
      const id = (v.externalRef && byRef.get(v.externalRef)) || byName.get(v.name.toLowerCase());
      const data = stripNulls({ ...v });
      if (id) {
        await tx.brokerage.update({ where: { id }, data });
        counts.updated += 1;
      } else {
        const b = await tx.brokerage.create({ data: { ...data, name: v.name, tenantId } });
        byName.set(v.name.toLowerCase(), b.id);
        if (v.externalRef) byRef.set(v.externalRef, b.id);
        counts.created += 1;
      }
    }
  }

  private async upsertClients(
    tx: TxClient,
    tenantId: string,
    userId: string | null,
    items: Array<{ line: number; raw: Record<string, string>; value: ClientImportRow }>,
    counts: Counts,
    errors: RowError[],
  ) {
    // Brokerages and tags by name: find, create the missing ones, re-read.
    const brokerageNames = [
      ...new Set(items.map((i) => i.value.brokerage).filter((x): x is string => !!x)),
    ];
    const brokerageIds = new Map<string, string>();
    if (brokerageNames.length) {
      const found = await tx.brokerage.findMany({
        where: { deletedAt: null, name: { in: brokerageNames, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      for (const b of found) brokerageIds.set(b.name.toLowerCase(), b.id);
      const missing = brokerageNames.filter((n) => !brokerageIds.has(n.toLowerCase()));
      const uniqueMissing = [...new Map(missing.map((n) => [n.toLowerCase(), n])).values()];
      for (const name of uniqueMissing) {
        const b = await tx.brokerage.create({ data: { tenantId, name } });
        brokerageIds.set(name.toLowerCase(), b.id);
      }
    }
    const tagNames = [...new Set(items.flatMap((i) => i.value.tags.map((t) => t.toLowerCase())))];
    const tagIds = new Map<string, string>();
    if (tagNames.length) {
      await tx.$executeRaw`INSERT INTO tags (tenant_id, name) SELECT ${tenantId}::uuid, n FROM unnest(${tagNames}::text[]) AS n ON CONFLICT DO NOTHING`;
      const tags = await tx.tag.findMany({
        where: { name: { in: tagNames, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      for (const t of tags) tagIds.set(t.name.toLowerCase(), t.id);
    }

    // Existing clients that any row could match.
    const refs = items.map((i) => i.value.externalRef).filter((x): x is string => !!x);
    const emails = items.map((i) => i.value.email).filter((x): x is string => !!x);
    const phones = items.map((i) => i.value.phoneNormalized).filter((x): x is string => !!x);
    const existing = await tx.client.findMany({
      where: {
        deletedAt: null,
        OR: [
          { externalRef: { in: refs } },
          { email: { in: emails } },
          { phoneNormalized: { in: phones } },
        ],
      },
      select: {
        id: true,
        externalRef: true,
        email: true,
        phoneNormalized: true,
        firstName: true,
        lastName: true,
      },
    });
    const byRef = new Map<string, string>();
    const byEmail = new Map<string, string>();
    const byNamePhone = new Map<string, string>();
    const remember = (c: {
      id: string;
      externalRef: string | null;
      email: string | null;
      phoneNormalized: string | null;
      firstName: string;
      lastName: string;
    }) => {
      if (c.externalRef) byRef.set(c.externalRef, c.id);
      if (c.email) byEmail.set(c.email, c.id);
      if (c.phoneNormalized)
        byNamePhone.set(nameKey(c.firstName, c.lastName, c.phoneNormalized), c.id);
    };
    existing.forEach(remember);

    const newClientIds: string[] = [];
    const tagLinks: Array<{ tenantId: string; clientId: string; tagId: string }> = [];
    for (const item of items) {
      const v = item.value;
      const matchId =
        (v.externalRef && byRef.get(v.externalRef)) ||
        (v.email && byEmail.get(v.email)) ||
        (v.phoneNormalized &&
          (v.firstName || v.lastName) &&
          byNamePhone.get(nameKey(v.firstName, v.lastName, v.phoneNormalized))) ||
        null;
      if (matchId && v.email && byEmail.has(v.email) && byEmail.get(v.email) !== matchId) {
        errors.push({
          line: item.line,
          raw: item.raw,
          errors: [`Email ${v.email} belongs to another client`],
        });
        continue;
      }
      const fields = stripNulls({
        firstName: v.firstName || null,
        lastName: v.lastName || null,
        email: v.email,
        phone: v.phone,
        phoneNormalized: v.phoneNormalized,
        company: v.company,
        title: v.title,
        externalRef: v.externalRef,
        addressLine1: v.addressLine1,
        city: v.city,
        region: v.region,
        postalCode: v.postalCode,
        brokerageId: v.brokerage ? (brokerageIds.get(v.brokerage.toLowerCase()) ?? null) : null,
      });
      let clientId: string;
      if (matchId) {
        const current = await tx.client.findUniqueOrThrow({
          where: { id: matchId },
          select: { firstName: true, lastName: true, email: true },
        });
        const merged = { ...current, ...fields } as {
          firstName: string;
          lastName: string;
          email: string | null;
        };
        const c = await tx.client.update({
          where: { id: matchId },
          data: { ...(fields as Prisma.ClientUncheckedUpdateInput), sortName: sortName(merged) },
        });
        remember(c);
        clientId = matchId;
        counts.updated += 1;
      } else {
        const c = await tx.client.create({
          data: {
            ...(fields as Omit<Prisma.ClientUncheckedCreateInput, 'tenantId' | 'sortName'>),
            tenantId,
            firstName: v.firstName,
            lastName: v.lastName,
            sortName: sortName({ firstName: v.firstName, lastName: v.lastName, email: v.email }),
          },
        });
        remember(c);
        clientId = c.id;
        newClientIds.push(c.id);
        counts.created += 1;
      }
      for (const t of v.tags) {
        const tagId = tagIds.get(t.toLowerCase());
        if (tagId) tagLinks.push({ tenantId, clientId, tagId });
      }
    }
    if (tagLinks.length) await tx.clientTag.createMany({ data: tagLinks, skipDuplicates: true });
    if (newClientIds.length) {
      await tx.clientActivity.createMany({
        data: newClientIds.map((clientId) => ({
          tenantId,
          clientId,
          type: 'imported',
          actorUserId: userId,
        })),
      });
    }
  }
}

function stripNulls<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Partial<T>;
}

function friendly(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    return 'Conflicts with an existing record (duplicate email or external ID)';
  return 'Could not save this row';
}
