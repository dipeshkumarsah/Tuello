import type { Database } from '@tuello/db';
import type { ExportEntity, ExportJobData } from '@tuello/shared';
import type { Job } from 'bullmq';
import { stringify } from 'csv-stringify';
import { PassThrough } from 'node:stream';
import type { Log } from '../infra/logger';
import type { Storage } from '../infra/storage';

const PAGE = 1000;
const money = (minor: number | null | undefined) => (minor == null ? '' : (minor / 100).toFixed(2));

type Row = Record<string, string | number | boolean | null>;

/**
 * CSV exports of every Phase 2 list. Reads in keyset pages (one short tenant transaction each)
 * and streams the CSV straight to object storage, so memory stays flat for any size.
 * Money columns are written in major units for spreadsheets.
 */
export class ExportProcessor {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly log: Log,
  ) {}

  process = async (job: Job<ExportJobData>) => {
    const { tenantId, exportId, entity, filters } = job.data;
    const ctx = { tenantId };
    const fileKey = `${tenantId}/exports/${exportId}.csv`;
    await this.db.withTenant(ctx, (tx) =>
      tx.exportJob.update({ where: { id: exportId }, data: { status: 'running' } }),
    );
    try {
      const out = new PassThrough();
      const csv = stringify({ header: true, columns: COLUMNS[entity] });
      csv.pipe(out);
      const uploading = this.storage.upload(fileKey, out);
      let count = 0;
      let after: string | null = null;
      for (;;) {
        const rows = await this.page(tenantId, entity, filters, after);
        for (const r of rows) {
          if (!csv.write(r)) await new Promise((resolve) => csv.once('drain', resolve));
        }
        count += rows.length;
        if (rows.length < PAGE) break;
        after = String(rows[rows.length - 1]!.id);
      }
      csv.end();
      await uploading;
      await this.db.withTenant(ctx, (tx) =>
        tx.exportJob.update({
          where: { id: exportId },
          data: { status: 'completed', fileKey, rowCount: count, finishedAt: new Date() },
        }),
      );
      this.log.info({ tenantId, exportId, entity, rows: count }, 'export completed');
      return { rows: count };
    } catch (err) {
      await this.db.withTenant(ctx, (tx) =>
        tx.exportJob.update({
          where: { id: exportId },
          data: {
            status: 'failed',
            lastError: (err as Error).message.slice(0, 500),
            finishedAt: new Date(),
          },
        }),
      );
      throw err;
    }
  };

  private page(
    tenantId: string,
    entity: ExportEntity,
    filters: Record<string, unknown>,
    after: string | null,
  ): Promise<Row[]> {
    const cursor = after ? { id: { gt: after } } : {};
    return this.db.withTenant({ tenantId }, async (tx) => {
      switch (entity) {
        case 'clients': {
          const f = filters as {
            brokerageId?: string;
            tagId?: string;
            status?: 'active' | 'archived';
            priceListId?: string;
          };
          const rows = await tx.client.findMany({
            where: {
              deletedAt: null,
              ...cursor,
              ...(f.brokerageId ? { brokerageId: f.brokerageId } : {}),
              ...(f.status ? { status: f.status } : {}),
              ...(f.priceListId ? { priceListId: f.priceListId } : {}),
              ...(f.tagId ? { tags: { some: { tagId: f.tagId } } } : {}),
            },
            orderBy: { id: 'asc' },
            take: PAGE,
            include: {
              brokerage: { select: { name: true } },
              tags: { include: { tag: { select: { name: true } } } },
              priceList: { select: { name: true } },
            },
          });
          return rows.map((c) => ({
            id: c.id,
            first_name: c.firstName,
            last_name: c.lastName,
            email: c.email,
            phone: c.phone,
            company: c.company,
            title: c.title,
            brokerage: c.brokerage?.name ?? null,
            tags: c.tags.map((t) => t.tag.name).join(', '),
            price_list: c.priceList?.name ?? null,
            status: c.status,
            external_id: c.externalRef,
            address: c.addressLine1,
            city: c.city,
            region: c.region,
            postal_code: c.postalCode,
            created_at: c.createdAt.toISOString(),
          }));
        }
        case 'brokerages': {
          const rows = await tx.brokerage.findMany({
            where: { deletedAt: null, ...cursor },
            orderBy: { id: 'asc' },
            take: PAGE,
            include: { _count: { select: { clients: { where: { deletedAt: null } } } } },
          });
          return rows.map((b) => ({
            id: b.id,
            name: b.name,
            email: b.email,
            phone: b.phone,
            website: b.website,
            external_id: b.externalRef,
            address: b.addressLine1,
            city: b.city,
            region: b.region,
            postal_code: b.postalCode,
            clients: b._count.clients,
          }));
        }
        case 'services': {
          const rows = await tx.serviceVariant.findMany({
            where: { deletedAt: null, ...cursor },
            orderBy: { id: 'asc' },
            take: PAGE,
            include: { service: { include: { requiredSkill: true } } },
          });
          return rows.map((v) => ({
            id: v.id,
            service: v.service.name,
            variant: v.name,
            category: v.service.category,
            base_price: money(v.basePrice),
            duration_minutes: v.durationMinutes ?? v.service.durationMinutes,
            required_skill: v.service.requiredSkill?.name ?? null,
            deliverable: v.service.deliverableType,
            active: v.active && v.service.active,
          }));
        }
        case 'add_ons': {
          const rows = await tx.addOn.findMany({
            where: { deletedAt: null, ...cursor },
            orderBy: { id: 'asc' },
            take: PAGE,
            include: { service: true },
          });
          return rows.map((a) => ({
            id: a.id,
            name: a.name,
            service: a.service?.name ?? null,
            base_price: money(a.basePrice),
            max_quantity: a.maxQuantity,
            active: a.active,
          }));
        }
        case 'packages': {
          const rows = await tx.package.findMany({
            where: { deletedAt: null, ...cursor },
            orderBy: { id: 'asc' },
            take: PAGE,
            include: { items: { include: { variant: { include: { service: true } } } } },
          });
          return rows.map((p) => ({
            id: p.id,
            name: p.name,
            base_price: money(p.basePrice),
            items: p.items
              .map((i) => `${i.quantity} x ${i.variant.service.name} ${i.variant.name}`)
              .join('; '),
            active: p.active,
          }));
        }
        case 'coupons': {
          const rows = await tx.coupon.findMany({
            where: { deletedAt: null, ...cursor },
            orderBy: { id: 'asc' },
            take: PAGE,
          });
          return rows.map((c) => ({
            id: c.id,
            code: c.code,
            kind: c.kind,
            percent_off: c.percentOffBps == null ? null : c.percentOffBps / 100,
            amount_off: money(c.amountOff),
            min_subtotal: money(c.minSubtotal),
            starts_at: c.startsAt?.toISOString() ?? null,
            expires_at: c.expiresAt?.toISOString() ?? null,
            max_redemptions: c.maxRedemptions,
            redemptions: c.redemptionCount,
            active: c.active,
          }));
        }
      }
    });
  }
}

const COLUMNS: Record<ExportEntity, string[]> = {
  clients: [
    'id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'company',
    'title',
    'brokerage',
    'tags',
    'price_list',
    'status',
    'external_id',
    'address',
    'city',
    'region',
    'postal_code',
    'created_at',
  ],
  brokerages: [
    'id',
    'name',
    'email',
    'phone',
    'website',
    'external_id',
    'address',
    'city',
    'region',
    'postal_code',
    'clients',
  ],
  services: [
    'id',
    'service',
    'variant',
    'category',
    'base_price',
    'duration_minutes',
    'required_skill',
    'deliverable',
    'active',
  ],
  add_ons: ['id', 'name', 'service', 'base_price', 'max_quantity', 'active'],
  packages: ['id', 'name', 'base_price', 'items', 'active'],
  coupons: [
    'id',
    'code',
    'kind',
    'percent_off',
    'amount_off',
    'min_subtotal',
    'starts_at',
    'expires_at',
    'max_redemptions',
    'redemptions',
    'active',
  ],
};
