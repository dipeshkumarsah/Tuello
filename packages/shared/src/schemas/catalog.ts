import { z } from 'zod';

/** Money in requests is always integer minor units. */
export const moneySchema = z.number().int().min(0).max(100_000_000);
export const bpsSchema = z.number().int().min(0).max(10_000);

export const SERVICE_CATEGORIES = ['photo', 'video', 'drone', 'tour_3d', 'floor_plan', 'twilight', 'virtual_staging', 'other'] as const;
export const DELIVERABLE_TYPES = ['photos', 'video', 'tour', 'floor_plan', 'document', 'other'] as const;
export const ITEM_KINDS = ['variant', 'package', 'add_on'] as const;

const desc = z.string().trim().max(2000).nullable().optional();

export const skillInputSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const serviceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: desc,
  category: z.enum(SERVICE_CATEGORIES),
  durationMinutes: z.number().int().min(0).max(24 * 60),
  requiredSkillId: z.uuid().nullable().optional(),
  deliverableType: z.enum(DELIVERABLE_TYPES),
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export const serviceUpdateSchema = serviceInputSchema.partial();

export const variantInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  basePrice: moneySchema,
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export const variantUpdateSchema = variantInputSchema.partial();

export const packageInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: desc,
  basePrice: moneySchema,
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  items: z
    .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(100).default(1) }))
    .min(1)
    .max(30),
});
export const packageUpdateSchema = packageInputSchema.partial();

export const addOnInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: desc,
  serviceId: z.uuid().nullable().optional(),
  basePrice: moneySchema,
  durationMinutes: z.number().int().min(0).max(24 * 60).default(0),
  maxQuantity: z.number().int().min(1).max(1000).nullable().optional(),
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export const addOnUpdateSchema = addOnInputSchema.partial();

export const propertyTypeInputSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const sizeBandInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    minSize: z.number().int().min(0).max(10_000_000),
    maxSize: z.number().int().min(1).max(10_000_000).nullable(),
  })
  .refine((b) => b.maxSize == null || b.maxSize > b.minSize, { error: 'validation.size_band_range', path: ['maxSize'] });

/** Replaces every price rule of one item (the price grid for that item) in one call. */
export const priceRulesForItemSchema = z.object({
  itemKind: z.enum(ITEM_KINDS),
  itemId: z.uuid(),
  rules: z
    .array(z.object({ sizeBandId: z.uuid().nullable(), propertyTypeId: z.uuid().nullable(), price: moneySchema }))
    .max(500),
});

export const priceListInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: desc,
  defaultPercentOffBps: bpsSchema.default(0),
  waiveTravel: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const priceListUpdateSchema = priceListInputSchema.partial();

export const priceListEntriesSchema = z.object({
  entries: z
    .array(
      z
        .object({ itemKind: z.enum(ITEM_KINDS), itemId: z.uuid(), fixedPrice: moneySchema.nullable(), percentOffBps: bpsSchema.nullable() })
        .refine((e) => (e.fixedPrice == null) !== (e.percentOffBps == null), { error: 'validation.price_list_entry' }),
    )
    .max(1000),
});

export const territoryInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: desc,
  /** Postal codes or prefixes ("941", "SW1A"), matched case-insensitively from the start. */
  postalPrefixes: z.array(z.string().trim().toUpperCase().min(1).max(12)).max(2000).default([]),
});
export const territoryUpdateSchema = territoryInputSchema.partial();

export const travelFeeRuleInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('territory'),
    name: z.string().trim().min(1).max(120),
    territoryId: z.uuid(),
    fee: moneySchema,
    priority: z.number().int().min(0).max(1000).default(10),
    active: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('distance'),
    name: z.string().trim().min(1).max(120),
    freeKm: z.number().int().min(0).max(10_000),
    perKm: moneySchema,
    minFee: moneySchema.nullable().default(null),
    maxFee: moneySchema.nullable().default(null),
    priority: z.number().int().min(0).max(1000).default(100),
    active: z.boolean().default(true),
  }),
]);

export const couponInputSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, { error: 'validation.coupon_code' }),
    description: desc,
    kind: z.enum(['percent', 'fixed']),
    percentOffBps: bpsSchema.nullable().default(null),
    amountOff: moneySchema.nullable().default(null),
    minSubtotal: moneySchema.nullable().default(null),
    startsAt: z.iso.datetime().nullable().default(null),
    expiresAt: z.iso.datetime().nullable().default(null),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    maxPerClient: z.number().int().min(1).max(1000).nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((c) => (c.kind === 'percent' ? c.percentOffBps != null && c.percentOffBps > 0 : c.amountOff != null && c.amountOff > 0), {
    error: 'validation.coupon_value',
    path: ['percentOffBps'],
  })
  .refine((c) => !c.startsAt || !c.expiresAt || Date.parse(c.expiresAt) > Date.parse(c.startsAt), {
    error: 'validation.coupon_dates',
    path: ['expiresAt'],
  });

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rateBps: bpsSchema,
  regionCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,3}(-[A-Z0-9]{1,10}){0,3}$/, { error: 'validation.region_code' })
    .nullable()
    .default(null),
  appliesToTravel: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const quoteRequestSchema = z.object({
  clientId: z.uuid().nullable().optional(),
  /** Explicit price list (preview in the editor); otherwise the client's or brokerage's list. */
  priceListId: z.uuid().nullable().optional(),
  property: z.object({
    size: z.number().min(0).max(10_000_000).nullable().optional(),
    sizeUnit: z.enum(['sqft', 'm2']).optional(),
    propertyTypeId: z.uuid().nullable().optional(),
    regionCode: z.string().trim().toUpperCase().max(40).nullable().optional(),
    postalCode: z.string().trim().toUpperCase().max(12).nullable().optional(),
    territoryId: z.uuid().nullable().optional(),
    distanceKm: z.number().min(0).max(10_000).nullable().optional(),
  }),
  items: z.array(z.object({ kind: z.enum(ITEM_KINDS), id: z.uuid(), quantity: z.number().int().min(1).max(1000).optional() })).max(100),
  couponCode: z.string().trim().toUpperCase().max(32).nullable().optional(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export interface SkillDto {
  id: string;
  name: string;
}

export interface VariantDto {
  id: string;
  serviceId: string;
  name: string;
  basePrice: number;
  durationMinutes: number | null;
  active: boolean;
  sortOrder: number;
}

export interface ServiceDto {
  id: string;
  name: string;
  description: string | null;
  category: (typeof SERVICE_CATEGORIES)[number];
  durationMinutes: number;
  requiredSkill: SkillDto | null;
  deliverableType: (typeof DELIVERABLE_TYPES)[number];
  taxable: boolean;
  active: boolean;
  sortOrder: number;
  variants: VariantDto[];
}

export interface PackageDto {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  taxable: boolean;
  active: boolean;
  sortOrder: number;
  items: Array<{ variantId: string; quantity: number }>;
}

export interface AddOnDto {
  id: string;
  name: string;
  description: string | null;
  serviceId: string | null;
  basePrice: number;
  durationMinutes: number;
  maxQuantity: number | null;
  taxable: boolean;
  active: boolean;
  sortOrder: number;
}

export interface PriceListDto {
  id: string;
  name: string;
  description: string | null;
  defaultPercentOffBps: number;
  waiveTravel: boolean;
  active: boolean;
  entries: Array<{ itemKind: (typeof ITEM_KINDS)[number]; itemId: string; fixedPrice: number | null; percentOffBps: number | null }>;
  clientCount: number;
  brokerageCount: number;
}

export interface TerritoryDto {
  id: string;
  name: string;
  description: string | null;
  postalPrefixes: string[];
}

export interface CouponDto {
  id: string;
  code: string;
  description: string | null;
  kind: 'percent' | 'fixed';
  percentOffBps: number | null;
  amountOff: number | null;
  minSubtotal: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  maxPerClient: number | null;
  redemptionCount: number;
  active: boolean;
}
