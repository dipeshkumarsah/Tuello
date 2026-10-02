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
import { Prisma, seedStarterCatalog, type Database } from '@tuello/db';
import {
  addOnInputSchema,
  addOnUpdateSchema,
  packageInputSchema,
  packageUpdateSchema,
  serviceInputSchema,
  serviceUpdateSchema,
  skillInputSchema,
  variantInputSchema,
  variantUpdateSchema,
  type AddOnDto,
  type PackageDto,
  type ServiceDto,
  type SkillDto,
  type VariantDto,
} from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ZBody } from '../../common/zod';
import { DB } from '../../infra/tokens';
import { PricingService } from '../pricing/pricing.service';

type VariantRow = Prisma.ServiceVariantGetPayload<object>;
const toVariant = (v: VariantRow): VariantDto => ({
  id: v.id,
  serviceId: v.serviceId,
  name: v.name,
  basePrice: v.basePrice,
  durationMinutes: v.durationMinutes,
  active: v.active,
  sortOrder: v.sortOrder,
});

function uniqueName(err: unknown, what: string) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    return new Problem('conflict', `${what} already exists.`);
  return err;
}

/** Services (with variants), packages, add-ons and skills. Prices are integer minor units. */
@ApiTags('catalog')
@Controller({ version: '1' })
export class CatalogController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly pricing: PricingService,
  ) {}

  @Get('catalog')
  @RequirePermission('catalog.read')
  async all(): Promise<{
    services: ServiceDto[];
    packages: PackageDto[];
    addOns: AddOnDto[];
    skills: SkillDto[];
  }> {
    const tx = this.db.tx;
    const [services, packages, addOns, skills] = await Promise.all([
      tx.service.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          requiredSkill: true,
          variants: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      }),
      tx.package.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { items: true },
      }),
      tx.addOn.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      tx.skill.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    ]);
    return {
      services: services.map((s) => this.serviceDto(s)),
      packages: packages.map((p) => this.packageDto(p)),
      addOns: addOns.map((a) => this.addOnDto(a)),
      skills: skills.map((s) => ({ id: s.id, name: s.name })),
    };
  }

  private serviceDto(
    s: Prisma.ServiceGetPayload<{ include: { requiredSkill: true; variants: true } }>,
  ): ServiceDto {
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      durationMinutes: s.durationMinutes,
      requiredSkill:
        s.requiredSkill && !s.requiredSkill.deletedAt
          ? { id: s.requiredSkill.id, name: s.requiredSkill.name }
          : null,
      deliverableType: s.deliverableType,
      taxable: s.taxable,
      active: s.active,
      sortOrder: s.sortOrder,
      variants: s.variants.filter((v) => !v.deletedAt).map(toVariant),
    };
  }

  private packageDto(p: Prisma.PackageGetPayload<{ include: { items: true } }>): PackageDto {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      basePrice: p.basePrice,
      taxable: p.taxable,
      active: p.active,
      sortOrder: p.sortOrder,
      items: p.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    };
  }

  private addOnDto(a: Prisma.AddOnGetPayload<object>): AddOnDto {
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      serviceId: a.serviceId,
      basePrice: a.basePrice,
      durationMinutes: a.durationMinutes,
      maxQuantity: a.maxQuantity,
      taxable: a.taxable,
      active: a.active,
      sortOrder: a.sortOrder,
    };
  }

  /** Adds the example catalog (photo, video, drone, 3D tour, floor plan, twilight, staging). */
  @Post('catalog/starter')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  async starter(@Req() req: TuelloRequest) {
    const t = await this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } });
    const created = await seedStarterCatalog(this.db.tx, t.id, t.measurementUnit);
    if (!created) throw new Problem('conflict', 'The catalog already has services.');
    await this.pricing.changed(
      req,
      'catalog.service_changed',
      { type: 'catalog', id: null },
      'starter_added',
    );
    return this.all();
  }

  // ------------------------------------------------------------------------------ skills

  @Post('skills')
  @RequirePermission('catalog.manage')
  @ApiZodBody(skillInputSchema)
  async addSkill(
    @ZBody(skillInputSchema) body: z.infer<typeof skillInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<SkillDto> {
    try {
      const s = await this.db.tx.skill.create({
        data: { tenantId: req.tenant!.id, name: body.name },
      });
      return { id: s.id, name: s.name };
    } catch (err) {
      throw uniqueName(err, 'A skill with this name');
    }
  }

  @Delete('skills/:id')
  @HttpCode(204)
  @RequirePermission('catalog.manage')
  async removeSkill(@Param('id', new ParseUUIDPipe()) id: string) {
    const used = await this.db.tx.service.count({
      where: { requiredSkillId: id, deletedAt: null },
    });
    if (used) throw new Problem('conflict', 'Services still require this skill.');
    const r = await this.db.tx.skill.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw new Problem('not_found');
  }

  // ---------------------------------------------------------------------------- services

  private async assertSkill(id: string | null | undefined) {
    if (id && !(await this.db.tx.skill.findFirst({ where: { id, deletedAt: null } }))) {
      throw new Problem('validation_failed', undefined, [
        { path: 'requiredSkillId', code: 'not_found', message: 'Unknown skill' },
      ]);
    }
  }

  private async loadService(id: string) {
    const s = await this.db.tx.service.findFirst({
      where: { id, deletedAt: null },
      include: {
        requiredSkill: true,
        variants: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }] },
      },
    });
    if (!s) throw new Problem('not_found');
    return s;
  }

  @Post('services')
  @RequirePermission('catalog.manage')
  @ApiZodBody(serviceInputSchema)
  async createService(
    @ZBody(serviceInputSchema) body: z.output<typeof serviceInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<ServiceDto> {
    await this.assertSkill(body.requiredSkillId);
    const s = await this.db.tx.service.create({ data: { ...body, tenantId: req.tenant!.id } });
    await this.pricing.changed(
      req,
      'catalog.service_changed',
      { type: 'service', id: s.id },
      'created',
      { name: s.name },
    );
    return this.serviceDto(await this.loadService(s.id));
  }

  @Patch('services/:id')
  @RequirePermission('catalog.manage')
  @ApiZodBody(serviceUpdateSchema)
  async updateService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(serviceUpdateSchema) body: z.output<typeof serviceUpdateSchema>,
    @Req() req: TuelloRequest,
  ): Promise<ServiceDto> {
    await this.loadService(id);
    await this.assertSkill(body.requiredSkillId);
    await this.db.tx.service.update({ where: { id }, data: body });
    await this.pricing.changed(req, 'catalog.service_changed', { type: 'service', id }, 'updated', {
      fields: Object.keys(body),
    });
    return this.serviceDto(await this.loadService(id));
  }

  @Delete('services/:id')
  @HttpCode(204)
  @RequirePermission('catalog.manage')
  async removeService(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    await this.loadService(id);
    const now = new Date();
    await this.db.tx.serviceVariant.updateMany({
      where: { serviceId: id, deletedAt: null },
      data: { deletedAt: now },
    });
    await this.db.tx.service.update({ where: { id }, data: { deletedAt: now } });
    await this.pricing.changed(req, 'catalog.service_changed', { type: 'service', id }, 'deleted');
  }

  @Post('services/:id/variants')
  @RequirePermission('catalog.manage')
  @ApiZodBody(variantInputSchema)
  async addVariant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(variantInputSchema) body: z.output<typeof variantInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<VariantDto> {
    await this.loadService(id);
    const v = await this.db.tx.serviceVariant.create({
      data: { ...body, tenantId: req.tenant!.id, serviceId: id },
    });
    await this.pricing.changed(
      req,
      'catalog.service_changed',
      { type: 'variant', id: v.id },
      'created',
      { serviceId: id, basePrice: v.basePrice },
    );
    return toVariant(v);
  }

  @Patch('variants/:id')
  @RequirePermission('catalog.manage')
  @ApiZodBody(variantUpdateSchema)
  async updateVariant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(variantUpdateSchema) body: z.output<typeof variantUpdateSchema>,
    @Req() req: TuelloRequest,
  ): Promise<VariantDto> {
    const before = await this.db.tx.serviceVariant.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new Problem('not_found');
    const v = await this.db.tx.serviceVariant.update({ where: { id }, data: body });
    await this.pricing.changed(req, 'catalog.service_changed', { type: 'variant', id }, 'updated', {
      from: { basePrice: before.basePrice },
      to: { basePrice: v.basePrice },
    });
    return toVariant(v);
  }

  @Delete('variants/:id')
  @HttpCode(204)
  @RequirePermission('catalog.manage')
  async removeVariant(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const inPackage = await this.db.tx.packageItem.count({
      where: { variantId: id, package: { deletedAt: null } },
    });
    if (inPackage) throw new Problem('conflict', 'Remove this variant from its packages first.');
    const r = await this.db.tx.serviceVariant.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw new Problem('not_found');
    await this.pricing.changed(req, 'catalog.service_changed', { type: 'variant', id }, 'deleted');
  }

  // ---------------------------------------------------------------------------- packages

  private async assertVariants(ids: string[]) {
    const unique = [...new Set(ids)];
    const n = await this.db.tx.serviceVariant.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (n !== unique.length)
      throw new Problem('validation_failed', undefined, [
        { path: 'items', code: 'not_found', message: 'Unknown variant' },
      ]);
  }

  @Post('packages')
  @RequirePermission('catalog.manage')
  @ApiZodBody(packageInputSchema)
  async createPackage(
    @ZBody(packageInputSchema) body: z.output<typeof packageInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<PackageDto> {
    await this.assertVariants(body.items.map((i) => i.variantId));
    const tenantId = req.tenant!.id;
    const { items, ...rest } = body;
    const p = await this.db.tx.package.create({
      data: {
        ...rest,
        tenantId,
        items: {
          create: dedupe(items).map((i) => ({
            tenantId,
            variantId: i.variantId,
            quantity: i.quantity,
          })),
        },
      },
      include: { items: true },
    });
    await this.pricing.changed(
      req,
      'catalog.package_changed',
      { type: 'package', id: p.id },
      'created',
      { name: p.name },
    );
    return this.packageDto(p);
  }

  @Patch('packages/:id')
  @RequirePermission('catalog.manage')
  @ApiZodBody(packageUpdateSchema)
  async updatePackage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(packageUpdateSchema) body: z.output<typeof packageUpdateSchema>,
    @Req() req: TuelloRequest,
  ): Promise<PackageDto> {
    const exists = await this.db.tx.package.findFirst({ where: { id, deletedAt: null } });
    if (!exists) throw new Problem('not_found');
    const { items, ...rest } = body;
    if (items) {
      await this.assertVariants(items.map((i) => i.variantId));
      await this.db.tx.packageItem.deleteMany({ where: { packageId: id } });
      await this.db.tx.packageItem.createMany({
        data: dedupe(items).map((i) => ({
          tenantId: req.tenant!.id,
          packageId: id,
          variantId: i.variantId,
          quantity: i.quantity,
        })),
      });
    }
    const p = await this.db.tx.package.update({
      where: { id },
      data: rest,
      include: { items: true },
    });
    await this.pricing.changed(req, 'catalog.package_changed', { type: 'package', id }, 'updated', {
      fields: Object.keys(body),
    });
    return this.packageDto(p);
  }

  @Delete('packages/:id')
  @HttpCode(204)
  @RequirePermission('catalog.manage')
  async removePackage(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.package.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw new Problem('not_found');
    await this.pricing.changed(req, 'catalog.package_changed', { type: 'package', id }, 'deleted');
  }

  // ------------------------------------------------------------------------------ add-ons

  @Post('add-ons')
  @RequirePermission('catalog.manage')
  @ApiZodBody(addOnInputSchema)
  async createAddOn(
    @ZBody(addOnInputSchema) body: z.output<typeof addOnInputSchema>,
    @Req() req: TuelloRequest,
  ): Promise<AddOnDto> {
    if (body.serviceId) await this.loadService(body.serviceId);
    const a = await this.db.tx.addOn.create({ data: { ...body, tenantId: req.tenant!.id } });
    await this.pricing.changed(
      req,
      'catalog.add_on_changed',
      { type: 'add_on', id: a.id },
      'created',
      { name: a.name },
    );
    return this.addOnDto(a);
  }

  @Patch('add-ons/:id')
  @RequirePermission('catalog.manage')
  @ApiZodBody(addOnUpdateSchema)
  async updateAddOn(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(addOnUpdateSchema) body: z.output<typeof addOnUpdateSchema>,
    @Req() req: TuelloRequest,
  ): Promise<AddOnDto> {
    if (!(await this.db.tx.addOn.findFirst({ where: { id, deletedAt: null } })))
      throw new Problem('not_found');
    if (body.serviceId) await this.loadService(body.serviceId);
    const a = await this.db.tx.addOn.update({ where: { id }, data: body });
    await this.pricing.changed(req, 'catalog.add_on_changed', { type: 'add_on', id }, 'updated', {
      fields: Object.keys(body),
    });
    return this.addOnDto(a);
  }

  @Delete('add-ons/:id')
  @HttpCode(204)
  @RequirePermission('catalog.manage')
  async removeAddOn(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const r = await this.db.tx.addOn.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!r.count) throw new Problem('not_found');
    await this.pricing.changed(req, 'catalog.add_on_changed', { type: 'add_on', id }, 'deleted');
  }
}

function dedupe<T extends { variantId: string; quantity: number }>(items: T[]): T[] {
  const m = new Map<string, T>();
  for (const i of items)
    m.set(
      i.variantId,
      m.has(i.variantId) ? { ...i, quantity: m.get(i.variantId)!.quantity + i.quantity } : i,
    );
  return [...m.values()];
}
