/**
 * Pricing engine contract. Every amount is an integer in minor units (cents) of the tenant's
 * currency; every percentage is in basis points (1% = 100 bps).
 */
export type ItemKind = 'variant' | 'package' | 'add_on';
export type SizeUnit = 'sqft' | 'm2';

export interface SizeBand {
  id: string;
  name: string;
  /** Inclusive lower bound, in the catalog's measurement unit. */
  minSize: number;
  /** Exclusive upper bound; null = no upper bound. */
  maxSize: number | null;
}

export interface PropertyType {
  id: string;
  key: string;
  name: string;
}

export interface CatalogVariant {
  id: string;
  serviceId: string;
  serviceName: string;
  name: string;
  basePrice: number;
  taxable: boolean;
  active: boolean;
}

export interface CatalogPackage {
  id: string;
  name: string;
  basePrice: number;
  taxable: boolean;
  active: boolean;
}

export interface CatalogAddOn {
  id: string;
  name: string;
  basePrice: number;
  taxable: boolean;
  active: boolean;
  /** Service the add-on belongs to; null = can be added to any order. */
  serviceId: string | null;
  maxQuantity: number | null;
}

/** A price for one item, optionally for one size band and/or one property type. */
export interface PriceRule {
  itemKind: ItemKind;
  itemId: string;
  sizeBandId: string | null;
  propertyTypeId: string | null;
  price: number;
}

export type TravelFeeRule =
  | { id: string; name: string; kind: 'territory'; priority: number; active: boolean; territoryId: string; fee: number }
  | {
      id: string;
      name: string;
      kind: 'distance';
      priority: number;
      active: boolean;
      /** Kilometres included at no charge. */
      freeKm: number;
      /** Fee per started kilometre beyond freeKm. */
      perKm: number;
      minFee: number | null;
      maxFee: number | null;
    };

export interface TaxRate {
  id: string;
  name: string;
  rateBps: number;
  /** null = applies everywhere; "US-CA" also matches "US-CA-LA". */
  regionCode: string | null;
  appliesToTravel: boolean;
  active: boolean;
}

/** Everything the engine needs from the tenant's catalog. Loaded by the API, sent to the web. */
export interface PricingCatalog {
  currency: string;
  measurementUnit: SizeUnit;
  sizeBands: SizeBand[];
  propertyTypes: PropertyType[];
  variants: CatalogVariant[];
  packages: CatalogPackage[];
  addOns: CatalogAddOn[];
  priceRules: PriceRule[];
  travelFeeRules: TravelFeeRule[];
  taxRates: TaxRate[];
}

export interface PriceListEntry {
  itemKind: ItemKind;
  itemId: string;
  /** Replaces the size-band price entirely. Exactly one of fixedPrice / percentOffBps is set. */
  fixedPrice: number | null;
  percentOffBps: number | null;
}

export interface PriceListInput {
  id: string;
  name: string;
  /** Applied to every item without its own entry. */
  defaultPercentOffBps: number;
  waiveTravel: boolean;
  entries: PriceListEntry[];
}

export interface CouponInput {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  percentOffBps: number | null;
  amountOff: number | null;
  minSubtotal: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxPerClient: number | null;
  clientRedemptionCount: number;
  active: boolean;
}

export interface PropertyInput {
  size?: number | null;
  sizeUnit?: SizeUnit;
  propertyTypeId?: string | null;
  regionCode?: string | null;
  territoryId?: string | null;
  distanceKm?: number | null;
}

export interface QuoteItemInput {
  kind: ItemKind;
  id: string;
  quantity?: number;
}

export interface QuoteInput {
  catalog: PricingCatalog;
  priceList?: PriceListInput | null;
  property: PropertyInput;
  items: QuoteItemInput[];
  /** The coupon the caller looked up. If couponCode is set but coupon is null, it was not found. */
  coupon?: CouponInput | null;
  couponCode?: string | null;
  /** ISO timestamp the quote is priced as of (coupon validity). */
  asOf: string;
}

export type PriceSource =
  | 'base'
  | 'property_type'
  | 'size_band'
  | 'size_band_property_type'
  | 'price_list_fixed'
  | 'price_list_percent'
  | 'price_list_default_percent';

export interface QuoteLine {
  key: string;
  kind: ItemKind;
  itemId: string;
  name: string;
  quantity: number;
  /** Price before any client price list. */
  standardUnitPrice: number;
  unitPrice: number;
  amount: number;
  priceSource: PriceSource;
  /** Share of the coupon discount allocated to this line. */
  discount: number;
  taxable: boolean;
}

export type CouponStatus =
  | 'applied'
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'exhausted'
  | 'client_limit'
  | 'below_minimum';

export interface QuoteTax {
  rateId: string;
  name: string;
  rateBps: number;
  base: number;
  amount: number;
}

export type QuoteWarning =
  | { code: 'unknown_item'; itemId: string }
  | { code: 'inactive_item'; itemId: string }
  | { code: 'invalid_quantity'; itemId: string }
  | { code: 'no_size'; itemId?: undefined };

export interface QuoteResult {
  currency: string;
  lines: QuoteLine[];
  sizeBand: { id: string; name: string } | null;
  subtotal: number;
  coupon: { code: string; status: CouponStatus; amount: number } | null;
  discount: number;
  travel: { fee: number; ruleId: string | null; reason: 'territory' | 'distance' | 'waived' | 'none' };
  taxes: QuoteTax[];
  tax: number;
  total: number;
  warnings: QuoteWarning[];
}
