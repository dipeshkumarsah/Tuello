import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@tuello/db';
import {
  quote,
  type CouponInput,
  type DomainEventName,
  type PriceListInput,
  type PricingCatalog,
  type QuoteRequest,
  type QuoteResult,
  type TravelFeeRule,
} from '@tuello/shared';
import type Redis from 'ioredis';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { DB, REDIS } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';

const CACHE_TTL = 600;

export interface QuoteResponse extends QuoteResult {
  context: {
    priceList: { id: string; name: string } | null;
    territory: { id: string; name: string } | null;
    client: { id: string; displayName: string } | null;
  };
}

/**
 * Loads the tenant's pricing snapshot (cached in Valkey, invalidated on every catalog/pricing
 * write) and runs the shared pricing engine. The web app runs the same engine on the same
 * snapshot (GET /v1/pricing/catalog), so previews and server quotes always agree.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  private key(tenantId: string) {
    return `pricing:catalog:${tenantId}`;
  }

  /** Call inside the write transaction; the cache is dropped after commit. */
  invalidate(tenantId: string) {
    this.db.afterCommit(() => this.redis.del(this.key(tenantId)));
  }

  /** Event + audit + cache invalidation for any catalog or pricing change. */
  async changed(
    req: TuelloRequest,
    event: DomainEventName,
    entity: { type: string; id: string | null },
    action: string,
    data: Record<string, unknown> = {},
  ) {
    await this.events.emit(event, entity, { action, ...data });
    await this.audit.record(req, `${entity.type}.${action}`, entity, data);
    this.invalidate(req.tenant!.id);
  }

  async catalog(tenantId: string): Promise<PricingCatalog> {
    const hit = await this.redis.get(this.key(tenantId));
    if (hit) return JSON.parse(hit) as PricingCatalog;
    const c = await this.loadCatalog(tenantId);
    this.db.afterCommit(() =>
      this.redis.set(this.key(tenantId), JSON.stringify(c), 'EX', CACHE_TTL),
    );
    return c;
  }

  private async loadCatalog(tenantId: string): Promise<PricingCatalog> {
    const tx = this.db.tx;
    const [tenant, bands, types, variants, packages, addOns, rules, travel, taxes] =
      await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { currency: true, measurementUnit: true },
        }),
        tx.sizeBand.findMany({ where: { deletedAt: null }, orderBy: { minSize: 'asc' } }),
        tx.propertyType.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
        tx.serviceVariant.findMany({
          where: { deletedAt: null, service: { deletedAt: null } },
          include: { service: true },
          orderBy: [{ sortOrder: 'asc' }],
        }),
        tx.package.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
        tx.addOn.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
        tx.priceRule.findMany(),
        tx.travelFeeRule.findMany({ where: { deletedAt: null } }),
        tx.taxRate.findMany({ where: { deletedAt: null } }),
      ]);
    return {
      currency: tenant.currency,
      measurementUnit: tenant.measurementUnit,
      sizeBands: bands.map((b) => ({
        id: b.id,
        name: b.name,
        minSize: b.minSize,
        maxSize: b.maxSize,
      })),
      propertyTypes: types.map((t) => ({ id: t.id, key: t.key, name: t.name })),
      variants: variants.map((v) => ({
        id: v.id,
        serviceId: v.serviceId,
        serviceName: v.service.name,
        name: v.name,
        basePrice: v.basePrice,
        taxable: v.service.taxable,
        active: v.active && v.service.active,
      })),
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        taxable: p.taxable,
        active: p.active,
      })),
      addOns: addOns.map((a) => ({
        id: a.id,
        name: a.name,
        basePrice: a.basePrice,
        taxable: a.taxable,
        active: a.active,
        serviceId: a.serviceId,
        maxQuantity: a.maxQuantity,
      })),
      priceRules: rules.map((r) => ({
        itemKind: r.itemKind,
        itemId: r.itemId,
        sizeBandId: r.sizeBandId,
        propertyTypeId: r.propertyTypeId,
        price: r.price,
      })),
      travelFeeRules: travel.map((r): TravelFeeRule =>
        r.kind === 'territory'
          ? {
              id: r.id,
              name: r.name,
              kind: 'territory',
              priority: r.priority,
              active: r.active,
              territoryId: r.territoryId!,
              fee: r.fee ?? 0,
            }
          : {
              id: r.id,
              name: r.name,
              kind: 'distance',
              priority: r.priority,
              active: r.active,
              freeKm: r.freeKm ?? 0,
              perKm: r.perKm ?? 0,
              minFee: r.minFee,
              maxFee: r.maxFee,
            },
      ),
      taxRates: taxes.map((t) => ({
        id: t.id,
        name: t.name,
        rateBps: t.rateBps,
        regionCode: t.regionCode,
        appliesToTravel: t.appliesToTravel,
        active: t.active,
      })),
    };
  }

  async priceList(id: string | null | undefined): Promise<PriceListInput | null> {
    if (!id) return null;
    const pl = await this.db.tx.clientPriceList.findFirst({
      where: { id, deletedAt: null, active: true },
      include: { items: true },
    });
    if (!pl) return null;
    return {
      id: pl.id,
      name: pl.name,
      defaultPercentOffBps: pl.defaultPercentOffBps,
      waiveTravel: pl.waiveTravel,
      entries: pl.items.map((i) => ({
        itemKind: i.itemKind,
        itemId: i.itemId,
        fixedPrice: i.fixedPrice,
        percentOffBps: i.percentOffBps,
      })),
    };
  }

  /** Coupon by code, with this client's past redemptions (including clients merged into it). */
  async coupon(
    code: string | null | undefined,
    clientId: string | null | undefined,
  ): Promise<CouponInput | null> {
    if (!code) return null;
    const c = await this.db.tx.coupon.findFirst({
      where: { code: code.toUpperCase(), deletedAt: null },
    });
    if (!c) return null;
    let clientRedemptionCount = 0;
    if (clientId) {
      const rows = await this.db.tx.$queryRaw<Array<{ n: number }>>`
        WITH RECURSIVE m AS (SELECT id FROM clients WHERE id = ${clientId}::uuid UNION SELECT c.id FROM clients c JOIN m ON c.merged_into_id = m.id)
        SELECT count(*)::int AS n FROM coupon_redemptions r WHERE r.coupon_id = ${c.id}::uuid AND r.client_id IN (SELECT id FROM m)`;
      clientRedemptionCount = rows[0]?.n ?? 0;
    }
    return {
      id: c.id,
      code: c.code,
      kind: c.kind,
      percentOffBps: c.percentOffBps,
      amountOff: c.amountOff,
      minSubtotal: c.minSubtotal,
      startsAt: c.startsAt?.toISOString() ?? null,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      maxRedemptions: c.maxRedemptions,
      redemptionCount: c.redemptionCount,
      maxPerClient: c.maxPerClient,
      clientRedemptionCount,
      active: c.active,
    };
  }

  /** Longest postal-code prefix match wins. */
  async territoryForPostalCode(
    postalCode: string | null | undefined,
  ): Promise<{ id: string; name: string } | null> {
    const pc = (postalCode ?? '').replace(/\s+/g, '').toUpperCase();
    if (!pc) return null;
    const rows = await this.db.tx.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT t.id::text AS id, t.name FROM territories t, unnest(t.postal_prefixes) AS p
      WHERE t.deleted_at IS NULL AND ${pc} LIKE replace(p, ' ', '') || '%'
      ORDER BY length(p) DESC LIMIT 1`;
    return rows[0] ?? null;
  }

  async quote(tenantId: string, req: QuoteRequest, asOf = new Date()): Promise<QuoteResponse> {
    let client: {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      priceListId: string | null;
      brokerage: { priceListId: string | null } | null;
    } | null = null;
    if (req.clientId) {
      client = await this.db.tx.client.findFirst({
        where: { id: req.clientId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          priceListId: true,
          brokerage: { select: { priceListId: true } },
        },
      });
      if (!client)
        throw new Problem('validation_failed', undefined, [
          { path: 'clientId', code: 'not_found', message: 'Unknown client' },
        ]);
    }
    const priceListId =
      req.priceListId !== undefined
        ? req.priceListId
        : (client?.priceListId ?? client?.brokerage?.priceListId ?? null);
    const [catalog, priceList, coupon] = await Promise.all([
      this.catalog(tenantId),
      this.priceList(priceListId),
      this.coupon(req.couponCode, client?.id),
    ]);
    const territory = req.property.territoryId
      ? await this.db.tx.territory.findFirst({
          where: { id: req.property.territoryId, deletedAt: null },
          select: { id: true, name: true },
        })
      : await this.territoryForPostalCode(req.property.postalCode);
    const result = quote({
      catalog,
      priceList,
      coupon,
      couponCode: req.couponCode ?? null,
      asOf: asOf.toISOString(),
      items: req.items,
      property: {
        size: req.property.size ?? null,
        sizeUnit: req.property.sizeUnit,
        propertyTypeId: req.property.propertyTypeId ?? null,
        regionCode: req.property.regionCode ?? null,
        territoryId: territory?.id ?? null,
        distanceKm: req.property.distanceKm ?? null,
      },
    });
    const name = client
      ? `${client.firstName} ${client.lastName}`.trim() || client.email || 'Client'
      : null;
    return {
      ...result,
      context: {
        priceList: priceList ? { id: priceList.id, name: priceList.name } : null,
        territory,
        client: client ? { id: client.id, displayName: name! } : null,
      },
    };
  }
}
