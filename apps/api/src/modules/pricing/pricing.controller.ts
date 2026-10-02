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
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ensureTenantDefaults, Prisma, type Database } from '@tuello/db';
import {
  couponInputSchema,
  cursorPageQuerySchema,
  ITEM_KINDS,
  priceListEntriesSchema,
  priceListInputSchema,
  priceListUpdateSchema,
  priceRulesForItemSchema,
  propertyTypeInputSchema,
  quoteRequestSchema,
  sizeBandInputSchema,
  taxRateInputSchema,
  territoryInputSchema,
  territoryUpdateSchema,
  travelFeeRuleInputSchema,
  type CouponDto,
  type CouponInput,
  type CursorPage,
  type ItemKind,
  type PriceListDto,
  type PricingCatalog,
  type QuoteRequest,
  type TerritoryDto,
} from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { afterCursorDesc, decodeCursor, toPage } from '../../common/pagination';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../common/zod';
import { DB } from '../../infra/tokens';
import { PricingService, type QuoteResponse } from './pricing.service';

const notFound = () => new Problem('not_found');

/** Constraint errors that Prisma does not map to a known code (exclusion, check). */
function constraintProblem(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('size_bands_no_overlap')) {
    return new Problem('conflict', 'This size band overlaps another one.', [
      { path: 'minSize', code: 'overlap', message: 'This size band overlaps another one.' },
    ]);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    return new Problem('conflict', 'That already exists.');
  return err;
}

@ApiTags('pricing')
@Controller({ version: '1' })
export class PricingController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly pricing: PricingService,
  ) {}

  // ------------------------------------------------------------------ snapshot and quotes

  /** The full pricing snapshot the web order form and previews feed to the shared engine. */
  @Get('pricing/catalog')
  @RequirePermission('pricing.read')
  async catalog(@Req() req: TuelloRequest): Promise<PricingCatalog> {
    const t = await this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } });
    await ensureTenantDefaults(this.db.tx, t.id, t.measurementUnit);
    return this.pricing.catalog(t.id);
  }

  /** Prices an order with the shared engine. No side effects. */
  @Post('quotes')
  @HttpCode(200)
  @RequirePermission('pricing.read')
  @ApiZodBody(quoteRequestSchema)
  async quote(
    @ZBody(quoteRequestSchema) body: QuoteRequest,
    @Req() req: TuelloRequest,
  ): Promise<QuoteResponse> {
    return this.pricing.quote(req.tenant!.id, body);
  }

  // --------------------------------------------------------------------- property types

  @Get('property-types')
  @RequirePermission('pricing.read')
  async propertyTypes(@Req() req: TuelloRequest) {
    const t = await this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } });
    await ensureTenantDefaults(this.db.tx, t.id, t.measurementUnit);
    const rows = await this.db.tx.propertyType.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      items: rows.map((p) => ({ id: p.id, key: p.key, name: p.name, sortOrder: p.sortOrder })),
    };
  }

  @Post('property-types')
  @RequirePermission('pricing.manage')
  @ApiZodBody(propertyTypeInputSchema)
  async addPropertyType(
    @ZBody(propertyTypeInputSchema) body: z.output<typeof propertyTypeInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    try {
      const p = await this.db.tx.propertyType.create({
        data: { ...body, tenantId: req.tenant!.id },
      });
      await this.pricing.changed(
        req,
        'pricing.rules_changed',
        { type: 'property_type', id: p.id },
        'created',
        body,
      );
      return { id: p.id, key: p.key, name: p.name, sortOrder: p.sortOrder };
    } catch (err) {
      throw constraintProblem(err);
    }
  }

  @Delete('property-types/:id')
  @HttpCode(204)
  @RequirePermission('pricing.manage')
  async removePropertyType(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: TuelloRequest,
  ) {
    const r = await this.db.tx.propertyType.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), key: `deleted_${id.slice(-12)}` },
    });
    if (!r.count) throw notFound();
    await this.db.tx.priceRule.deleteMany({ where: { propertyTypeId: id } });
    await this.pricing.changed(
      req,
      'pricing.rules_changed',
      { type: 'property_type', id },
      'deleted',
    );
  }

  // ------------------------------------------------------------------------- size bands

  @Get('size-bands')
  @RequirePermission('pricing.read')
  async sizeBands(@Req() req: TuelloRequest) {
    const t = await this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } });
    await ensureTenantDefaults(this.db.tx, t.id, t.measurementUnit);
    const rows = await this.db.tx.sizeBand.findMany({
      where: { deletedAt: null },
      orderBy: { minSize: 'asc' },
    });
    return {
      unit: t.measurementUnit,
      items: rows.map((b) => ({ id: b.id, name: b.name, minSize: b.minSize, maxSize: b.maxSize })),
    };
  }

  @Post('size-bands')
  @RequirePermission('pricing.manage')
  @ApiZodBody(sizeBandInputSchema)
  async addSizeBand(
    @ZBody(sizeBandInputSchema) body: z.output<typeof sizeBandInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    try {
      const b = await this.db.tx.sizeBand.create({ data: { ...body, tenantId: req.tenant!.id } });
      await this.pricing.changed(
        req,
        'pricing.rules_changed',
        { type: 'size_band', id: b.id },
        'created',
        body,
      );
      return { id: b.id, name: b.name, minSize: b.minSize, maxSize: b.maxSize };
    } catch (err) {
      throw constraintProblem(err);
    }
  }

  @Patch('size-bands/:id')
  @RequirePermission('pricing.manage')
  @ApiZodBody(sizeBandInputSchema)
  async updateSizeBand(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(sizeBandInputSchema) body: z.output<typeof sizeBandInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    if (!(await this.db.tx.sizeBand.findFirst({ where: { id, deletedAt: null } })))
      throw notFound();
    try {
      const b = await this.db.tx.sizeBand.update({ where: { id }, data: body });
      await this.pricing.changed(
        req,
        'pricing.rules_changed',
        { type: 'size_band', id },
        'updated',
        body,
      );
      return { id: b.id, name: b.name, minSize: b.minSize, maxSize: b.maxSize };
    } catch (err) {
      throw constraintProblem(err);
    }
  }

  @Delete('size-bands/:id')
  @HttpCode(204)
  @RequirePermission('pricing.manage')
  async removeSizeBand(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.sizeBand.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw notFound();
    await this.db.tx.priceRule.deleteMany({ where: { sizeBandId: id } });
    await this.pricing.changed(req, 'pricing.rules_changed', { type: 'size_band', id }, 'deleted');
  }

  // ------------------------------------------------------------------------ price rules

  private async assertItem(kind: ItemKind, id: string) {
    const where = { id, deletedAt: null };
    const n =
      kind === 'variant'
        ? await this.db.tx.serviceVariant.count({ where })
        : kind === 'package'
          ? await this.db.tx.package.count({ where })
          : await this.db.tx.addOn.count({ where });
    if (!n)
      throw new Problem('validation_failed', undefined, [
        { path: 'itemId', code: 'not_found', message: 'Unknown item' },
      ]);
  }

  @Get('price-rules')
  @RequirePermission('pricing.read')
  async priceRules() {
    const rows = await this.db.tx.priceRule.findMany({
      orderBy: [{ itemKind: 'asc' }, { itemId: 'asc' }],
      take: 5000,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        itemKind: r.itemKind,
        itemId: r.itemId,
        sizeBandId: r.sizeBandId,
        propertyTypeId: r.propertyTypeId,
        price: r.price,
      })),
    };
  }

  /** Replaces the whole price grid (size band x property type) of one item. */
  @Put('price-rules')
  @RequirePermission('pricing.manage')
  @ApiZodBody(priceRulesForItemSchema)
  async setPriceRules(
    @ZBody(priceRulesForItemSchema) body: z.output<typeof priceRulesForItemSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.assertItem(body.itemKind, body.itemId);
    const bandIds = [
      ...new Set(body.rules.map((r) => r.sizeBandId).filter((x): x is string => !!x)),
    ];
    const typeIds = [
      ...new Set(body.rules.map((r) => r.propertyTypeId).filter((x): x is string => !!x)),
    ];
    if (
      bandIds.length &&
      (await this.db.tx.sizeBand.count({ where: { id: { in: bandIds }, deletedAt: null } })) !==
        bandIds.length
    ) {
      throw new Problem('validation_failed', undefined, [
        { path: 'rules', code: 'not_found', message: 'Unknown size band' },
      ]);
    }
    if (
      typeIds.length &&
      (await this.db.tx.propertyType.count({ where: { id: { in: typeIds }, deletedAt: null } })) !==
        typeIds.length
    ) {
      throw new Problem('validation_failed', undefined, [
        { path: 'rules', code: 'not_found', message: 'Unknown property type' },
      ]);
    }
    const keys = new Set(body.rules.map((r) => `${r.sizeBandId}|${r.propertyTypeId}`));
    if (keys.size !== body.rules.length)
      throw new Problem(
        'validation_failed',
        'Each size band and property type combination may appear once.',
      );
    await this.db.tx.priceRule.deleteMany({
      where: { itemKind: body.itemKind, itemId: body.itemId },
    });
    if (body.rules.length) {
      await this.db.tx.priceRule.createMany({
        data: body.rules.map((r) => ({
          ...r,
          tenantId: req.tenant!.id,
          itemKind: body.itemKind,
          itemId: body.itemId,
        })),
      });
    }
    await this.pricing.changed(
      req,
      'pricing.rules_changed',
      { type: 'price_rules', id: body.itemId },
      'replaced',
      { itemKind: body.itemKind, count: body.rules.length },
    );
    return { items: body.rules };
  }

  // ------------------------------------------------------------------------ price lists

  private async priceListDto(id: string): Promise<PriceListDto> {
    const pl = await this.db.tx.clientPriceList.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: true,
        _count: {
          select: {
            clients: { where: { deletedAt: null } },
            brokerages: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!pl) throw notFound();
    return {
      id: pl.id,
      name: pl.name,
      description: pl.description,
      defaultPercentOffBps: pl.defaultPercentOffBps,
      waiveTravel: pl.waiveTravel,
      active: pl.active,
      entries: pl.items.map((i) => ({
        itemKind: i.itemKind,
        itemId: i.itemId,
        fixedPrice: i.fixedPrice,
        percentOffBps: i.percentOffBps,
      })),
      clientCount: pl._count.clients,
      brokerageCount: pl._count.brokerages,
    };
  }

  @Get('price-lists')
  @RequirePermission('pricing.read')
  async priceLists() {
    const rows = await this.db.tx.clientPriceList.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true },
    });
    return { items: await Promise.all(rows.map((r) => this.priceListDto(r.id))) };
  }

  @Get('price-lists/:id')
  @RequirePermission('pricing.read')
  getPriceList(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.priceListDto(id);
  }

  @Post('price-lists')
  @RequirePermission('pricing.manage')
  @ApiZodBody(priceListInputSchema)
  async createPriceList(
    @ZBody(priceListInputSchema) body: z.output<typeof priceListInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    const pl = await this.db.tx.clientPriceList.create({
      data: { ...body, tenantId: req.tenant!.id },
    });
    await this.pricing.changed(
      req,
      'pricing.price_list_changed',
      { type: 'price_list', id: pl.id },
      'created',
      body,
    );
    return this.priceListDto(pl.id);
  }

  @Patch('price-lists/:id')
  @RequirePermission('pricing.manage')
  @ApiZodBody(priceListUpdateSchema)
  async updatePriceList(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(priceListUpdateSchema) body: z.output<typeof priceListUpdateSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.priceListDto(id);
    await this.db.tx.clientPriceList.update({ where: { id }, data: body });
    await this.pricing.changed(
      req,
      'pricing.price_list_changed',
      { type: 'price_list', id },
      'updated',
      body,
    );
    return this.priceListDto(id);
  }

  /** Replaces all entries. Each entry sets a fixed price (replaces size-band pricing) or a percent off. */
  @Put('price-lists/:id/entries')
  @RequirePermission('pricing.manage')
  @ApiZodBody(priceListEntriesSchema)
  async setEntries(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(priceListEntriesSchema) body: z.output<typeof priceListEntriesSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.priceListDto(id);
    for (const kind of ITEM_KINDS) {
      const ids = [
        ...new Set(body.entries.filter((e) => e.itemKind === kind).map((e) => e.itemId)),
      ];
      for (const itemId of ids) await this.assertItem(kind, itemId);
    }
    if (
      new Set(body.entries.map((e) => `${e.itemKind}|${e.itemId}`)).size !== body.entries.length
    ) {
      throw new Problem('validation_failed', 'Each item may appear once.');
    }
    await this.db.tx.clientPriceListItem.deleteMany({ where: { priceListId: id } });
    if (body.entries.length) {
      await this.db.tx.clientPriceListItem.createMany({
        data: body.entries.map((e) => ({ ...e, tenantId: req.tenant!.id, priceListId: id })),
      });
    }
    await this.pricing.changed(
      req,
      'pricing.price_list_changed',
      { type: 'price_list', id },
      'entries_replaced',
      { count: body.entries.length },
    );
    return this.priceListDto(id);
  }

  @Delete('price-lists/:id')
  @HttpCode(204)
  @RequirePermission('pricing.manage')
  async removePriceList(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    await this.priceListDto(id);
    // Clients and brokerages fall back to standard pricing.
    await this.db.tx.client.updateMany({ where: { priceListId: id }, data: { priceListId: null } });
    await this.db.tx.brokerage.updateMany({
      where: { priceListId: id },
      data: { priceListId: null },
    });
    await this.db.tx.clientPriceList.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.pricing.changed(
      req,
      'pricing.price_list_changed',
      { type: 'price_list', id },
      'deleted',
    );
  }

  // ------------------------------------------------------------------- territories, travel

  @Get('territories')
  @RequirePermission('pricing.read')
  async territories(): Promise<{ items: TerritoryDto[] }> {
    const rows = await this.db.tx.territory.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return {
      items: rows.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        postalPrefixes: t.postalPrefixes,
      })),
    };
  }

  @Post('territories')
  @RequirePermission('pricing.manage')
  @ApiZodBody(territoryInputSchema)
  async addTerritory(
    @ZBody(territoryInputSchema) body: z.output<typeof territoryInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<TerritoryDto> {
    const t = await this.db.tx.territory.create({ data: { ...body, tenantId: req.tenant!.id } });
    await this.pricing.changed(
      req,
      'pricing.travel_changed',
      { type: 'territory', id: t.id },
      'created',
      { name: t.name },
    );
    return { id: t.id, name: t.name, description: t.description, postalPrefixes: t.postalPrefixes };
  }

  @Patch('territories/:id')
  @RequirePermission('pricing.manage')
  @ApiZodBody(territoryUpdateSchema)
  async updateTerritory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(territoryUpdateSchema) body: z.output<typeof territoryUpdateSchema>,
    @Req() req: TuelloRequest,
  ): Promise<TerritoryDto> {
    if (!(await this.db.tx.territory.findFirst({ where: { id, deletedAt: null } })))
      throw notFound();
    const t = await this.db.tx.territory.update({ where: { id }, data: body });
    await this.pricing.changed(
      req,
      'pricing.travel_changed',
      { type: 'territory', id },
      'updated',
      { fields: Object.keys(body) },
    );
    return { id: t.id, name: t.name, description: t.description, postalPrefixes: t.postalPrefixes };
  }

  @Delete('territories/:id')
  @HttpCode(204)
  @RequirePermission('pricing.manage')
  async removeTerritory(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    if (await this.db.tx.travelFeeRule.count({ where: { territoryId: id, deletedAt: null } }))
      throw new Problem('conflict', 'Remove the travel fee rules for this territory first.');
    const r = await this.db.tx.territory.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw notFound();
    await this.pricing.changed(req, 'pricing.travel_changed', { type: 'territory', id }, 'deleted');
  }

  @Get('travel-fee-rules')
  @RequirePermission('pricing.read')
  async travelRules() {
    const rows = await this.db.tx.travelFeeRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
    return { items: rows.map(travelDto) };
  }

  private async travelData(body: z.output<typeof travelFeeRuleInputSchema>) {
    if (body.kind === 'territory') {
      if (
        !(await this.db.tx.territory.findFirst({
          where: { id: body.territoryId, deletedAt: null },
        }))
      ) {
        throw new Problem('validation_failed', undefined, [
          { path: 'territoryId', code: 'not_found', message: 'Unknown territory' },
        ]);
      }
      return {
        name: body.name,
        kind: body.kind,
        territoryId: body.territoryId,
        fee: body.fee,
        freeKm: null,
        perKm: null,
        minFee: null,
        maxFee: null,
        priority: body.priority,
        active: body.active,
      };
    }
    return {
      name: body.name,
      kind: body.kind,
      territoryId: null,
      fee: null,
      freeKm: body.freeKm,
      perKm: body.perKm,
      minFee: body.minFee,
      maxFee: body.maxFee,
      priority: body.priority,
      active: body.active,
    };
  }

  @Post('travel-fee-rules')
  @RequirePermission('pricing.manage')
  @ApiZodBody(travelFeeRuleInputSchema)
  async addTravelRule(
    @ZBody(travelFeeRuleInputSchema) body: z.output<typeof travelFeeRuleInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    const r = await this.db.tx.travelFeeRule.create({
      data: { ...(await this.travelData(body)), tenantId: req.tenant!.id },
    });
    await this.pricing.changed(
      req,
      'pricing.travel_changed',
      { type: 'travel_fee_rule', id: r.id },
      'created',
      body,
    );
    return travelDto(r);
  }

  @Put('travel-fee-rules/:id')
  @RequirePermission('pricing.manage')
  @ApiZodBody(travelFeeRuleInputSchema)
  async replaceTravelRule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(travelFeeRuleInputSchema) body: z.output<typeof travelFeeRuleInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    if (!(await this.db.tx.travelFeeRule.findFirst({ where: { id, deletedAt: null } })))
      throw notFound();
    const r = await this.db.tx.travelFeeRule.update({
      where: { id },
      data: await this.travelData(body),
    });
    await this.pricing.changed(
      req,
      'pricing.travel_changed',
      { type: 'travel_fee_rule', id },
      'updated',
      body,
    );
    return travelDto(r);
  }

  @Delete('travel-fee-rules/:id')
  @HttpCode(204)
  @RequirePermission('pricing.manage')
  async removeTravelRule(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.travelFeeRule.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw notFound();
    await this.pricing.changed(
      req,
      'pricing.travel_changed',
      { type: 'travel_fee_rule', id },
      'deleted',
    );
  }

  // ---------------------------------------------------------------------------- coupons

  @Get('coupons')
  @RequirePermission('pricing.read')
  @ApiZodQuery(cursorPageQuerySchema)
  async coupons(
    @ZQuery(cursorPageQuerySchema) q: z.infer<typeof cursorPageQuerySchema>,
  ): Promise<CursorPage<CouponDto>> {
    const rows = await this.db.tx.coupon.findMany({
      where: { deletedAt: null, ...afterCursorDesc(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, couponDto);
  }

  /** The coupon as the pricing engine sees it (for client-side previews). */
  @Get('coupons/lookup/:code')
  @RequirePermission('pricing.read')
  async lookupCoupon(@Param('code') code: string): Promise<CouponInput> {
    const c = await this.pricing.coupon(code.slice(0, 32), null);
    if (!c) throw notFound();
    return c;
  }

  @Post('coupons')
  @RequirePermission('pricing.manage')
  @ApiZodBody(couponInputSchema)
  async addCoupon(
    @ZBody(couponInputSchema) body: z.output<typeof couponInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<CouponDto> {
    try {
      const c = await this.db.tx.coupon.create({
        data: { ...couponData(body), tenantId: req.tenant!.id },
      });
      await this.pricing.changed(
        req,
        'pricing.coupon_changed',
        { type: 'coupon', id: c.id },
        'created',
        { code: c.code },
      );
      return couponDto(c);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new Problem('conflict', 'A coupon with this code exists.', [
          { path: 'code', code: 'taken', message: 'A coupon with this code exists.' },
        ]);
      }
      throw err;
    }
  }

  @Put('coupons/:id')
  @RequirePermission('pricing.manage')
  @ApiZodBody(couponInputSchema)
  async replaceCoupon(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(couponInputSchema) body: z.output<typeof couponInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<CouponDto> {
    if (!(await this.db.tx.coupon.findFirst({ where: { id, deletedAt: null } }))) throw notFound();
    try {
      const c = await this.db.tx.coupon.update({ where: { id }, data: couponData(body) });
      await this.pricing.changed(req, 'pricing.coupon_changed', { type: 'coupon', id }, 'updated', {
        code: c.code,
      });
      return couponDto(c);
    } catch (err) {
      throw constraintProblem(err);
    }
  }

  @Delete('coupons/:id')
  @HttpCode(204)
  @RequirePermission('pricing.manage')
  async removeCoupon(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.coupon.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw notFound();
    await this.pricing.changed(req, 'pricing.coupon_changed', { type: 'coupon', id }, 'deleted');
  }

  // -------------------------------------------------------------------------- tax rates

  @Get('tax-rates')
  @RequirePermission('pricing.read')
  async taxRates() {
    const rows = await this.db.tx.taxRate.findMany({
      where: { deletedAt: null },
      orderBy: [{ regionCode: 'asc' }, { name: 'asc' }],
    });
    return { items: rows.map(taxDto) };
  }

  @Post('tax-rates')
  @RequirePermission('pricing.manage')
  @ApiZodBody(taxRateInputSchema)
  async addTaxRate(
    @ZBody(taxRateInputSchema) body: z.output<typeof taxRateInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    const t = await this.db.tx.taxRate.create({ data: { ...body, tenantId: req.tenant!.id } });
    await this.pricing.changed(
      req,
      'pricing.tax_changed',
      { type: 'tax_rate', id: t.id },
      'created',
      body,
    );
    return taxDto(t);
  }

  @Put('tax-rates/:id')
  @RequirePermission('pricing.manage')
  @ApiZodBody(taxRateInputSchema)
  async replaceTaxRate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(taxRateInputSchema) body: z.output<typeof taxRateInputSchema>,
    @Req() req: TuelloRequest,
  ) {
    if (!(await this.db.tx.taxRate.findFirst({ where: { id, deletedAt: null } }))) throw notFound();
    const t = await this.db.tx.taxRate.update({ where: { id }, data: body });
    await this.pricing.changed(
      req,
      'pricing.tax_changed',
      { type: 'tax_rate', id },
      'updated',
      body,
    );
    return taxDto(t);
  }

  @Delete('tax-rates/:id')
  @HttpCode(204)
  @RequirePermission('pricing.manage')
  async removeTaxRate(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.taxRate.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw notFound();
    await this.pricing.changed(req, 'pricing.tax_changed', { type: 'tax_rate', id }, 'deleted');
  }
}

type TravelRow = Prisma.TravelFeeRuleGetPayload<object>;
function travelDto(r: TravelRow) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    territoryId: r.territoryId,
    fee: r.fee,
    freeKm: r.freeKm,
    perKm: r.perKm,
    minFee: r.minFee,
    maxFee: r.maxFee,
    priority: r.priority,
    active: r.active,
  };
}

function couponData(body: z.output<typeof couponInputSchema>) {
  return {
    ...body,
    percentOffBps: body.kind === 'percent' ? body.percentOffBps : null,
    amountOff: body.kind === 'fixed' ? body.amountOff : null,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  };
}

function couponDto(c: Prisma.CouponGetPayload<object>): CouponDto {
  return {
    id: c.id,
    code: c.code,
    description: c.description,
    kind: c.kind,
    percentOffBps: c.percentOffBps,
    amountOff: c.amountOff,
    minSubtotal: c.minSubtotal,
    startsAt: c.startsAt?.toISOString() ?? null,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    maxRedemptions: c.maxRedemptions,
    maxPerClient: c.maxPerClient,
    redemptionCount: c.redemptionCount,
    active: c.active,
  };
}

function taxDto(t: Prisma.TaxRateGetPayload<object>) {
  return {
    id: t.id,
    name: t.name,
    rateBps: t.rateBps,
    regionCode: t.regionCode,
    appliesToTravel: t.appliesToTravel,
    active: t.active,
  };
}
