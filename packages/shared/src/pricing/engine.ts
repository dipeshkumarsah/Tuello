import {
  allocate,
  assertBps,
  assertMoney,
  convertSize,
  percentOf,
  percentOff,
  PricingInputError,
} from './money';
import type {
  CatalogAddOn,
  CouponInput,
  CouponStatus,
  ItemKind,
  PriceSource,
  PricingCatalog,
  PropertyInput,
  QuoteInput,
  QuoteLine,
  QuoteResult,
  QuoteTax,
  QuoteWarning,
  SizeBand,
} from './types';

/**
 * THE pricing engine. Pure and deterministic: the API (quotes, orders) and the web order form /
 * live preview call this same function with the same catalog snapshot.
 *
 * Order of evaluation:
 *  1. Standard price per item: most specific price rule (size band + property type, then size
 *     band, then property type), else the item's base price.
 *  2. Client price list: an entry's fixed price replaces the standard price; an entry's percent
 *     (or the list's default percent) reduces it.
 *  3. Coupon on the item subtotal (never on travel), allocated to lines by largest remainder.
 *  4. Travel fee: territory rule or distance rule (first match by priority); waivable by price list.
 *  5. Tax per applicable rate on the taxable base (after discount; travel if the rate says so),
 *     rounded half up once per rate.
 */
export function quote(input: QuoteInput): QuoteResult {
  const { catalog, priceList, property, asOf } = input;
  const warnings: QuoteWarning[] = [];
  validateCatalog(catalog);

  const band = findSizeBand(catalog, property);
  if (property.size == null) warnings.push({ code: 'no_size' });
  const propertyTypeId = property.propertyTypeId ?? null;

  // ------------------------------------------------------------------ 1 + 2: line prices
  const lines: QuoteLine[] = [];
  input.items.forEach((item, index) => {
    const found = findItem(catalog, item.kind, item.id);
    if (!found) return warnings.push({ code: 'unknown_item', itemId: item.id });
    if (!found.active) return warnings.push({ code: 'inactive_item', itemId: item.id });
    const quantity = item.quantity ?? 1;
    const max: number | null = item.kind === 'add_on' ? (found as CatalogAddOn).maxQuantity : null;
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000 ||
      (max != null && quantity > max)
    ) {
      return warnings.push({ code: 'invalid_quantity', itemId: item.id });
    }

    const standard = standardPrice(
      catalog,
      item.kind,
      item.id,
      found.basePrice,
      band?.id ?? null,
      propertyTypeId,
    );
    let unitPrice = standard.price;
    let source: PriceSource = standard.source;
    if (priceList) {
      const entry = priceList.entries.find((e) => e.itemKind === item.kind && e.itemId === item.id);
      if (entry?.fixedPrice != null) {
        assertMoney(entry.fixedPrice, 'price list fixed price');
        unitPrice = entry.fixedPrice;
        source = 'price_list_fixed';
      } else if (entry?.percentOffBps != null) {
        assertBps(entry.percentOffBps, 'price list percent');
        unitPrice = percentOff(standard.price, entry.percentOffBps);
        source = 'price_list_percent';
      } else if (priceList.defaultPercentOffBps > 0) {
        assertBps(priceList.defaultPercentOffBps, 'price list default percent');
        unitPrice = percentOff(standard.price, priceList.defaultPercentOffBps);
        source = 'price_list_default_percent';
      }
    }

    lines.push({
      key: `${index}:${item.kind}:${item.id}`,
      kind: item.kind,
      itemId: item.id,
      name: displayName(found, item.kind),
      quantity,
      standardUnitPrice: standard.price,
      unitPrice,
      amount: unitPrice * quantity,
      priceSource: source,
      discount: 0,
      taxable: found.taxable,
    });
  });

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  // ------------------------------------------------------------------ 3: coupon
  let coupon: QuoteResult['coupon'] = null;
  let discount = 0;
  if (input.couponCode || input.coupon) {
    const code = input.coupon?.code ?? input.couponCode ?? '';
    const status = input.coupon ? couponStatus(input.coupon, subtotal, asOf) : 'not_found';
    if (status === 'applied') discount = couponAmount(input.coupon!, subtotal);
    coupon = { code, status, amount: discount };
    allocate(
      discount,
      lines.map((l) => l.amount),
    ).forEach((d, i) => (lines[i]!.discount = d));
  }

  // ------------------------------------------------------------------ 4: travel
  const travel = travelFee(catalog, property, priceList?.waiveTravel ?? false);

  // ------------------------------------------------------------------ 5: tax
  const taxableItems = lines
    .filter((l) => l.taxable)
    .reduce((s, l) => s + l.amount - l.discount, 0);
  const taxes: QuoteTax[] = catalog.taxRates
    .filter((r) => r.active && regionMatches(r.regionCode, property.regionCode))
    .map((r) => {
      const base = taxableItems + (r.appliesToTravel ? travel.fee : 0);
      return {
        rateId: r.id,
        name: r.name,
        rateBps: r.rateBps,
        base,
        amount: percentOf(base, r.rateBps),
      };
    })
    .filter((t) => t.base > 0 || t.amount > 0);
  const tax = taxes.reduce((s, t) => s + t.amount, 0);

  const total = subtotal - discount + travel.fee + tax;
  if (total < 0) throw new PricingInputError('total went negative'); // unreachable by construction

  return {
    currency: catalog.currency,
    lines,
    sizeBand: band ? { id: band.id, name: band.name } : null,
    subtotal,
    coupon,
    discount,
    travel,
    taxes,
    tax,
    total,
    warnings,
  };
}

function validateCatalog(c: PricingCatalog) {
  for (const v of [...c.variants, ...c.packages, ...c.addOns])
    assertMoney(v.basePrice, `base price of ${v.id}`);
  for (const r of c.priceRules) assertMoney(r.price, `price rule for ${r.itemId}`);
  for (const t of c.taxRates) assertBps(t.rateBps, `tax rate ${t.id}`);
}

export function findSizeBand(catalog: PricingCatalog, property: PropertyInput): SizeBand | null {
  if (property.size == null || !Number.isFinite(property.size) || property.size < 0) return null;
  const size = convertSize(
    property.size,
    property.sizeUnit ?? catalog.measurementUnit,
    catalog.measurementUnit,
  );
  return (
    catalog.sizeBands.find((b) => size >= b.minSize && (b.maxSize == null || size < b.maxSize)) ??
    null
  );
}

function findItem(catalog: PricingCatalog, kind: ItemKind, id: string) {
  if (kind === 'variant') return catalog.variants.find((v) => v.id === id);
  if (kind === 'package') return catalog.packages.find((p) => p.id === id);
  return catalog.addOns.find((a) => a.id === id);
}

function displayName(item: { name: string; serviceName?: string }, kind: ItemKind): string {
  return kind === 'variant' && item.serviceName ? `${item.serviceName} · ${item.name}` : item.name;
}

function standardPrice(
  catalog: PricingCatalog,
  kind: ItemKind,
  itemId: string,
  basePrice: number,
  bandId: string | null,
  typeId: string | null,
): { price: number; source: PriceSource } {
  const rules = catalog.priceRules.filter((r) => r.itemKind === kind && r.itemId === itemId);
  const pick = (b: string | null, t: string | null) =>
    rules.find((r) => r.sizeBandId === b && r.propertyTypeId === t);
  if (bandId && typeId) {
    const r = pick(bandId, typeId);
    if (r) return { price: r.price, source: 'size_band_property_type' };
  }
  if (bandId) {
    const r = pick(bandId, null);
    if (r) return { price: r.price, source: 'size_band' };
  }
  if (typeId) {
    const r = pick(null, typeId);
    if (r) return { price: r.price, source: 'property_type' };
  }
  return { price: basePrice, source: 'base' };
}

export function couponStatus(c: CouponInput, subtotal: number, asOf: string): CouponStatus {
  const now = Date.parse(asOf);
  if (!c.active) return 'inactive';
  if (c.startsAt && Date.parse(c.startsAt) > now) return 'not_started';
  if (c.expiresAt && Date.parse(c.expiresAt) <= now) return 'expired';
  if (c.maxRedemptions != null && c.redemptionCount >= c.maxRedemptions) return 'exhausted';
  if (c.maxPerClient != null && c.clientRedemptionCount >= c.maxPerClient) return 'client_limit';
  if (c.minSubtotal != null && subtotal < c.minSubtotal) return 'below_minimum';
  return 'applied';
}

function couponAmount(c: CouponInput, subtotal: number): number {
  if (c.kind === 'percent') {
    assertBps(c.percentOffBps ?? 0, 'coupon percent');
    return percentOf(subtotal, c.percentOffBps ?? 0);
  }
  assertMoney(c.amountOff ?? 0, 'coupon amount');
  return Math.min(c.amountOff ?? 0, subtotal);
}

function travelFee(
  catalog: PricingCatalog,
  property: PropertyInput,
  waived: boolean,
): QuoteResult['travel'] {
  const rules = catalog.travelFeeRules
    .filter((r) => r.active)
    .sort((a, b) => a.priority - b.priority);
  for (const r of rules) {
    if (r.kind === 'territory' && property.territoryId && r.territoryId === property.territoryId) {
      assertMoney(r.fee, 'territory fee');
      return waived
        ? { fee: 0, ruleId: r.id, reason: 'waived' }
        : { fee: r.fee, ruleId: r.id, reason: 'territory' };
    }
    if (r.kind === 'distance' && property.distanceKm != null && property.distanceKm >= 0) {
      const billable = Math.max(0, Math.ceil(property.distanceKm - r.freeKm - 1e-9));
      let fee = billable * r.perKm;
      if (billable > 0) {
        if (r.minFee != null) fee = Math.max(fee, r.minFee);
        if (r.maxFee != null) fee = Math.min(fee, r.maxFee);
      }
      assertMoney(fee, 'distance fee');
      return waived
        ? { fee: 0, ruleId: r.id, reason: 'waived' }
        : { fee, ruleId: r.id, reason: 'distance' };
    }
  }
  return { fee: 0, ruleId: null, reason: 'none' };
}

export function regionMatches(
  rateRegion: string | null,
  propertyRegion: string | null | undefined,
): boolean {
  if (!rateRegion) return true;
  if (!propertyRegion) return false;
  const a = rateRegion.toUpperCase();
  const b = propertyRegion.toUpperCase();
  return b === a || b.startsWith(`${a}-`);
}
