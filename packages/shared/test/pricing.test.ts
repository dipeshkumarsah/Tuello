import { describe, expect, it } from 'vitest';
import {
  allocate,
  percentOf,
  PricingInputError,
  quote,
  type CouponInput,
  type PricingCatalog,
  type QuoteInput,
  type QuoteResult,
} from '../src';

const ASOF = '2026-10-02T12:00:00.000Z';

const catalog: PricingCatalog = {
  currency: 'USD',
  measurementUnit: 'sqft',
  sizeBands: [
    { id: 'S', name: 'Under 2,000', minSize: 0, maxSize: 2000 },
    { id: 'M', name: '2,000–3,499', minSize: 2000, maxSize: 3500 },
    { id: 'L', name: '3,500+', minSize: 3500, maxSize: null },
  ],
  propertyTypes: [
    { id: 'house', key: 'house', name: 'House' },
    { id: 'condo', key: 'condo', name: 'Condo' },
  ],
  variants: [
    {
      id: 'photo25',
      serviceId: 'photo',
      serviceName: 'Photography',
      name: '25 photos',
      basePrice: 16_000,
      taxable: true,
      active: true,
    },
    {
      id: 'video',
      serviceId: 'video',
      serviceName: 'Video',
      name: 'Walkthrough',
      basePrice: 30_000,
      taxable: true,
      active: true,
    },
    {
      id: 'drone',
      serviceId: 'drone',
      serviceName: 'Drone',
      name: 'Aerials',
      basePrice: 10_000,
      taxable: true,
      active: true,
    },
    {
      id: 'free',
      serviceId: 'floor',
      serviceName: 'Floor plan',
      name: 'Sketch',
      basePrice: 0,
      taxable: true,
      active: true,
    },
    {
      id: 'exempt',
      serviceId: 'stage',
      serviceName: 'Virtual staging',
      name: '1 room',
      basePrice: 2_000,
      taxable: false,
      active: true,
    },
    {
      id: 'retired',
      serviceId: 'photo',
      serviceName: 'Photography',
      name: 'Old',
      basePrice: 1_000,
      taxable: true,
      active: false,
    },
  ],
  packages: [
    { id: 'essentials', name: 'Essentials', basePrice: 40_000, taxable: true, active: true },
  ],
  addOns: [
    {
      id: 'twilight',
      name: 'Twilight shots',
      basePrice: 5_000,
      taxable: true,
      active: true,
      serviceId: 'photo',
      maxQuantity: 3,
    },
    {
      id: 'rush',
      name: 'Rush delivery',
      basePrice: 2_500,
      taxable: true,
      active: true,
      serviceId: null,
      maxQuantity: 1,
    },
    {
      id: 'extra10',
      name: '+10 photos',
      basePrice: 3_000,
      taxable: true,
      active: true,
      serviceId: 'photo',
      maxQuantity: 5,
    },
  ],
  priceRules: [
    {
      itemKind: 'variant',
      itemId: 'photo25',
      sizeBandId: 'S',
      propertyTypeId: null,
      price: 15_000,
    },
    {
      itemKind: 'variant',
      itemId: 'photo25',
      sizeBandId: 'M',
      propertyTypeId: null,
      price: 20_000,
    },
    {
      itemKind: 'variant',
      itemId: 'photo25',
      sizeBandId: 'L',
      propertyTypeId: null,
      price: 25_000,
    },
    {
      itemKind: 'variant',
      itemId: 'photo25',
      sizeBandId: 'M',
      propertyTypeId: 'condo',
      price: 18_000,
    },
    {
      itemKind: 'variant',
      itemId: 'photo25',
      sizeBandId: null,
      propertyTypeId: 'condo',
      price: 14_000,
    },
    {
      itemKind: 'package',
      itemId: 'essentials',
      sizeBandId: 'L',
      propertyTypeId: null,
      price: 50_000,
    },
  ],
  travelFeeRules: [
    {
      id: 'tr-north',
      name: 'North',
      kind: 'territory',
      priority: 1,
      active: true,
      territoryId: 'north',
      fee: 3_500,
    },
    {
      id: 'tr-km',
      name: 'Distance',
      kind: 'distance',
      priority: 2,
      active: true,
      freeKm: 25,
      perKm: 150,
      minFee: 1_000,
      maxFee: 10_000,
    },
  ],
  taxRates: [],
};

function input(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    catalog,
    property: { size: 1500 },
    items: [{ kind: 'variant', id: 'photo25' }],
    asOf: ASOF,
    ...over,
  };
}

function coupon(over: Partial<CouponInput>): CouponInput {
  return {
    id: 'c1',
    code: 'SAVE',
    kind: 'percent',
    percentOffBps: 1_000,
    amountOff: null,
    minSubtotal: null,
    startsAt: null,
    expiresAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    maxPerClient: null,
    clientRedemptionCount: 0,
    active: true,
    ...over,
  };
}

interface Case {
  name: string;
  input: QuoteInput;
  expect: (r: QuoteResult) => void;
}

const line0 = (r: QuoteResult) => r.lines[0]!;

describe('pricing engine: size bands and property types', () => {
  const cases: Case[] = [
    {
      name: 'below the first edge',
      input: input({ property: { size: 1999 } }),
      expect: (r) =>
        expect(line0(r)).toMatchObject({ unitPrice: 15_000, priceSource: 'size_band' }),
    },
    {
      name: 'lower edge is inclusive',
      input: input({ property: { size: 2000 } }),
      expect: (r) => expect(line0(r).unitPrice).toBe(20_000),
    },
    {
      name: 'just under the upper edge',
      input: input({ property: { size: 3499.99 } }),
      expect: (r) => expect(line0(r).unitPrice).toBe(20_000),
    },
    {
      name: 'upper edge is exclusive',
      input: input({ property: { size: 3500 } }),
      expect: (r) => expect(r.sizeBand?.id).toBe('L'),
    },
    {
      name: 'open-ended last band',
      input: input({ property: { size: 25_000 } }),
      expect: (r) => expect(line0(r).unitPrice).toBe(25_000),
    },
    {
      name: 'zero size is in the first band',
      input: input({ property: { size: 0 } }),
      expect: (r) => expect(r.sizeBand?.id).toBe('S'),
    },
    {
      name: 'square metres convert to the catalog unit',
      input: input({ property: { size: 200, sizeUnit: 'm2' } }), // 2,152.8 sq ft
      expect: (r) => expect(r.sizeBand?.id).toBe('M'),
    },
    {
      name: 'no size falls back to base price with a warning',
      input: input({ property: {} }),
      expect: (r) => {
        expect(line0(r)).toMatchObject({ unitPrice: 16_000, priceSource: 'base' });
        expect(r.warnings).toContainEqual({ code: 'no_size' });
      },
    },
    {
      name: 'band + property type beats band',
      input: input({ property: { size: 2500, propertyTypeId: 'condo' } }),
      expect: (r) =>
        expect(line0(r)).toMatchObject({
          unitPrice: 18_000,
          priceSource: 'size_band_property_type',
        }),
    },
    {
      name: 'band beats property type alone',
      input: input({ property: { size: 1000, propertyTypeId: 'condo' } }),
      expect: (r) =>
        expect(line0(r)).toMatchObject({ unitPrice: 15_000, priceSource: 'size_band' }),
    },
    {
      name: 'property type alone when size is unknown',
      input: input({ property: { propertyTypeId: 'condo' } }),
      expect: (r) =>
        expect(line0(r)).toMatchObject({ unitPrice: 14_000, priceSource: 'property_type' }),
    },
    {
      name: 'packages use their own size-band rules',
      input: input({ property: { size: 5000 }, items: [{ kind: 'package', id: 'essentials' }] }),
      expect: (r) => expect(line0(r)).toMatchObject({ unitPrice: 50_000, name: 'Essentials' }),
    },
  ];
  it.each(cases)('$name', (c) => c.expect(quote(c.input)));
});

describe('pricing engine: client price lists', () => {
  const list = {
    id: 'pl',
    name: 'Top agents',
    defaultPercentOffBps: 500,
    waiveTravel: false,
    entries: [
      { itemKind: 'variant' as const, itemId: 'photo25', fixedPrice: 12_000, percentOffBps: null },
      { itemKind: 'variant' as const, itemId: 'video', fixedPrice: null, percentOffBps: 1_000 },
    ],
  };
  const cases: Case[] = [
    {
      name: 'fixed override replaces the size-band price entirely',
      input: input({ priceList: list, property: { size: 9000, propertyTypeId: 'condo' } }),
      expect: (r) =>
        expect(line0(r)).toMatchObject({
          standardUnitPrice: 25_000,
          unitPrice: 12_000,
          priceSource: 'price_list_fixed',
        }),
    },
    {
      name: 'percent entry reduces the standard price',
      input: input({ priceList: list, items: [{ kind: 'variant', id: 'video' }] }),
      expect: (r) =>
        expect(line0(r)).toMatchObject({ unitPrice: 27_000, priceSource: 'price_list_percent' }),
    },
    {
      name: 'list default percent applies to items without an entry',
      input: input({ priceList: list, items: [{ kind: 'variant', id: 'drone' }] }),
      expect: (r) =>
        expect(line0(r)).toMatchObject({
          unitPrice: 9_500,
          priceSource: 'price_list_default_percent',
        }),
    },
    {
      name: 'percent rounding is half up',
      input: input({
        priceList: { ...list, defaultPercentOffBps: 333, entries: [] },
        items: [{ kind: 'add_on', id: 'rush' }],
      }),
      // 2,500 * 3.33% = 83.25 -> 83 off
      expect: (r) => expect(line0(r).unitPrice).toBe(2_417),
    },
    {
      name: 'a list can waive travel',
      input: input({
        priceList: { ...list, waiveTravel: true },
        property: { size: 1500, territoryId: 'north' },
      }),
      expect: (r) => expect(r.travel).toEqual({ fee: 0, ruleId: 'tr-north', reason: 'waived' }),
    },
  ];
  it.each(cases)('$name', (c) => c.expect(quote(c.input)));
});

describe('pricing engine: items and add-ons', () => {
  const cases: Case[] = [
    {
      name: 'stacked add-ons with quantities',
      input: input({
        items: [
          { kind: 'variant', id: 'photo25' },
          { kind: 'add_on', id: 'twilight', quantity: 2 },
          { kind: 'add_on', id: 'rush' },
          { kind: 'add_on', id: 'extra10', quantity: 3 },
        ],
      }),
      expect: (r) => {
        expect(r.lines.map((l) => l.amount)).toEqual([15_000, 10_000, 2_500, 9_000]);
        expect(r.subtotal).toBe(36_500);
        expect(r.total).toBe(36_500);
      },
    },
    {
      name: 'add-on quantity above its maximum is rejected',
      input: input({ items: [{ kind: 'add_on', id: 'rush', quantity: 2 }] }),
      expect: (r) => {
        expect(r.lines).toEqual([]);
        expect(r.warnings).toContainEqual({ code: 'invalid_quantity', itemId: 'rush' });
      },
    },
    {
      name: 'unknown and inactive items are skipped with warnings',
      input: input({
        items: [
          { kind: 'variant', id: 'nope' },
          { kind: 'variant', id: 'retired' },
        ],
      }),
      expect: (r) => {
        expect(r.lines).toEqual([]);
        expect(r.warnings).toEqual(
          expect.arrayContaining([
            { code: 'unknown_item', itemId: 'nope' },
            { code: 'inactive_item', itemId: 'retired' },
          ]),
        );
      },
    },
    {
      name: 'zero-total order',
      input: input({
        items: [{ kind: 'variant', id: 'free' }],
        catalog: {
          ...catalog,
          taxRates: [
            {
              id: 't',
              name: 'Tax',
              rateBps: 800,
              regionCode: null,
              appliesToTravel: true,
              active: true,
            },
          ],
        },
      }),
      expect: (r) => {
        expect(r).toMatchObject({ subtotal: 0, discount: 0, tax: 0, total: 0, taxes: [] });
        expect(r.lines).toHaveLength(1);
      },
    },
    {
      name: 'empty order',
      input: input({ items: [] }),
      expect: (r) => expect(r).toMatchObject({ subtotal: 0, total: 0, lines: [] }),
    },
  ];
  it.each(cases)('$name', (c) => c.expect(quote(c.input)));
});

describe('pricing engine: coupons', () => {
  const items = [
    { kind: 'variant' as const, id: 'photo25' }, // 15,000
    { kind: 'add_on' as const, id: 'twilight', quantity: 3 }, // 15,000
    { kind: 'add_on' as const, id: 'extra10', quantity: 1 }, // 3,000 -> subtotal 33,000
  ];
  const cases: Case[] = [
    {
      name: 'percent coupon',
      input: input({ items, coupon: coupon({ percentOffBps: 1_500 }) }),
      expect: (r) =>
        expect(r).toMatchObject({
          subtotal: 33_000,
          discount: 4_950,
          total: 28_050,
          coupon: { status: 'applied', amount: 4_950 },
        }),
    },
    {
      name: 'percent coupon rounds half up',
      input: input({
        items: [{ kind: 'add_on', id: 'rush' }],
        coupon: coupon({ percentOffBps: 1_234 }),
      }),
      // 2,500 * 12.34% = 308.5 -> 309
      expect: (r) => expect(r.discount).toBe(309),
    },
    {
      name: 'fixed coupon',
      input: input({
        items,
        coupon: coupon({ kind: 'fixed', percentOffBps: null, amountOff: 5_000 }),
      }),
      expect: (r) => expect(r).toMatchObject({ discount: 5_000, total: 28_000 }),
    },
    {
      name: 'fixed coupon larger than the subtotal is capped (never negative)',
      input: input({ coupon: coupon({ kind: 'fixed', percentOffBps: null, amountOff: 99_999 }) }),
      expect: (r) => expect(r).toMatchObject({ subtotal: 15_000, discount: 15_000, total: 0 }),
    },
    {
      name: 'coupon never discounts travel',
      input: input({
        property: { size: 1500, territoryId: 'north' },
        coupon: coupon({ kind: 'fixed', percentOffBps: null, amountOff: 99_999 }),
      }),
      expect: (r) => expect(r).toMatchObject({ discount: 15_000, total: 3_500 }),
    },
    {
      name: 'expired coupon (expiry instant is exclusive)',
      input: input({ coupon: coupon({ expiresAt: ASOF }) }),
      expect: (r) =>
        expect(r).toMatchObject({
          discount: 0,
          total: 15_000,
          coupon: { status: 'expired', amount: 0 },
        }),
    },
    {
      name: 'coupon valid one second before expiry',
      input: input({ coupon: coupon({ expiresAt: '2026-10-02T12:00:01.000Z' }) }),
      expect: (r) => expect(r.coupon?.status).toBe('applied'),
    },
    {
      name: 'not yet started',
      input: input({ coupon: coupon({ startsAt: '2026-10-03T00:00:00Z' }) }),
      expect: (r) => expect(r.coupon?.status).toBe('not_started'),
    },
    {
      name: 'redemption limit reached',
      input: input({ coupon: coupon({ maxRedemptions: 10, redemptionCount: 10 }) }),
      expect: (r) => expect(r.coupon?.status).toBe('exhausted'),
    },
    {
      name: 'per-client limit reached',
      input: input({ coupon: coupon({ maxPerClient: 1, clientRedemptionCount: 1 }) }),
      expect: (r) => expect(r.coupon?.status).toBe('client_limit'),
    },
    {
      name: 'below minimum subtotal',
      input: input({ coupon: coupon({ minSubtotal: 15_001 }) }),
      expect: (r) => expect(r.coupon?.status).toBe('below_minimum'),
    },
    {
      name: 'minimum is inclusive',
      input: input({ coupon: coupon({ minSubtotal: 15_000 }) }),
      expect: (r) => expect(r.coupon?.status).toBe('applied'),
    },
    {
      name: 'inactive coupon',
      input: input({ coupon: coupon({ active: false }) }),
      expect: (r) => expect(r.coupon?.status).toBe('inactive'),
    },
    {
      name: 'unknown code',
      input: input({ couponCode: 'NOPE' }),
      expect: (r) => expect(r.coupon).toEqual({ code: 'NOPE', status: 'not_found', amount: 0 }),
    },
    {
      name: '100% coupon gives a zero total',
      input: input({ items, coupon: coupon({ percentOffBps: 10_000 }) }),
      expect: (r) => expect(r).toMatchObject({ discount: 33_000, total: 0 }),
    },
    {
      name: 'discount is allocated to lines and sums exactly',
      input: input({
        items,
        coupon: coupon({ kind: 'fixed', percentOffBps: null, amountOff: 1_001 }),
      }),
      expect: (r) => {
        expect(r.lines.map((l) => l.discount).reduce((a, b) => a + b, 0)).toBe(1_001);
        expect(r.lines.map((l) => l.discount)).toEqual([455, 455, 91]);
      },
    },
    {
      name: 'allocation remainder goes to the largest fractions',
      input: input({
        items,
        coupon: coupon({ kind: 'fixed', percentOffBps: null, amountOff: 1_000 }),
      }),
      // 454.5 / 454.5 / 90.9 -> 454 / 454 / 90 + 2 cents to the .9 and the first .5
      expect: (r) => expect(r.lines.map((l) => l.discount)).toEqual([455, 454, 91]),
    },
  ];
  it.each(cases)('$name', (c) => c.expect(quote(c.input)));
});

describe('pricing engine: travel fees', () => {
  const cases: Case[] = [
    {
      name: 'territory flat fee',
      input: input({ property: { size: 1500, territoryId: 'north' } }),
      expect: (r) =>
        expect(r.travel).toEqual({ fee: 3_500, ruleId: 'tr-north', reason: 'territory' }),
    },
    {
      name: 'territory rule wins over distance by priority',
      input: input({ property: { size: 1500, territoryId: 'north', distanceKm: 300 } }),
      expect: (r) => expect(r.travel.fee).toBe(3_500),
    },
    {
      name: 'inside the free radius',
      input: input({ property: { size: 1500, distanceKm: 25 } }),
      expect: (r) => expect(r.travel).toEqual({ fee: 0, ruleId: 'tr-km', reason: 'distance' }),
    },
    {
      name: 'minimum fee once past the free radius',
      input: input({ property: { size: 1500, distanceKm: 25.1 } }),
      expect: (r) => expect(r.travel.fee).toBe(1_000),
    },
    {
      name: 'per started km',
      input: input({ property: { size: 1500, distanceKm: 40.2 } }),
      expect: (r) => expect(r.travel.fee).toBe(16 * 150),
    },
    {
      name: 'capped at the maximum',
      input: input({ property: { size: 1500, distanceKm: 500 } }),
      expect: (r) => expect(r.travel.fee).toBe(10_000),
    },
    {
      name: 'no location, no fee',
      input: input(),
      expect: (r) => expect(r.travel).toEqual({ fee: 0, ruleId: null, reason: 'none' }),
    },
  ];
  it.each(cases)('$name', (c) => c.expect(quote(c.input)));
});

describe('pricing engine: tax', () => {
  const taxed = (rates: PricingCatalog['taxRates']) => ({ ...catalog, taxRates: rates });
  const state = {
    id: 'ca',
    name: 'CA sales tax',
    rateBps: 725,
    regionCode: 'US-CA',
    appliesToTravel: false,
    active: true,
  };
  const city = {
    id: 'sf',
    name: 'SF',
    rateBps: 125,
    regionCode: 'US-CA-SF',
    appliesToTravel: true,
    active: true,
  };
  const cases: Case[] = [
    {
      name: 'rounds half up: 10.05 at 7.25% = 0.728625 -> 0.73',
      input: input({
        catalog: taxed([state]),
        property: { regionCode: 'US-CA' },
        items: [
          { kind: 'variant', id: 'free' },
          { kind: 'add_on', id: 'rush' },
        ],
        priceList: {
          id: 'p',
          name: 'x',
          defaultPercentOffBps: 0,
          waiveTravel: false,
          entries: [{ itemKind: 'add_on', itemId: 'rush', fixedPrice: 1_005, percentOffBps: null }],
        },
      }),
      expect: (r) => expect(r.tax).toBe(73),
    },
    {
      name: 'exact half cent rounds up: 10.00 at 7.25% = 0.725 -> 0.73',
      input: input({
        catalog: taxed([state]),
        property: { regionCode: 'US-CA' },
        items: [{ kind: 'add_on', id: 'rush' }],
        priceList: {
          id: 'p',
          name: 'x',
          defaultPercentOffBps: 0,
          waiveTravel: false,
          entries: [{ itemKind: 'add_on', itemId: 'rush', fixedPrice: 1_000, percentOffBps: null }],
        },
      }),
      expect: (r) => expect(r.tax).toBe(73),
    },
    {
      name: 'just under half rounds down: 10.06 at 7.25% = 0.72935 -> 0.73; 10.02 -> 0.726 -> 0.73; 9.99 -> 0.724 -> 0.72',
      input: input({
        catalog: taxed([state]),
        property: { regionCode: 'US-CA' },
        items: [{ kind: 'add_on', id: 'rush' }],
        priceList: {
          id: 'p',
          name: 'x',
          defaultPercentOffBps: 0,
          waiveTravel: false,
          entries: [{ itemKind: 'add_on', itemId: 'rush', fixedPrice: 999, percentOffBps: null }],
        },
      }),
      expect: (r) => expect(r.tax).toBe(72),
    },
    {
      name: 'stacked regional rates, rounded once per rate',
      input: input({
        catalog: taxed([state, city]),
        property: { size: 1500, regionCode: 'us-ca-sf' },
      }),
      expect: (r) => {
        expect(r.taxes.map((t) => [t.rateId, t.base, t.amount])).toEqual([
          ['ca', 15_000, 1_088], // 1,087.5 -> 1,088
          ['sf', 15_000, 188], // 187.5 -> 188
        ]);
        expect(r.total).toBe(15_000 + 1_088 + 188);
      },
    },
    {
      name: 'a rate for another region does not apply',
      input: input({
        catalog: taxed([state, city]),
        property: { size: 1500, regionCode: 'US-CA-LA' },
      }),
      expect: (r) => expect(r.taxes.map((t) => t.rateId)).toEqual(['ca']),
    },
    {
      name: 'no region, only global rates apply',
      input: input({
        catalog: taxed([state, { ...city, id: 'g', regionCode: null }]),
        property: { size: 1500 },
      }),
      expect: (r) => expect(r.taxes.map((t) => t.rateId)).toEqual(['g']),
    },
    {
      name: 'tax is on the discounted amount and skips non-taxable lines',
      input: input({
        catalog: taxed([state]),
        property: { size: 1500, regionCode: 'US-CA' },
        items: [
          { kind: 'variant', id: 'photo25' },
          { kind: 'variant', id: 'exempt' },
        ], // 15,000 + 2,000 exempt
        coupon: coupon({ percentOffBps: 1_000 }), // 1,700 off: 1,500 + 200
      }),
      expect: (r) => {
        expect(r.taxes[0]).toMatchObject({ base: 13_500, amount: 979 }); // 978.75 -> 979
        expect(r.total).toBe(17_000 - 1_700 + 979);
      },
    },
    {
      name: 'travel is taxed only by rates that say so',
      input: input({
        catalog: taxed([state, city]),
        property: { size: 1500, regionCode: 'US-CA-SF', territoryId: 'north' },
      }),
      expect: (r) => {
        expect(r.taxes.find((t) => t.rateId === 'ca')!.base).toBe(15_000);
        expect(r.taxes.find((t) => t.rateId === 'sf')!.base).toBe(18_500);
      },
    },
    {
      name: 'inactive rates are ignored',
      input: input({
        catalog: taxed([{ ...state, active: false }]),
        property: { size: 1500, regionCode: 'US-CA' },
      }),
      expect: (r) => expect(r.tax).toBe(0),
    },
  ];
  it.each(cases)('$name', (c) => c.expect(quote(c.input)));
});

describe('pricing engine: invariants', () => {
  it('total = subtotal - discount + travel + tax, always non-negative', () => {
    for (let i = 0; i < 300; i++) {
      const r = quote(
        input({
          catalog: {
            ...catalog,
            taxRates: [
              {
                id: 't',
                name: 'T',
                rateBps: (i * 37) % 2000,
                regionCode: null,
                appliesToTravel: i % 2 === 0,
                active: true,
              },
            ],
          },
          property: {
            size: (i * 97) % 6000,
            distanceKm: i % 80,
            propertyTypeId: i % 3 ? 'house' : 'condo',
          },
          items: [
            { kind: 'variant', id: 'photo25' },
            { kind: 'add_on', id: 'twilight', quantity: (i % 3) + 1 },
          ],
          coupon: coupon(
            i % 2
              ? { percentOffBps: (i * 113) % 10_001 }
              : { kind: 'fixed', percentOffBps: null, amountOff: i * 211 },
          ),
        }),
      );
      expect(r.total).toBe(r.subtotal - r.discount + r.travel.fee + r.tax);
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.lines.reduce((s, l) => s + l.discount, 0)).toBe(r.discount);
      for (const n of [r.subtotal, r.discount, r.tax, r.total, ...r.lines.map((l) => l.amount)])
        expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('rejects non-integer or negative money in the catalog', () => {
    expect(() =>
      quote(
        input({
          catalog: { ...catalog, variants: [{ ...catalog.variants[0]!, basePrice: 10.5 }] },
        }),
      ),
    ).toThrow(PricingInputError);
    expect(() =>
      quote(
        input({ catalog: { ...catalog, priceRules: [{ ...catalog.priceRules[0]!, price: -1 }] } }),
      ),
    ).toThrow(PricingInputError);
  });

  it('is deterministic', () => {
    expect(quote(input({ property: { size: 2500, territoryId: 'north' } }))).toEqual(
      quote(input({ property: { size: 2500, territoryId: 'north' } })),
    );
  });

  it('allocate and percentOf helpers', () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
    expect(percentOf(1, 5_000)).toBe(1); // 0.5 -> 1
    expect(percentOf(1, 4_999)).toBe(0);
  });
});
